const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { collectChunkAssets, hash } = require("./web-chunk-assets");
const { collectOfflineAssets, readAsset } = require("./web-offline-assets");
const {
  publicStaging,
  webRoot: webCopy,
  RUNTIME_FILES,
  lazyShellReferences,
  injectRuntime,
  shellReferences,
  transformRuntimeSource,
} = require("./prepare-web");
const {
  transformIndex,
  EXCLUDED_ASSETS,
  OFFLINE_CSP,
} = require("./mobile-offline-transform");
const { PROFILES, receiptPath, profileOfReceipt } = require("./build-profile");
const {
  EXAMPLE_AUDIO,
  exampleKeys,
  isTextData,
  packagedTextKeys,
  verifyPrunedExampleAudio,
} = require("./example-audio-prune");

// What each edition holds at the current port baseline.
const EXPECTED = {
  local: {
    curriculum: { books: 8, lessons: 153, courseWords: 6518 },
    exampleSource: 41827,
    exampleAudio: { clips: 35616, packs: 80 },
    classics: { works: 6, parts: 152, narrations: 2 },
  },
  public: {
    curriculum: { books: 4, lessons: 77, courseWords: 6518 },
    exampleSource: 35491,
    exampleAudio: { clips: 35491, packs: 80 },
    classics: { works: 6, parts: 152, narrations: 2 },
  },
};

