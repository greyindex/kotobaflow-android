const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { PROFILES } = require("./build-profile");

// The local edition's books; options.books names another edition's.
const books = PROFILES.local.books;
const bookFields = {
  lessons: "",
  vocabulary: "vocab-",
  textChunks: "text-",
  wikiReadings: "wiki-",
  grammar: "grammar-",
};
const hash = (body) => crypto.createHash("sha256").update(body).digest("hex");
const isRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value);

function rewriteImages(value) {
  if (typeof value === "string")
    return /^image\/XinBian[1-4]\/[^/]+\.png$/.test(value)
      ? value.replace(/\.png$/, ".webp")
      : value;
  if (Array.isArray(value)) return value.map(rewriteImages);
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rewriteImages(item)]),
    );
  return value;
}

// The indexes are the allow-list: stale chunks and canonical masters are not copied.
// Source bytes must match their content names before any mobile image rewrite.
function collectChunkAssets(root, options = {}) {
  const assets = new Map();
  const visited = new Map();
  const read = (file) => {
    const body = fs.readFileSync(path.join(root, file), "utf8");
    if (body.startsWith("version https://git-lfs.github.com/spec/v1"))
      throw new Error(`Unresolved LFS asset: ${file}`);
    return body;
  };
  const index = (file) => JSON.parse(read(file));
  function chunk(directory, filename, prefix, mobileImages = false) {
    if (
      typeof filename !== "string" ||
      !new RegExp(`^${prefix}[a-f0-9]{64}\\.json$`).test(filename)
    )
      throw new Error(`Invalid chunk reference: ${directory}/${filename}`);
    const relative = `${directory}/${filename}`;
    if (visited.has(relative)) return visited.get(relative);
    const original = read(relative);
    if (`${prefix}${hash(original)}.json` !== filename)
      throw new Error(`Chunk hash mismatch: ${relative}`);
    const value = JSON.parse(original);
    const body =
      mobileImages && options.rewriteImages
        ? JSON.stringify(rewriteImages(value))
        : original;
    const destination = `${prefix}${hash(body)}.json`;
    assets.set(`${directory}/${destination}`, body);
    visited.set(relative, destination);
    return destination;
  }

  const vocabDir = "data/vocab_chunks";
  const vocab = index(`${vocabDir}/index.json`);
  if (
    vocab.version !== 2 ||
    !Array.isArray(vocab.chunks) ||
    !vocab.chunks.length ||
    !Array.isArray(vocab.details)
  )
    throw new Error("Invalid vocabulary chunk index");
  vocab.chunks.forEach((file) => chunk(vocabDir, file, ""));
  vocab.details.forEach((group) => chunk(vocabDir, group.file, "detail-"));
  assets.set(`${vocabDir}/index.json`, JSON.stringify(vocab));

  const grammarDir = "data/grammar_chunks";
  const grammar = index(`${grammarDir}/index.json`);
  if (
    grammar.version !== 1 ||
    !isRecord(grammar.entries) ||
    !Object.keys(grammar.entries).length
  )
    throw new Error("Invalid grammar chunk index");
  Object.values(grammar.entries).forEach((file) => chunk(grammarDir, file, ""));
  assets.set(`${grammarDir}/index.json`, JSON.stringify(grammar));

  const bookDir = "data/textbook/book_chunks";
  (options.books || books).forEach((book) => {
    const catalog = index(`${bookDir}/${book}.json`);
    if (
      catalog.schema !== 1 ||
      catalog.book_id !== book ||
      !Array.isArray(catalog.index?.lessons)
    )
      throw new Error(`Invalid book catalog: ${book}`);
    const lessonIds = new Set(
      catalog.index.lessons.map((lesson) => lesson.lesson_id),
    );
    if (!lessonIds.size || lessonIds.size !== catalog.index.lessons.length)
      throw new Error(`Invalid or duplicate lesson identities: ${book}`);
    Object.entries(bookFields).forEach(([field, prefix]) => {
      if (!isRecord(catalog[field]))
        throw new Error(`Missing book chunk map: ${book}/${field}`);
      catalog.index.lessons.forEach((lesson) => {
        if (!Object.hasOwn(catalog[field], lesson.lesson_id))
          throw new Error(
            `Missing lesson reference: ${book}/${lesson.lesson_id}/${field}`,
          );
      });
      Object.entries(catalog[field]).forEach(([lesson, file]) => {
        if (!lessonIds.has(lesson))
          throw new Error(
            `Unreferenced lesson dependency: ${book}/${lesson}/${field}`,
          );
        catalog[field][lesson] = chunk(bookDir, file, prefix, true);
      });
    });
    assets.set(
      `${bookDir}/${book}.json`,
      JSON.stringify(options.rewriteImages ? rewriteImages(catalog) : catalog),
    );
  });

  const audioDir = "data/textbook/audio_chunks";
  const audio = index(`${audioDir}/index.json`);
  if (
    audio.schema !== 1 ||
    audio.bucketSize !== 256 ||
    !isRecord(audio.chunks) ||
    audio.base !== "./data/gcloud_chirp3_vocab6127_female_aoede_v1/"
  )
    throw new Error("Invalid textbook audio index");
  Object.entries(audio.chunks).forEach(([bucket, file]) => {
    const name = chunk(audioDir, file, "");
    const rows = JSON.parse(assets.get(`${audioDir}/${name}`));
    Object.entries(rows).forEach(([id, url]) => {
      if (
        String(Math.floor(Number(id) / 256)) !== bucket ||
        !/^audio\/[0-9]{2}xxx\/[0-9]{5}\.ogg$/.test(url)
      )
        throw new Error(`Invalid textbook audio URL: ${id}`);
    });
  });
  assets.set(`${audioDir}/index.json`, JSON.stringify(audio));
  return assets;
}

module.exports = { collectChunkAssets, bookFields, books, hash };
