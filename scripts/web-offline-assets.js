const fs = require("node:fs");
const path = require("node:path");
const { hash } = require("./web-chunk-assets");
const { PROFILES } = require("./build-profile");

const MAIN_AUDIO = "data/gcloud_chirp3_vocab12528_female_aoede_v1";
const LEGACY_AUDIO = "data/gcloud_chirp3_vocab6127_female_aoede_v1";
const WORD_AUDIO = "data/kotobaflow_word_audio_v1";
const KANA_AUDIO = "data/gemini38_flash_tts_kotobaflow_kana_candidate_v1";
const UNIT_IMAGES = "data/kotobaflow_unit_images_v1";
const EXAMPLE_AUDIO = "data/example_audio_v1";
const CLASSICS = "data/classics_v1";
const CLASSIC_ID = /^[a-z][a-z0-9_-]{0,31}$/;
const SECTION_AUDIO = [
  [
    "data/gemini38_flash_tts_reading_sections_candidate_v1",
    "XinBian",
    "reading",
  ],
  [
    "data/gemini38_flash_tts_dialogue_sections_candidate_v1",
    "XinBian",
    "dialogue",
  ],
  ["data/kotobaflow_reading_chirp_v1", "KotobaFlow", "reading"],
  ["data/kotobaflow_dialogue_lite_v1", "KotobaFlow", "dialogue"],
];
const DATA_FILES = [
  "domain_taxonomy",
  "semantic_tag_taxonomy",
  "pos",
  "register",
  "transitivity",
  "style",
  "freq_band",
  "grammar_index",
  "grammar_lessons",
].map((name) => `data/${name}.json`);
const NOTICES = [
  "resources/licenses/THIRD_PARTY_NOTICES.md",
  "resources/licenses/CYTOSCAPE-MIT.txt",
  "resources/licenses/theme-palettes.md",
  "resources/provenance/SOURCES.md",
];

