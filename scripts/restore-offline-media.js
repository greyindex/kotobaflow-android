const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// Deliberately restore only playback assets, never masters, QA, or private data.
// The one index besides them: the web's public package builder, which the
// public edition runs, requires the main voice's manifest (never packaged).
const mediaRules = {
  gcloud_chirp3_vocab12528_female_aoede_v1: (file) =>
    file.endsWith(".ogg") || file === "manifest.jsonl",
  gcloud_chirp3_vocab6127_female_aoede_v1: (file) => file.endsWith(".ogg"),
  gemini38_flash_tts_reading_sections_candidate_v1: sectionAsset,
  gemini38_flash_tts_dialogue_sections_candidate_v1: sectionAsset,
  kotobaflow_reading_chirp_v1: sectionAsset,
  kotobaflow_dialogue_lite_v1: sectionAsset,
  kotobaflow_word_audio_v1: (file) =>
    file.endsWith(".ogg") || file === "words.json",
  gemini38_flash_tts_kotobaflow_kana_candidate_v1: (file) =>
    file.endsWith(".ogg") || file === "clips.json",
  kotobaflow_unit_images_v1: (file) =>
    file.endsWith(".webp") || file === "images.json",
  // Example sentence audio: index, hash shards and the OGG packs they point into.
  example_audio_v1: (file) =>
    file === "index.json" ||
    /^shards\/[^/]+\.json$/.test(file) ||
    /^packs\/[^/]+\.ogg$/.test(file),
  // Local classics library: catalog, per-work index and parts, narrations.
  classics_v1: (file) =>
    file === "catalog.json" ||
    /^[a-z][a-z0-9_-]{0,31}\/(?:index|[0-9]{2,3})\.json$/.test(file) ||
    /^[a-z][a-z0-9_-]{0,31}\/[a-z0-9_-]{1,32}\.(?:mp3|ogg|m4a)$/.test(file),
};

function sectionAsset(file) {
  return (
    file.endsWith(".ogg") ||
    file === "manifest.jsonl" ||
    (file.includes("/") && file.endsWith("/manifest.json"))
  );
}

