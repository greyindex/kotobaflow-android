const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  collectChunkAssets,
  bookFields,
  books: offeredBooks,
} = require("./web-chunk-assets");

function fixture(t, audioUrl = "audio/00xxx/00001.ogg") {
  const parent = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, "kotobaflow-chunks-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), parent);
    assert.ok(path.basename(root).startsWith("kotobaflow-chunks-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  function write(relative, value) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, JSON.stringify(value));
  }
  function chunk(directory, value, prefix = "") {
    const body = JSON.stringify(value);
    const name =
      prefix + crypto.createHash("sha256").update(body).digest("hex") + ".json";
    write(`${directory}/${name}`, value);
    return name;
  }
  const vocab = "data/vocab_chunks";
  write(`${vocab}/index.json`, {
    version: 2,
    chunks: [chunk(vocab, { keys: ["word"], values: ["そこ"], rows: [[0]] })],
    details: [
      {
        file: chunk(vocab, { 1: { example_sentences: [] } }, "detail-"),
        indexes: [1],
      },
    ],
  });
  const grammar = "data/grammar_chunks";
  write(`${grammar}/index.json`, {
    version: 1,
    entries: { point: chunk(grammar, { point: {} }) },
  });
  const books = {};
  for (const book of offeredBooks) {
    const catalog = {
      schema: 1,
      book_id: book,
      index: { lessons: [{ lesson_id: "lesson_01" }] },
    };
    for (const [field, prefix] of Object.entries(bookFields)) {
      const value =
        field === "lessons" && book.startsWith("XinBian")
          ? { image: `image/${book}/p1.png` }
          : [];
      catalog[field] = {
        lesson_01: chunk("data/textbook/book_chunks", value, prefix),
      };
    }
    write(`data/textbook/book_chunks/${book}.json`, catalog);
    books[book] = catalog;
  }
  const audio = "data/textbook/audio_chunks";
  write(`${audio}/index.json`, {
    schema: 1,
    bucketSize: 256,
    base: "./data/gcloud_chirp3_vocab6127_female_aoede_v1/",
    chunks: { 0: chunk(audio, { 1: audioUrl }) },
  });
  return { root, write, books };
}

test("mobile image rewriting renames chunks, updates catalogs, and leaves source bytes intact", (t) => {
  const { root, write, books } = fixture(t);
  write("data/vocab_chunks/obsolete.json", { mustNotShip: true });
  const sourceName = books.XinBian1.lessons.lesson_01;
  const original = fs.readFileSync(
    path.join(root, "data/textbook/book_chunks", sourceName),
    "utf8",
  );
  const assets = collectChunkAssets(root, { rewriteImages: true });
  const catalog = JSON.parse(
    assets.get("data/textbook/book_chunks/XinBian1.json"),
  );
  assert.notEqual(catalog.lessons.lesson_01, sourceName);
  assert.match(
    assets.get("data/textbook/book_chunks/" + catalog.lessons.lesson_01),
    /p1\.webp/,
  );
  assert.equal(
    fs.readFileSync(
      path.join(root, "data/textbook/book_chunks", sourceName),
      "utf8",
    ),
    original,
  );
  assert.equal(assets.has("data/vocab_chunks/obsolete.json"), false);
  const output = path.join(root, "output");
  for (const [file, body] of assets) {
    fs.mkdirSync(path.dirname(path.join(output, file)), { recursive: true });
    fs.writeFileSync(path.join(output, file), body);
  }
  assert.deepEqual(collectChunkAssets(output), assets);
});

for (const field of Object.keys(bookFields)) {
  test(`missing ${field} chunk blocks packaging`, (t) => {
    const { root, books } = fixture(t);
    fs.unlinkSync(
      path.join(
        root,
        "data/textbook/book_chunks",
        books.XinBian1[field].lesson_01,
      ),
    );
    assert.throws(() => collectChunkAssets(root), /ENOENT/);
  });
}

test("changed bytes under an existing content hash block packaging", (t) => {
  const { root, books } = fixture(t);
  fs.appendFileSync(
    path.join(
      root,
      "data/textbook/book_chunks",
      books.XinBian1.lessons.lesson_01,
    ),
    " ",
  );
  assert.throws(() => collectChunkAssets(root), /hash mismatch/);
});

test("a catalog cannot silently omit a lesson dependency", (t) => {
  const { root, write, books } = fixture(t);
  delete books.XinBian1.textChunks.lesson_01;
  write("data/textbook/book_chunks/XinBian1.json", books.XinBian1);
  assert.throws(() => collectChunkAssets(root), /Missing lesson reference/);
});

test("chunk indexes cannot escape their allow-listed directory", (t) => {
  const { root, write, books } = fixture(t);
  books.XinBian1.lessons.lesson_01 = "../user_progress.json";
  write("data/textbook/book_chunks/XinBian1.json", books.XinBian1);
  assert.throws(() => collectChunkAssets(root), /Invalid chunk reference/);
});

test("textbook audio chunks only point to the approved OGG layout", (t) => {
  const { root } = fixture(t, "audio/00xxx/00001.wav");
  assert.throws(() => collectChunkAssets(root), /Invalid textbook audio URL/);
});

test("the local mobile profile retains all eight catalogs and new course dependencies", (t) => {
  const { root } = fixture(t);
  const assets = collectChunkAssets(root);
  assert.equal(offeredBooks.length, 8);
  for (const book of offeredBooks)
    assert.ok(assets.has(`data/textbook/book_chunks/${book}.json`));
  fs.unlinkSync(path.join(root, "data/textbook/book_chunks/KotobaFlow4.json"));
  assert.throws(() => collectChunkAssets(root), /ENOENT/);
});

test("the public profile packages only the four KotobaFlow catalogs", (t) => {
  const { PROFILES } = require("./build-profile");
  const { root } = fixture(t);
  // The web's public staging has no XinBian catalogs at all.
  for (const book of offeredBooks.filter((id) => id.startsWith("XinBian")))
    fs.unlinkSync(path.join(root, `data/textbook/book_chunks/${book}.json`));
  assert.throws(() => collectChunkAssets(root), /ENOENT/);
  const assets = collectChunkAssets(root, {
    rewriteImages: true,
    books: PROFILES.public.books,
  });
  const catalogs = [...assets.keys()].filter((file) =>
    /^data\/textbook\/book_chunks\/[A-Za-z]+[0-9]\.json$/.test(file),
  );
  assert.deepEqual(
    catalogs.sort(),
    PROFILES.public.books.map(
      (book) => `data/textbook/book_chunks/${book}.json`,
    ),
  );
  assert.ok(![...assets.values()].some((body) => body.includes("XinBian")));
});

test("package editions are named explicitly and read back from the receipt", () => {
  const {
    PROFILES,
    profileFromArgs,
    profileOfReceipt,
  } = require("./build-profile");
  assert.equal(profileFromArgs([]), PROFILES.local);
  assert.equal(profileFromArgs(["--profile", "public"]), PROFILES.public);
  for (const argv of [["--profile"], ["--profile", "constructor"]])
    assert.throws(() => profileFromArgs(argv), /Usage/);
  assert.equal(
    profileOfReceipt({ profile: "local-offline-eight-books" }),
    PROFILES.local,
  );
  assert.equal(
    profileOfReceipt({
      profile: "public-kotobaflow-four-books",
      edition: "public",
    }),
    PROFILES.public,
  );
  assert.throws(
    () => profileOfReceipt({ profile: "public-kotobaflow-four-books" }),
    /Unknown package profile/,
  );
  assert.equal(PROFILES.local.classics, true);
  // DF-23: the release keeps the classics library.
  assert.equal(PROFILES.public.classics, true);
  assert.deepEqual(PROFILES.public.sectionFamilies, ["KotobaFlow"]);
  assert.ok(
    PROFILES.public.books.every((book) => book.startsWith("KotobaFlow")),
  );
});

test("offline shell dependencies reject remote hosts and exclude removed online assets", () => {
  const { transformIndex } = require("./mobile-offline-transform");
  const { injectRuntime, shellReferences } = require("./prepare-web");
  const html = injectRuntime(
    transformIndex(
      fs.readFileSync(
        path.join(__dirname, "../web-source-backup/index.html"),
        "utf8",
      ),
    ),
  );
  const refs = shellReferences(html);
  assert.ok(refs.has("js/mobile-platform.js"));
  assert.ok(
    html.indexOf("js/mobile-platform.js") < html.indexOf("js/theme.js"),
  );
  for (const file of [
    "js/cloud-progress.js",
    "js/feedback.js",
    "js/pwa.js",
    "manifest.webmanifest",
  ])
    assert.equal(refs.has(file), false);
  assert.throws(
    () => shellReferences('<img src="https://remote.example/pixel">'),
    /External shell reference/,
  );
});

test("asset reads reject escape paths and unresolved LFS placeholders", (t) => {
  const { root, write } = fixture(t);
  const { readAsset } = require("./web-offline-assets");
  assert.throws(
    () => readAsset(root, "../private.json"),
    /Unsafe runtime path/,
  );
  assert.throws(
    () => readAsset(root, "data/..\\private.json"),
    /Unsafe runtime path/,
  );
  write("lfs.json", {});
  fs.writeFileSync(
    path.join(root, "lfs.json"),
    "version https://git-lfs.github.com/spec/v1\noid sha256:0\nsize 1\n",
  );
  assert.throws(() => readAsset(root, "lfs.json"), /Unresolved LFS/);
});

test("linked media directories cannot escape the package input tree", (t) => {
  const { root, write } = fixture(t);
  const { readAsset } = require("./web-offline-assets");
  write("real/media.json", { ok: true });
  const junction = path.join(root, "linked");
  fs.symlinkSync(
    path.join(root, "real"),
    junction,
    process.platform === "win32" ? "junction" : "dir",
  );
  try {
    assert.throws(
      () => readAsset(root, "linked/media.json"),
      /Linked runtime asset/,
    );
  } finally {
    fs.unlinkSync(junction);
  }
});

test("stale lesson map entries are not silently admitted", (t) => {
  const { root, write, books } = fixture(t);
  books.KotobaFlow1.lessons.stale = books.KotobaFlow1.lessons.lesson_01;
  write("data/textbook/book_chunks/KotobaFlow1.json", books.KotobaFlow1);
  assert.throws(
    () => collectChunkAssets(root),
    /Unreferenced lesson dependency/,
  );
});

function libraryFixture(t) {
  const parent = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, "kotobaflow-library-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), parent);
    assert.ok(path.basename(root).startsWith("kotobaflow-library-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const write = (relative, body) => {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(
      absolute,
      typeof body === "string" || Buffer.isBuffer(body)
        ? body
        : JSON.stringify(body),
    );
  };
  return { root, write };
}

test("example sentence clips must sit inside their pack and in their shard", (t) => {
  const {
    assetRecorder,
    collectExampleAudio,
  } = require("./web-offline-assets");
  const { root, write } = libraryFixture(t);
  const base = "data/example_audio_v1";
  const pack = Buffer.concat([
    Buffer.from("OggS"),
    Buffer.alloc(60),
    Buffer.from("OggS"),
    Buffer.alloc(60),
  ]);
  write(`${base}/packs/0123456789abcdef.ogg`, pack);
  write(`${base}/packs/fedcba9876543210.ogg`, pack);
  // shardBits 1: keys below 2^52 belong to shard 0, the rest to shard 1.
  const shards = (low, high) => {
    write(`${base}/shards/00-000000000000.json`, low);
    write(`${base}/shards/01-000000000000.json`, high);
  };
  write(`${base}/index.json`, {
    schema: 1,
    hash: "cyrb53-v1",
    shardBits: 1,
    clips: 2,
    keys: 2,
    packs: ["packs/0123456789abcdef.ogg", "packs/fedcba9876543210.ogg"],
    shards: ["shards/00-000000000000.json", "shards/01-000000000000.json"],
  });
  shards({ "00000000000001": [0, 0, 64] }, { "1fffffffffffff": [0, 64, 64] });
  const recorder = assetRecorder(root);
  assert.deepEqual(collectExampleAudio(root, recorder), { clips: 2, packs: 1 });
  // Only referenced packs are packaged.
  assert.ok(recorder.files.has(`${base}/packs/0123456789abcdef.ogg`));
  assert.ok(!recorder.files.has(`${base}/packs/fedcba9876543210.ogg`));
  shards({ "00000000000001": [0, 3, 64] }, { "1fffffffffffff": [0, 64, 64] });
  assert.throws(
    () => collectExampleAudio(root, assetRecorder(root)),
    /Damaged example audio clip/,
  );
  shards({ "00000000000001": [0, 0, 64] }, { "1fffffffffffff": [0, 64, 65] });
  assert.throws(
    () => collectExampleAudio(root, assetRecorder(root)),
    /Damaged example audio clip/,
  );
  shards({ "1fffffffffffff": [0, 0, 64] }, { "00000000000001": [0, 64, 64] });
  assert.throws(
    () => collectExampleAudio(root, assetRecorder(root)),
    /Invalid example audio entry/,
  );
});

test("example clips without a packaged text are left out byte-for-byte", (t) => {
  const {
    assetRecorder,
    collectExampleAudio,
  } = require("./web-offline-assets");
  const {
    exampleKeys,
    packagedTextKeys,
    pruneExampleAudio,
    verifyPrunedExampleAudio,
  } = require("./example-audio-prune");
  const keyScript = fs.readFileSync(
    path.join(__dirname, "..", "web-source-backup/js/core/example-audio.js"),
  );
  const source = libraryFixture(t);
  const output = libraryFixture(t);
  for (const { write } of [source, output])
    write("js/core/example-audio.js", keyScript);
  const keys = exampleKeys(source.root);
  const texts = ["今日は晴れです。", "古い例文です。", "[[本]]を読みます。"];
  const clip = (fill) =>
    Buffer.concat([Buffer.from("OggS"), Buffer.alloc(60, fill)]);
  const base = "data/example_audio_v1";
  source.write(
    `${base}/packs/0123456789abcdef.ogg`,
    Buffer.concat([1, 2, 3].map(clip)),
  );
  // shardBits 4: sixteen shards named with two digits, as the web names them.
  const shards = Array.from({ length: 16 }, () => ({}));
  texts.forEach((text, position) => {
    const key = keys.textKey(text);
    shards[keys.shardOf(key, 4)][key] = [0, position * 64, 64];
  });
  const shardNames = shards.map((rows, position) => {
    const name = `shards/${String(position).padStart(2, "0")}-000000000000.json`;
    source.write(`${base}/${name}`, rows);
    return name;
  });
  source.write(`${base}/index.json`, {
    schema: 1,
    hash: "cyrb53-v1",
    shardBits: 4,
    clips: 3,
    keys: 3,
    packs: ["packs/0123456789abcdef.ogg"],
    shards: shardNames,
  });
  // The page shows the first and third texts; highlight marks do not count.
  const shown = packagedTextKeys(keys, [
    JSON.stringify({ examples: [{ ja: texts[0] }, { ja: "本を読みます。" }] }),
  ]);
  const { files, pruning } = pruneExampleAudio(source.root, shown);
  assert.deepEqual(pruning, {
    sourceClips: 3,
    sourcePacks: 1,
    keptClips: 2,
    keptPacks: 1,
    removedClips: 1,
    removedBytes: 64,
  });
  for (const [file, body] of files) output.write(file, body);
  assert.deepEqual(
    collectExampleAudio(output.root, assetRecorder(output.root)),
    {
      clips: 2,
      packs: 1,
    },
  );
  const [pack] = [...files].find(([file]) => file.endsWith(".ogg"));
  assert.ok(files.get(pack).equals(Buffer.concat([clip(1), clip(3)])));
  assert.deepEqual(verifyPrunedExampleAudio(source.root, output.root, shown), {
    sourceClips: 3,
    keptClips: 2,
    removedClips: 1,
  });
  // A changed clip, or a kept text that lost its clip, fails verification.
  output.write(pack, Buffer.concat([clip(1), clip(4)]));
  assert.throws(
    () => verifyPrunedExampleAudio(source.root, output.root, shown),
    /Packaged example clip bytes changed/,
  );
  shown.add(keys.textKey(texts[1]));
  assert.throws(
    () => verifyPrunedExampleAudio(source.root, output.root, shown),
    /differ from the shown examples/,
  );
});

test("classics parts and narrations must match their work index", (t) => {
  const { assetRecorder, collectClassics } = require("./web-offline-assets");
  const { root, write } = libraryFixture(t);
  const base = "data/classics_v1";
  const narration = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(29)]);
  write(`${base}/catalog.json`, {
    schema: 1,
    books: [{ id: "taketori", parts: 2, audio: true }],
  });
  const index = (bytes) =>
    write(`${base}/taketori/index.json`, {
      schema: 1,
      id: "taketori",
      parts: [
        { n: 1, file: "01.json" },
        { n: 2, file: "02.json" },
      ],
      audio: { file: "audio.mp3", bytes },
    });
  for (const part of [1, 2])
    write(`${base}/taketori/0${part}.json`, {
      schema: 1,
      book: "taketori",
      part,
      units: [],
    });
  write(`${base}/taketori/audio.mp3`, narration);
  index(narration.length);
  const recorder = assetRecorder(root);
  assert.deepEqual(collectClassics(recorder), {
    works: 1,
    parts: 2,
    narrations: 1,
  });
  assert.ok(recorder.files.has(`${base}/taketori/audio.mp3`));
  index(narration.length + 1);
  assert.throws(
    () => collectClassics(assetRecorder(root)),
    /Classic narration size changed/,
  );
  index(narration.length);
  write(`${base}/taketori/audio.mp3`, Buffer.alloc(32));
  assert.throws(
    () => collectClassics(assetRecorder(root)),
    /Invalid MP3 asset/,
  );
});