function safeRelative(file) {
  if (
    typeof file !== "string" ||
    !file ||
    /[\\?#:\x00]/.test(file) ||
    file.split("/").some((part) => !part || part.startsWith("."))
  )
    throw new Error(`Unsafe runtime path: ${file}`);
  return file;
}

function plainFile(root, file) {
  safeRelative(file);
  const absolute = path.resolve(root, file);
  const resolvedRoot = path.resolve(root);
  if (!absolute.startsWith(resolvedRoot + path.sep))
    throw new Error(`Escaping runtime asset: ${file}`);
  const stat = fs.lstatSync(absolute);
  // realpath resolves every parent component as well, so this also refuses a
  // junction or symlink directory without re-statting every ancestor per OGG.
  if (stat.isSymbolicLink() || fs.realpathSync(absolute) !== absolute)
    throw new Error(`Linked runtime asset: ${file}`);
  if (!stat.isFile()) throw new Error(`Runtime asset is not a file: ${file}`);
  return absolute;
}

function readAsset(root, file) {
  const body = fs.readFileSync(plainFile(root, file));
  if (
    body
      .subarray(0, 42)
      .toString()
      .startsWith("version https://git-lfs.github.com/spec/v1")
  )
    throw new Error(`Unresolved LFS asset: ${file}`);
  return body;
}

// Records packaged files with their hashes; add() checks media signatures and
// any hash a manifest recorded, json() also parses the file it adds.
function assetRecorder(root) {
  const files = new Map();
  function add(file, expectedHash, preloaded) {
    safeRelative(file);
    if (files.has(file)) {
      if (expectedHash && files.get(file).sha256 !== expectedHash)
        throw new Error(`Conflicting manifest hashes: ${file}`);
      return;
    }
    const body = preloaded || readAsset(root, file);
    const digest = hash(body);
    if (
      expectedHash &&
      (!/^[a-f0-9]{64}$/.test(expectedHash) || digest !== expectedHash)
    )
      throw new Error(`Media hash mismatch: ${file}`);
    if (file.endsWith(".ogg") && body.subarray(0, 4).toString() !== "OggS")
      throw new Error(`Invalid OGG asset: ${file}`);
    if (
      file.endsWith(".mp3") &&
      body.subarray(0, 3).toString() !== "ID3" &&
      !(body[0] === 0xff && (body[1] & 0xe0) === 0xe0)
    )
      throw new Error(`Invalid MP3 asset: ${file}`);
    if (
      file.endsWith(".webp") &&
      (body.subarray(0, 4).toString() !== "RIFF" ||
        body.subarray(8, 12).toString() !== "WEBP")
    )
      throw new Error(`Invalid WebP asset: ${file}`);
    files.set(file, { bytes: body.length, sha256: digest });
  }
  function json(file) {
    add(file);
    return JSON.parse(readAsset(root, file));
  }
  return { files, add, json };
}

// A dependency graph, not a recursive data-directory copy. All binary hashes are
// captured before preparing www; manifests with known hashes are also verified.
// The profile names the edition's books, section audio and classics.
function collectOfflineAssets(root, chunks, profile = PROFILES.local) {
  const { files, add, json } = assetRecorder(root);
  DATA_FILES.concat(NOTICES).forEach((file) => add(file));
  // Keep the full stable numeric vocabulary audio namespace for old saved IDs.
  for (let index = 1; index <= 12528; index++) {
    const name = String(index).padStart(5, "0");
    add(`${MAIN_AUDIO}/audio/${name.slice(0, 2)}xxx/${name}.ogg`);
  }
  const audioIndex = JSON.parse(
    chunks.get("data/textbook/audio_chunks/index.json"),
  );
  const audioIds = new Set();
  for (const file of Object.values(audioIndex.chunks)) {
    const rows = JSON.parse(chunks.get(`data/textbook/audio_chunks/${file}`));
    for (const [id, relative] of Object.entries(rows)) {
      add(`${LEGACY_AUDIO}/${relative}`);
      audioIds.add(Number(id));
    }
  }
  const lessons = new Set();
  const courseWords = new Map();
  const bookDir = "data/textbook/book_chunks";
  const imageReferences = new Set();
  function imageRefs(value) {
    if (typeof value === "string" && /^image\//.test(value)) {
      if (!/^image\/XinBian[1-4]\/[^/]+\.webp$/.test(value))
        throw new Error(`Unexpected mobile image reference: ${value}`);
      imageReferences.add(value);
    } else if (value && typeof value === "object")
      Object.values(value).forEach(imageRefs);
  }
  for (const [file, body] of chunks) {
    if (file.startsWith(bookDir + "/")) imageRefs(JSON.parse(body));
  }
  for (const book of profile.books) {
    const catalog = JSON.parse(chunks.get(`${bookDir}/${book}.json`));
    for (const entry of catalog.index.lessons) {
      const key = `${book}/${entry.lesson_id}`;
      lessons.add(key);
      if (book.startsWith("XinBian")) {
        const auto =
          entry.review_unit_no == null
            ? String(entry.lesson_no)
            : `r${entry.review_unit_no}`;
        imageReferences.add(`image/${book}/${auto}.webp`);
      }
      const rows = JSON.parse(
        chunks.get(`${bookDir}/${catalog.vocabulary[entry.lesson_id]}`),
      );
      if (!Array.isArray(rows))
        throw new Error(`Invalid lesson vocabulary: ${key}`);
      for (const row of rows) {
        if (
          row.vocab_audio_index != null &&
          !audioIds.has(row.vocab_audio_index)
        )
          throw new Error(
            `Missing vocabulary audio mapping: ${key}/${row.index}`,
          );
        if (book.startsWith("KotobaFlow"))
          courseWords.set(`${key}/${row.index}`, row);
      }
    }
  }
  const wordIndex = json(`${WORD_AUDIO}/words.json`);
  if (
    wordIndex.schema !== 1 ||
    !wordIndex.words ||
    wordIndex.count !== Object.keys(wordIndex.words).length
  )
    throw new Error("Invalid KotobaFlow word audio index");
  for (const [key, entry] of Object.entries(wordIndex.words)) {
    if (
      !courseWords.has(key) ||
      !/^(audio|legacy)\/[0-9]{2}xxx\/[0-9]{5}\.ogg$/.test(entry.file)
    )
      throw new Error(`Unexpected KotobaFlow word audio: ${key}`);
    add(`${WORD_AUDIO}/${entry.file}`, entry.sha256);
  }
  for (const [key, row] of courseWords) {
    if (row.vocab_audio_index == null && !wordIndex.words[key])
      throw new Error(`Lesson word has no offline audio: ${key}`);
  }
  const sectionCounts = {};
  for (const [directory, family, kind] of SECTION_AUDIO) {
    if (!profile.sectionFamilies.includes(family)) continue;
    const manifest = `${directory}/manifest.jsonl`;
    add(manifest);
    const rows = readAsset(root, manifest)
      .toString("utf8")
      .trim()
      .split(/\r?\n/)
      .map(JSON.parse);
    const seen = new Set();
    for (const row of rows) {
      const key = `${row.book}/${row.lesson_id}`;
      const sectionKey = `${key}/${row.section_key}`;
      if (
        row.status !== "ok" ||
        !row.book.startsWith(family) ||
        !lessons.has(key) ||
        seen.has(sectionKey)
      )
        throw new Error(`Invalid or duplicate audio section: ${sectionKey}`);
      seen.add(sectionKey);
      const output = String(row.output).replace(/\.wav$/, ".ogg");
      if (
        !output.startsWith(`${directory}/${row.book}/`) ||
        !output.endsWith(".ogg")
      )
        throw new Error(`Invalid section audio path: ${output}`);
      add(output, row.ogg_sha256);
      if (row.manifest) {
        if (
          !row.manifest.startsWith(`${directory}/${row.book}/`) ||
          !row.manifest.endsWith("/manifest.json")
        )
          throw new Error(`Invalid section timing path: ${row.manifest}`);
        const timing = json(row.manifest);
        if (family === "KotobaFlow") {
          const intervals =
            kind === "dialogue" ? timing.turns : timing.sentence_intervals;
          if (
            !Array.isArray(intervals) ||
            !intervals.length ||
            !Number.isFinite(timing.duration_sec)
          )
            throw new Error(`Missing section intervals: ${row.manifest}`);
          intervals.forEach((interval) => {
            if (!(
              interval.start_sec >= 0 &&
              interval.end_sec > interval.start_sec &&
              interval.end_sec <= timing.duration_sec + 0.05
            ))
              throw new Error(`Invalid section interval: ${row.manifest}`);
          });
        }
      } else if (kind === "dialogue" || family === "KotobaFlow") {
        throw new Error(`Missing section timing: ${sectionKey}`);
      }
    }
    if (family === "KotobaFlow") {
      for (const lesson of lessons) {
        if (!lesson.startsWith("KotobaFlow") || lesson.endsWith("/lesson_00"))
          continue;
        for (const section of kind === "reading"
          ? ["body", "application"]
          : ["conversation"])
          if (!seen.has(`${lesson}/${section}`))
            throw new Error(
              `Missing course audio section: ${lesson}/${section}`,
            );
      }
    }
    sectionCounts[directory] = rows.length;
  }
  const kana = json(`${KANA_AUDIO}/clips.json`);
  const kanaIds = new Set();
  if (kana.schema !== 1 || kana.chapter !== 0 || !Array.isArray(kana.clips))
    throw new Error("Invalid kana index");
  for (const clip of kana.clips) {
    if (
      !/^C00-[KW](0[1-9]|[1-3][0-9]|4[0-6])$/.test(clip.id) ||
      kanaIds.has(clip.id) ||
      clip.audio_relpath !== `clips/${clip.id}.ogg`
    )
      throw new Error(`Invalid kana clip: ${clip.id}`);
    kanaIds.add(clip.id);
    add(`${KANA_AUDIO}/${clip.audio_relpath}`, clip.audio_sha256);
  }
  if (kanaIds.size !== 92)
    throw new Error("Chapter 0 requires all 92 offline clips");
  const images = json(`${UNIT_IMAGES}/images.json`);
  if (
    images.schema !== 1 ||
    images.count !== 76 ||
    Object.keys(images.images || {}).length !== 76
  )
    throw new Error("Expected all 76 KotobaFlow lesson images");
  for (const [key, entry] of Object.entries(images.images)) {
    if (!lessons.has(key) || entry.file !== `${key}.webp`)
      throw new Error(`Unexpected lesson image: ${key}`);
    add(`${UNIT_IMAGES}/${entry.file}`, entry.webp_sha256);
  }
  const exampleAudio = collectExampleAudio(root, { add, json });
  const classics = profile.classics
    ? collectClassics({ files, add, json })
    : null;
  return {
    files,
    imageReferences,
    counts: {
      books: profile.books.length,
      lessons: lessons.size,
      courseWords: courseWords.size,
      kana: kanaIds.size,
      unitImages: images.count,
      sections: sectionCounts,
      exampleAudio,
      classics,
    },
  };
}

function shardOf(key, bits) {
  return Math.floor(parseInt(key, 16) / Math.pow(2, 53 - bits));
}

// Example sentences play from packed OGG files by byte range
// (js/core/example-audio.js). Each clip an index shard lists must sit in the
// right shard, inside its pack, and start an Ogg page; unreferenced packs
// stay out of the package.
function collectExampleAudio(root, { add, json }) {
  const index = json(`${EXAMPLE_AUDIO}/index.json`);
  if (
    index.schema !== 1 ||
    index.hash !== "cyrb53-v1" ||
    !Number.isInteger(index.shardBits) ||
    index.shardBits < 0 ||
    index.shardBits > 12 ||
    !Array.isArray(index.shards) ||
    index.shards.length !== 2 ** index.shardBits ||
    !Array.isArray(index.packs) ||
    !index.packs.length
  )
    throw new Error("Invalid example audio index");
  index.packs.forEach((pack) => {
    if (!/^packs\/[0-9a-f]{16}\.ogg$/.test(pack))
      throw new Error(`Unexpected example audio pack: ${pack}`);
  });
  const clipsByPack = new Map();
  const shards = new Set();
  let clips = 0;
  index.shards.forEach((shard, position) => {
    if (
      !/^shards\/[0-9a-f]{2,3}-[0-9a-f]{12}\.json$/.test(shard) ||
      shards.has(shard)
    )
      throw new Error(`Unexpected example audio shard: ${shard}`);
    shards.add(shard);
    const rows = json(`${EXAMPLE_AUDIO}/${shard}`);
    for (const [key, entry] of Object.entries(rows)) {
      if (
        !/^[0-9a-f]{14}$/.test(key) ||
        shardOf(key, index.shardBits) !== position ||
        !Array.isArray(entry) ||
        entry.length !== 3 ||
        !index.packs[entry[0]] ||
        !Number.isInteger(entry[1]) ||
        !Number.isInteger(entry[2]) ||
        entry[1] < 0 ||
        entry[2] <= 0
      )
        throw new Error(`Invalid example audio entry: ${shard}/${key}`);
      if (!clipsByPack.has(entry[0])) clipsByPack.set(entry[0], []);
      clipsByPack.get(entry[0]).push([key, entry[1], entry[2]]);
      clips += 1;
    }
  });
  if (clips !== index.clips || clips !== index.keys)
    throw new Error("Example audio index counts do not match its shards");
  for (const [packIndex, packClips] of clipsByPack) {
    const file = `${EXAMPLE_AUDIO}/${index.packs[packIndex]}`;
    const body = readAsset(root, file);
    for (const [key, offset, length] of packClips) {
      if (
        offset + length > body.length ||
        body.subarray(offset, offset + 4).toString("latin1") !== "OggS"
      )
        throw new Error(`Damaged example audio clip: ${key}`);
    }
    add(file, null, body);
  }
  return { clips, packs: clipsByPack.size };
}

// The local classics library (js/classics/library.js): catalog, each work's
// index and parts, and the narrations of the works that have one.
function collectClassics({ files, add, json }) {
  const catalog = json(`${CLASSICS}/catalog.json`);
  if (
    catalog.schema !== 1 ||
    !Array.isArray(catalog.books) ||
    !catalog.books.length
  )
    throw new Error("Invalid classics catalog");
  const works = new Set();
  let parts = 0;
  let narrations = 0;
  for (const book of catalog.books) {
    const id = book && book.id;
    if (!CLASSIC_ID.test(id) || works.has(id) || !(book.parts > 0))
      throw new Error(`Invalid classic in catalog: ${id}`);
    works.add(id);
    const index = json(`${CLASSICS}/${id}/index.json`);
    if (
      index.schema !== 1 ||
      index.id !== id ||
      !Array.isArray(index.parts) ||
      index.parts.length !== book.parts
    )
      throw new Error(`Invalid classic index: ${id}`);
    index.parts.forEach((entry, position) => {
      if (
        !entry ||
        entry.n !== position + 1 ||
        !/^[0-9]{2,3}\.json$/.test(entry.file)
      )
        throw new Error(`Invalid classic part entry: ${id}/${position + 1}`);
      const part = json(`${CLASSICS}/${id}/${entry.file}`);
      if (
        part.schema !== 1 ||
        part.book !== id ||
        part.part !== position + 1 ||
        !Array.isArray(part.units)
      )
        throw new Error(`Invalid classic part: ${id}/${entry.file}`);
      parts += 1;
    });
    if (index.audio) {
      if (!/^[a-z0-9_-]{1,32}\.(?:mp3|ogg|m4a)$/.test(index.audio.file))
        throw new Error(`Unexpected classic narration: ${id}`);
      const file = `${CLASSICS}/${id}/${index.audio.file}`;
      add(file);
      if (files.get(file).bytes !== index.audio.bytes)
        throw new Error(`Classic narration size changed: ${file}`);
      narrations += 1;
    }
    if (!!index.audio !== !!book.audio)
      throw new Error(`Classic narration flag disagrees: ${id}`);
  }
  return { works: works.size, parts, narrations };
}

module.exports = {
  assetRecorder,
  collectExampleAudio,
  collectClassics,
  collectOfflineAssets,
  readAsset,
  plainFile,
  safeRelative,
  DATA_FILES,
  NOTICES,
};