function assertNoLinks(target) {
  const absolute = path.resolve(target);
  const root = path.parse(absolute).root;
  let current = root;
  for (const component of absolute.slice(root.length).split(path.sep)) {
    if (!component) continue;
    current = path.join(current, component);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error(`Refusing symbolic link or junction: ${current}`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function digest(body) {
  return crypto.createHash("sha256").update(body).digest("hex");
}

function readChecked(file) {
  assertNoLinks(file);
  const body = fs.readFileSync(file);
  if (
    body
      .subarray(0, 100)
      .toString()
      .startsWith("version https://git-lfs.github.com/spec/v1")
  ) {
    throw new Error(
      `Unresolved LFS pointer; hydrate using Git LFS first: ${file}`,
    );
  }
  return body;
}

function walk(root, relative = "") {
  const directory = path.join(root, relative);
  assertNoLinks(directory);
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Refusing symbolic link or junction: ${path.join(root, child)}`,
      );
    }
    if (entry.isDirectory()) files.push(...walk(root, child));
    else if (entry.isFile()) files.push(child);
    else
      throw new Error(
        `Unsupported filesystem entry: ${path.join(root, child)}`,
      );
  }
  return files.sort();
}

function ensureParent(file) {
  assertNoLinks(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  assertNoLinks(file);
}

function saveReport(file, report) {
  ensureParent(file);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
}

function main() {
  const args = process.argv.slice(2);
  if (
    !args[0] ||
    args[0].startsWith("--") ||
    args.slice(1).some((arg) => arg !== "--apply")
  ) {
    throw new Error(
      "Usage: node scripts/restore-offline-media.js <authoritative-web-checkout> [--apply]",
    );
  }
  const source = path.resolve(args[0]);
  const mobile = path.resolve(__dirname, "..");
  const target = path.join(mobile, "web-source-backup");
  if (source.toLowerCase() === target.toLowerCase()) {
    throw new Error("Source must be an independent authoritative checkout.");
  }
  const artifacts = path.join(mobile, "artifacts", "upstream-port-2026-10-20");
  const reportPath = path.join(artifacts, "media-restore.json");
  for (const root of [source, target, artifacts, reportPath])
    assertNoLinks(root);
  const report = {
    source,
    target,
    startedAt: new Date().toISOString(),
    apply: args.includes("--apply"),
    status: "inventoried",
    directories: {},
    totals: {
      files: 0,
      bytes: 0,
      missing: 0,
      identical: 0,
      conflicts: 0,
      restored: 0,
      restoredBytes: 0,
    },
    conflicts: [],
  };
  const inventory = [];
  for (const [directory, allowed] of Object.entries(mediaRules)) {
    const sourceDirectory = path.join(source, "data", directory);
    const targetDirectory = path.join(target, "data", directory);
    assertNoLinks(sourceDirectory);
    assertNoLinks(targetDirectory);
    const summary = {
      files: 0,
      bytes: 0,
      missing: 0,
      identical: 0,
      conflicts: 0,
    };
    const files = walk(sourceDirectory).filter(allowed);
    if (!files.length)
      throw new Error(`No runtime media found in ${sourceDirectory}`);
    for (const file of files) {
      const relative = `data/${directory}/${file}`;
      const sourceFile = path.join(source, relative);
      const targetFile = path.join(target, relative);
      assertNoLinks(targetFile);
      const body = readChecked(sourceFile);
      const sourceHash = digest(body);
      const targetHash = fs.existsSync(targetFile)
        ? digest(readChecked(targetFile))
        : null;
      const state =
        targetHash === null
          ? "missing"
          : targetHash === sourceHash
            ? "identical"
            : "conflicts";
      const item = {
        file: relative,
        bytes: body.length,
        sourceHash,
        targetHash,
        state,
      };
      inventory.push(item);
      summary.files += 1;
      summary.bytes += body.length;
      summary[state] += 1;
      if (state === "conflicts") report.conflicts.push(item);
    }
    report.directories[directory] = summary;
    for (const [key, value] of Object.entries(summary))
      report.totals[key] += value;
    console.log(JSON.stringify({ directory, ...summary }));
  }
  report.sourceInventorySha256 = digest(
    JSON.stringify(inventory.map(({ file, sourceHash }) => [file, sourceHash])),
  );
  report.destinationBeforeSha256 = digest(
    JSON.stringify(inventory.map(({ file, targetHash }) => [file, targetHash])),
  );
  // Persist preflight evidence before replacing any existing runtime asset.
  saveReport(reportPath, report);
  console.log(
    JSON.stringify({
      phase: "inventory",
      report: reportPath,
      totals: report.totals,
    }),
  );
  if (!report.apply) return;
  report.status = "restoring";
  saveReport(reportPath, report);
  for (const item of inventory) {
    if (item.state === "identical") continue;
    const sourceFile = path.join(source, item.file);
    const targetFile = path.join(target, item.file);
    const sourceBody = readChecked(sourceFile);
    if (digest(sourceBody) !== item.sourceHash)
      throw new Error(`Source changed after inventory: ${item.file}`);
    ensureParent(targetFile);
    const targetBody = fs.existsSync(targetFile)
      ? readChecked(targetFile)
      : null;
    if ((targetBody === null ? null : digest(targetBody)) !== item.targetHash) {
      throw new Error(`Destination changed after inventory: ${item.file}`);
    }
    if (targetBody !== null) {
      const backup = path.join(
        artifacts,
        "media-backup",
        item.targetHash,
        item.file,
      );
      ensureParent(backup);
      if (fs.existsSync(backup)) {
        if (digest(readChecked(backup)) !== item.targetHash)
          throw new Error(`Existing backup differs: ${backup}`);
      } else fs.writeFileSync(backup, targetBody, { flag: "wx" });
      const metadata = `${backup}.metadata.json`;
      ensureParent(metadata);
      if (!fs.existsSync(metadata)) {
        fs.writeFileSync(
          metadata,
          `${JSON.stringify({ ...item, original: targetFile, backup, reason: "Replace outdated playback asset with authoritative current web media", recordedAt: new Date().toISOString() }, null, 2)}\n`,
          { flag: "wx" },
        );
      }
      item.backup = backup;
    }
    assertNoLinks(targetFile);
    fs.writeFileSync(targetFile, sourceBody, {
      flag: targetBody === null ? "wx" : "w",
    });
    if (digest(readChecked(targetFile)) !== item.sourceHash)
      throw new Error(`Restored hash mismatch: ${item.file}`);
    report.totals.restored += 1;
    report.totals.restoredBytes += item.bytes;
  }
  report.status = "complete";
  report.completedAt = new Date().toISOString();
  saveReport(reportPath, report);
  console.log(
    JSON.stringify({
      phase: "complete",
      report: reportPath,
      totals: report.totals,
    }),
  );
}

main();
