const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { hash } = require("./web-chunk-assets");
const { readAsset } = require("./web-offline-assets");

// The web packs clips for every example its recording batch held, and the
// page only asks for the texts it shows. Some packed texts are no longer
// shown: rewritten examples, and the examples of duplicate word entries the
// loader hides (js/loader.js _hideDuplicateWordReadings). The mobile package
// keeps a clip only when its text key matches a string in a packaged data
// file, then repacks the kept clips byte-for-byte in the web's own format
// (tools/build_example_audio_packs.cjs: 5 MiB packs, content-named packs and
// shards, sorted shard keys). Clips stay in their original order.
const EXAMPLE_AUDIO = "data/example_audio_v1";
const PACK_BYTES = 5 * 1024 * 1024;

function exampleKeys(root) {
  const context = { window: {} };
  vm.runInNewContext(
    readAsset(root, "js/core/example-audio.js").toString("utf8"),
    context,
  );
  const keys = context.window.JPLearn && context.window.JPLearn.exampleAudio;
  if (!keys || keys.HASH !== "cyrb53-v1" || typeof keys.textKey !== "function")
    throw new Error("Unexpected example audio key functions");
  return keys;
}

// Every string in the packaged data files, as example text keys. A data file
// is any packaged JSON under data/ except the example audio index itself.
function packagedTextKeys(keys, bodies) {
  const found = new Set();
  const visit = (value) => {
    if (typeof value === "string") {
      const key = keys.textKey(value);
      if (key) found.add(key);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object")
      Object.values(value).forEach(visit);
  };
  for (const body of bodies) visit(JSON.parse(body));
  return found;
}

function isTextData(file) {
  return (
    file.startsWith("data/") &&
    file.endsWith(".json") &&
    !file.startsWith(`${EXAMPLE_AUDIO}/`)
  );
}

// Clips of an already validated index (collectExampleAudio), in pack order.
function readClips(root) {
  const index = JSON.parse(readAsset(root, `${EXAMPLE_AUDIO}/index.json`));
  const clips = new Map();
  index.shards.forEach((shard) => {
    const rows = JSON.parse(readAsset(root, `${EXAMPLE_AUDIO}/${shard}`));
    for (const [key, [pack, offset, length]] of Object.entries(rows)) {
      const id = `${pack}:${offset}`;
      if (!clips.has(id)) clips.set(id, { pack, offset, length, keys: [] });
      const clip = clips.get(id);
      if (clip.length !== length)
        throw new Error(`Example audio keys disagree on a clip: ${key}`);
      clip.keys.push(key);
    }
  });
  const ordered = [...clips.values()].sort(
    (a, b) => a.pack - b.pack || a.offset - b.offset,
  );
  return { index, clips: ordered };
}

function pruneExampleAudio(root, textKeys) {
  const keys = exampleKeys(root);
  const { index, clips } = readClips(root);
  const packBodies = new Map();
  const body = (pack) => {
    if (!packBodies.has(pack))
      packBodies.set(
        pack,
        readAsset(root, `${EXAMPLE_AUDIO}/${index.packs[pack]}`),
      );
    return packBodies.get(pack);
  };
  const files = new Map();
  const packs = [];
  const entries = new Map();
  let parts = [];
  let size = 0;
  let removed = 0;
  let removedBytes = 0;
  function close() {
    if (!parts.length) return;
    const content = Buffer.concat(parts.map((part) => part.buffer));
    const name = `packs/${hash(content).slice(0, 16)}.ogg`;
    files.set(`${EXAMPLE_AUDIO}/${name}`, content);
    for (const part of parts)
      for (const key of part.keys)
        entries.set(key, [packs.length, part.offset, part.buffer.length]);
    packs.push(name);
    parts = [];
    size = 0;
  }
  for (const clip of clips) {
    const kept = clip.keys.filter((key) => textKeys.has(key));
    if (!kept.length) {
      removed += 1;
      removedBytes += clip.length;
      continue;
    }
    const buffer = body(clip.pack).subarray(
      clip.offset,
      clip.offset + clip.length,
    );
    if (
      buffer.length !== clip.length ||
      buffer.toString("latin1", 0, 4) !== "OggS"
    )
      throw new Error(`Damaged example audio clip: ${kept[0]}`);
    if (size + buffer.length > PACK_BYTES) close();
    parts.push({ keys: kept, buffer, offset: size });
    size += buffer.length;
  }
  close();
  const count = 2 ** index.shardBits;
  const shards = Array.from({ length: count }, () => ({}));
  for (const key of [...entries.keys()].sort())
    shards[keys.shardOf(key, index.shardBits)][key] = entries.get(key);
  const width = String(count - 1).length;
  const shardNames = shards.map((shard, position) => {
    const content = JSON.stringify(shard);
    const name = `shards/${String(position).padStart(width, "0")}-${hash(content).slice(0, 12)}.json`;
    files.set(`${EXAMPLE_AUDIO}/${name}`, content);
    return name;
  });
  const kept = clips.length - removed;
  files.set(
    `${EXAMPLE_AUDIO}/index.json`,
    JSON.stringify({
      schema: 1,
      hash: index.hash,
      shardBits: index.shardBits,
      clips: kept,
      keys: entries.size,
      packs,
      shards: shardNames,
    }),
  );
  return {
    files,
    pruning: {
      sourceClips: clips.length,
      sourcePacks: index.packs.length,
      keptClips: kept,
      keptPacks: packs.length,
      removedClips: removed,
      removedBytes,
    },
  };
}

// Independent check of a packaged result: every packaged key is a source key
// whose text is in the packaged data, every such source key is packaged, and
// each packaged clip has exactly the source clip's bytes.
function verifyPrunedExampleAudio(sourceRoot, packageRoot, textKeys) {
  const read = (root) => {
    const { index, clips } = readClips(root);
    const byKey = new Map();
    for (const clip of clips)
      for (const key of clip.keys)
        byKey.set(key, { ...clip, file: index.packs[clip.pack] });
    return { byKey, clips: clips.length };
  };
  const source = read(sourceRoot);
  const packaged = read(packageRoot);
  // In source pack order, so each root keeps only its current pack in memory.
  const expected = [...source.byKey.keys()].filter((key) => textKeys.has(key));
  if (
    expected.length !== packaged.byKey.size ||
    expected.some((key) => !packaged.byKey.has(key))
  )
    throw new Error("Packaged example clips differ from the shown examples");
  const reader = (root) => {
    let file = null;
    let body = null;
    return (clip) => {
      if (clip.file !== file) {
        file = clip.file;
        body = readAsset(root, `${EXAMPLE_AUDIO}/${file}`);
      }
      return body.subarray(clip.offset, clip.offset + clip.length);
    };
  };
  const fromSource = reader(sourceRoot);
  const fromPackage = reader(packageRoot);
  for (const key of expected)
    if (
      !fromSource(source.byKey.get(key)).equals(
        fromPackage(packaged.byKey.get(key)),
      )
    )
      throw new Error(`Packaged example clip bytes changed: ${key}`);
  return {
    sourceClips: source.clips,
    keptClips: packaged.clips,
    removedClips: source.clips - packaged.clips,
  };
}

module.exports = {
  EXAMPLE_AUDIO,
  exampleKeys,
  isTextData,
  packagedTextKeys,
  pruneExampleAudio,
  verifyPrunedExampleAudio,
};