function verifyWeb() {
  const root = path.resolve(__dirname, "..");
  const webRoot = path.join(root, "www");
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  assert.equal(receipt.schema, 1);
  const profile = profileOfReceipt(receipt);
  const expectedCounts = EXPECTED[profile.edition];
  // The public edition is packaged from the web copy's public staging.
  const sourceRoot = profile.edition === "public" ? publicStaging : webCopy;
  assert.equal(
    receipt.sourceRoot,
    sourceRoot,
    "The package was prepared from another source",
  );
  const index = readAsset(webRoot, "index.html").toString("utf8");
  const expectedIndex = injectRuntime(
    transformIndex(readAsset(sourceRoot, "index.html").toString("utf8")),
  );
  assert.equal(
    index,
    expectedIndex,
    "Mobile index differs from the current offline transform",
  );
  assert.ok(
    index.includes(OFFLINE_CSP),
    "Missing offline Content Security Policy",
  );
  assert.ok(
    index.indexOf("js/mobile-platform.js") < index.indexOf("js/theme.js"),
    "Native theme bridge must load first",
  );
  for (const file of RUNTIME_FILES.keys())
    assert.equal(
      index.split(`./${file}?`).length - 1,
      1,
      `Mobile runtime file is not referenced exactly once: ${file}`,
    );
  assert.ok(
    index.indexOf("js/mobile-shell.js") < index.indexOf("js/mobile-native.js"),
    "Mobile native bridge must load after the mobile shell",
  );
  for (const file of [...EXCLUDED_ASSETS, "sw-manifest.js"])
    assert.equal(
      fs.existsSync(path.join(webRoot, file)),
      false,
      `Online/PWA asset was packaged: ${file}`,
    );
  const chunks = collectChunkAssets(webRoot, { books: profile.books });
  const expectedChunks = collectChunkAssets(sourceRoot, {
    rewriteImages: true,
    books: profile.books,
  });
  assert.deepEqual(
    chunks,
    expectedChunks,
    `Packaged chunks differ from the current ${profile.edition} source graph`,
  );
  const media = collectOfflineAssets(webRoot, chunks, profile);
  assert.deepEqual(
    media.counts,
    receipt.counts,
    "Curriculum inventory changed since preparation",
  );
  assert.deepEqual(
    {
      books: media.counts.books,
      lessons: media.counts.lessons,
      courseWords: media.counts.courseWords,
    },
    expectedCounts.curriculum,
    `The ${profile.edition} curriculum is incomplete`,
  );
  assert.deepEqual(
    {
      exampleAudio: media.counts.exampleAudio,
      classics: media.counts.classics,
    },
    {
      exampleAudio: expectedCounts.exampleAudio,
      classics: expectedCounts.classics,
    },
    "Example sentence audio or the classics library is incomplete",
  );
  const expected = new Set([
    "index.html",
    ...chunks.keys(),
    ...media.files.keys(),
    ...media.imageReferences,
  ]);
  const runtime = RUNTIME_FILES;
  for (const file of lazyShellReferences(sourceRoot)) {
    expected.add(file);
    assert.equal(
      hash(readAsset(webRoot, file)),
      hash(readAsset(sourceRoot, file)),
      `Stale or changed lazy shell file: ${file}`,
    );
  }
  for (const file of shellReferences(index)) {
    expected.add(file);
    let body = readAsset(
      runtime.has(file) ? root : sourceRoot,
      runtime.get(file) || file,
    );
    body = Buffer.from(
      transformRuntimeSource(file, body.toString("utf8"), sourceRoot),
    );
    assert.equal(
      hash(readAsset(webRoot, file)),
      hash(body),
      `Stale or changed shell file: ${file}`,
    );
  }
  // Match every packaged dependency to the source, not merely a minimum count
  // or two sample recordings. Indexed course media additionally prove their
  // recorded SHA-256 in collectOfflineAssets. The public staging only leaves
  // files out, so its media must also be the web copy's own bytes.
  // Example clips are repacked: the kept set is exactly the source clips
  // whose text a packaged data file holds, each with the source clip's bytes.
  const texts = packagedTextKeys(
    exampleKeys(webRoot),
    [...expected].filter(isTextData).map((file) => readAsset(webRoot, file)),
  );
  for (const from of new Set([sourceRoot, webCopy]))
    assert.deepEqual(
      {
        ...verifyPrunedExampleAudio(from, webRoot, texts),
        keptPacks: media.counts.exampleAudio.packs,
      },
      {
        sourceClips: receipt.examplePruning.sourceClips,
        keptClips: receipt.examplePruning.keptClips,
        removedClips: receipt.examplePruning.removedClips,
        keptPacks: receipt.examplePruning.keptPacks,
      },
      "Example sentence clips differ from the shown examples",
    );
  assert.equal(
    receipt.examplePruning.sourceClips,
    expectedCounts.exampleSource,
    "The web example audio index changed",
  );
  for (const [file, metadata] of media.files) {
    if (file.startsWith(`${EXAMPLE_AUDIO}/`)) continue;
    for (const from of new Set([sourceRoot, webCopy]))
      assert.equal(
        metadata.sha256,
        hash(readAsset(from, file)),
        `Copied source bytes changed: ${file}`,
      );
  }
  for (const file of media.imageReferences) {
    const image = readAsset(webRoot, file);
    assert.equal(
      image.subarray(0, 4).toString(),
      "RIFF",
      `Invalid mobile image: ${file}`,
    );
    assert.equal(
      image.subarray(8, 12).toString(),
      "WEBP",
      `Invalid mobile image: ${file}`,
    );
  }
  const actual = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      assert.equal(entry.isSymbolicLink(), false, "Linked packaged file");
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else actual.push(path.relative(webRoot, full).split(path.sep).join("/"));
    }
  }
  walk(webRoot);
  assert.deepEqual(
    actual.sort(),
    [...expected].sort(),
    "Packaged files contain missing, stale, private or unreferenced assets",
  );
  assert.deepEqual(
    actual,
    Object.keys(receipt.files).sort(),
    "Integrity receipt does not describe this package",
  );
  for (const file of actual) {
    const body = readAsset(webRoot, file);
    assert.equal(
      hash(body),
      receipt.files[file].sha256,
      `Integrity receipt mismatch: ${file}`,
    );
    assert.equal(
      body.length,
      receipt.files[file].bytes,
      `Size receipt mismatch: ${file}`,
    );
  }
  const contentConfig = readAsset(webRoot, "js/content-config.js").toString(
    "utf8",
  );
  if (profile.edition === "public") {
    // Nothing the web's release policy withholds, and the web's own public
    // switch for the offered books (the classics stay on, DF-23).
    const policy = JSON.parse(
      readAsset(webCopy, "resources/licenses/public-release-policy.json"),
    );
    const withheld = actual.filter(
      (file) =>
        /XinBian/i.test(file) ||
        policy.blockedPaths.some((p) => file === p || file.startsWith(p + "/")),
    );
    assert.deepEqual(
      withheld,
      [],
      "The public edition packaged withheld files",
    );
    const { publicContentConfig } = require(
      path.join(webCopy, "tools", "build_public_release.cjs"),
    );
    assert.equal(
      contentConfig,
      publicContentConfig(
        readAsset(webCopy, "js/content-config.js").toString("utf8"),
      ),
      "The public edition must use the web's public content switch",
    );
  }
  const context = { window: {} };
  vm.runInNewContext(contentConfig, context);
  for (const book of PROFILES.local.books)
    assert.equal(
      context.window.JPLearn.textbooks.isOffered(book),
      profile.books.includes(book),
      `${book} is wrongly offered or hidden in the ${profile.edition} edition`,
    );
  assert.equal(
    context.window.JPLearn.textbooks.classicsOffered(),
    profile.classics,
    `The classics switch is wrong for the ${profile.edition} edition`,
  );
  const ogg = actual.filter((file) => file.endsWith(".ogg")).length;
  const bytes = Object.values(receipt.files).reduce(
    (sum, file) => sum + file.bytes,
    0,
  );
  const { curriculum, exampleAudio, classics } = expectedCounts;
  console.log(
    `Mobile verification passed (${profile.edition} edition): ${actual.length} exact dependencies, ${chunks.size} content-addressed chunks, ${ogg} OGG, ${(bytes / 1048576).toFixed(1)} MiB.`,
  );
  console.log(
    `${curriculum.books} books / ${curriculum.lessons} lessons retained, all ${curriculum.courseWords.toLocaleString("en")} KotobaFlow word rows have offline audio, 92 kana clips and 76 theme images verified.`,
  );
  console.log(
    `${exampleAudio.clips.toLocaleString("en")} example sentence clips in ${exampleAudio.packs} packs verified; ` +
      `${classics.works} classics (${classics.parts} parts, ${classics.narrations} narrations) verified` +
      (profile.edition === "public"
        ? "; no XinBian files, and only the four KotobaFlow books offered."
        : "."),
  );
  return { files: actual.length, ogg, bytes, counts: media.counts };
}

if (require.main === module) verifyWeb();
module.exports = { verifyWeb };
