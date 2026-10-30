const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { collectChunkAssets, hash } = require("./web-chunk-assets");
const {
  collectOfflineAssets,
  readAsset,
  plainFile,
} = require("./web-offline-assets");
const {
  transformIndex,
  transformArchiveUI,
  transformProgressStore,
} = require("./mobile-offline-transform");
const { PROFILES, receiptPath, profileFromArgs } = require("./build-profile");
const { compatCss } = require("./css-compat");
const {
  EXAMPLE_AUDIO,
  exampleKeys,
  isTextData,
  packagedTextKeys,
  pruneExampleAudio,
} = require("./example-audio-prune");

const mobileRoot = path.resolve(__dirname, "..");
const webRoot = path.resolve(
  process.env.KOTOBAFLOW_WEB_ROOT || path.join(mobileRoot, "web-source-backup"),
);
const output = path.join(mobileRoot, "www");
// Rebuilt for each public edition: the web package staging and its receipt.
const publicRoot = path.join(mobileRoot, "artifacts", "public-web");
const publicStaging = path.join(publicRoot, "staging");

// Packaged files that come from this repository rather than the web source.
const RUNTIME_FILES = new Map([
  ["js/mobile-platform.js", "runtime/mobile-platform.js"],
  ["js/mobile-shell.js", "runtime/mobile-shell.js"],
  ["js/mobile-native.js", "runtime/mobile-native.js"],
  ["css/mobile-layout.css", "runtime/mobile-layout.css"],
]);
const RUNTIME_VERSION = "20261023-phone-reader-1";
// Shell files a web script loads on demand rather than from index.html, with
// the source line that proves the reference (web 8504899 made Cytoscape lazy).
const LAZY_SHELL_FILES = new Map([
  [
    "vendor/cytoscape.min.js",
    [
      "js/graph-builder.js",
      "GraphBuilder.SCRIPT_URL = './vendor/cytoscape.min.js?v=",
    ],
  ],
]);

function lazyShellReferences(root) {
  const files = new Set();
  for (const [file, [script, anchor]] of LAZY_SHELL_FILES) {
    if (!readAsset(root, script).toString("utf8").includes(anchor))
      throw new Error(`Missing lazy shell reference anchor: ${file}`);
    files.add(file);
  }
  return files;
}

function injectRuntime(html) {
  const firstScript = /<script\s+src=/;
  const stylesheet = /(<link rel="stylesheet" href="\.\/style\.css[^>]*>)/;
  if (
    !firstScript.test(html) ||
    !stylesheet.test(html) ||
    !/<\/body>/i.test(html)
  )
    throw new Error("Cannot locate the mobile runtime injection anchors");
  // mobile-platform.js runs before theme.js; mobile-native.js after the shell.
  // style.css gains additions for old WebViews (css-compat.js), so its
  // address carries the runtime version too.
  return html
    .replace(
      firstScript,
      `<script src="./js/mobile-platform.js?v=${RUNTIME_VERSION}"></script>\n    <script src=`,
    )
    .replace(
      stylesheet,
      (link) =>
        link.replace(/(style\.css\?v=[^"]*)"/, `$1-m${RUNTIME_VERSION}"`) +
        `\n    <link rel="stylesheet" href="./css/mobile-layout.css?v=${RUNTIME_VERSION}">`,
    )
    .replace(
      /<\/body>/i,
      `    <script src="./js/mobile-shell.js?v=${RUNTIME_VERSION}"></script>\n    <script src="./js/mobile-native.js?v=${RUNTIME_VERSION}"></script>\n</body>`,
    );
}

function shellReferences(html) {
  const files = new Set();
  // <base href="/"> names the package root, not a file to package.
  const page = html.replace(/<base href="\/">/, "");
  for (const match of page.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const url = match[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url))
      throw new Error(`External shell reference: ${url}`);
    files.add(url.replace(/^\.\//, "").split(/[?#]/)[0]);
  }
  return files;
}

// The packaged stylesheets gain additions for old WebViews (css-compat.js).
// Each is read with the other, whose rules can turn its flex rows into
// columns or grids.
function relatedCss(file, sourceRoot) {
  if (file === "style.css")
    return [
      readAsset(
        mobileRoot,
        RUNTIME_FILES.get("css/mobile-layout.css"),
      ).toString("utf8"),
    ];
  return [readAsset(sourceRoot, "style.css").toString("utf8")];
}

function transformRuntimeSource(file, source, sourceRoot) {
  if (file === "style.css" || file === "css/mobile-layout.css")
    return compatCss(source, { related: relatedCss(file, sourceRoot) }).css;
  if (file === "js/archive-ui.js") return transformArchiveUI(source);
  if (file === "js/progress-store.js") return transformProgressStore(source);
  if (file === "js/textbook/image-renderer.js") {
    if (!source.includes("+ key + '.png'"))
      throw new Error("Missing textbook image extension anchor");
    return source.replace("+ key + '.png'", "+ key + '.webp'");
  }
  if (file === "js/detail-panel.js") {
    const message = "列表与学习仍可使用，请联网后重试。";
    if (source.split(message).length !== 2)
      throw new Error("Unexpected offline word detail error anchor");
    return source.replace(
      message,
      "列表与学习仍可使用，请重试；仍失败请重新打开应用。",
    );
  }
  if (file === "js/loader.js") {
    if ((source.match(/请联网后重试/g) || []).length !== 3)
      throw new Error("Unexpected offline loader recovery text anchors");
    return source.replaceAll(
      "请联网后重试",
      "请重新打开应用后重试；仍失败请检查离线包是否完整",
    );
  }
  return source;
}

// The public edition packages the web copy's own public package (PUB-05):
// tools/build_public_release.cjs leaves out the XinBian books (and keeps the
// classics, DF-23), keeps only the word recordings KotobaFlow reuses, offers the four
// KotobaFlow books in js/content-config.js and checks the result against the
// web's release policy. The staging is then packaged like the web copy.
function stagePublicRelease(root) {
  const linked = () =>
    fs.lstatSync(publicRoot).isSymbolicLink() ||
    fs.realpathSync(publicRoot) !== publicRoot;
  if (fs.existsSync(publicRoot) && linked())
    throw new Error("Refusing to replace a linked public staging directory");
  fs.rmSync(publicRoot, { recursive: true, force: true });
  fs.mkdirSync(publicRoot, { recursive: true });
  if (linked()) throw new Error("Public staging must stay inside artifacts");
  const { buildRelease } = require(
    path.join(root, "tools", "build_public_release.cjs"),
  );
  const result = buildRelease(root, publicStaging);
  console.log(
    `Staged the web public package: ${result.files} files (${(result.bytes / 1048576).toFixed(1)} MiB), ${result.reminders} provenance reminders.`,
  );
  return publicStaging;
}

function prepareWeb(profile = PROFILES.local) {
  // Read and validate every dependency before replacing a previous www build.
  const sourceRoot =
    profile.edition === "public" ? stagePublicRelease(webRoot) : webRoot;
  const index = injectRuntime(
    transformIndex(readAsset(sourceRoot, "index.html").toString("utf8")),
  );
  const generated = collectChunkAssets(sourceRoot, {
    rewriteImages: true,
    books: profile.books,
  });
  const media = collectOfflineAssets(sourceRoot, generated, profile);
  const copies = new Map(
    [...media.files.keys()].map((file) => [file, plainFile(sourceRoot, file)]),
  );
  // Example clips whose text no packaged data file holds are left out.
  const texts = packagedTextKeys(exampleKeys(sourceRoot), [
    ...[...generated].filter(([file]) => isTextData(file)).map(([, b]) => b),
    ...[...copies.keys()]
      .filter(isTextData)
      .map((file) => readAsset(sourceRoot, file)),
  ]);
  const examples = pruneExampleAudio(sourceRoot, texts);
  for (const file of [...copies.keys()])
    if (file.startsWith(`${EXAMPLE_AUDIO}/`)) copies.delete(file);
  for (const [file, body] of examples.files) generated.set(file, body);
  media.counts.exampleAudio = {
    clips: examples.pruning.keptClips,
    packs: examples.pruning.keptPacks,
  };
  const runtime = RUNTIME_FILES;
  generated.set("index.html", index);
  for (const file of shellReferences(index)) {
    const fromRuntime = runtime.get(file);
    copies.set(
      file,
      plainFile(fromRuntime ? mobileRoot : sourceRoot, fromRuntime || file),
    );
  }
  for (const file of lazyShellReferences(sourceRoot))
    copies.set(file, plainFile(sourceRoot, file));
  for (const file of [
    "style.css",
    "css/mobile-layout.css",
    "js/archive-ui.js",
    "js/detail-panel.js",
    "js/loader.js",
    "js/progress-store.js",
    "js/textbook/image-renderer.js",
  ])
    generated.set(
      file,
      transformRuntimeSource(
        file,
        readAsset(
          runtime.has(file) ? mobileRoot : sourceRoot,
          runtime.get(file) || file,
        ).toString("utf8"),
        sourceRoot,
      ),
    );
  // The old books retain the existing mobile image compression. New course
  // WebP images are already optimized and copied byte-for-byte with hashes.
  const imageSources = [...media.imageReferences]
    .sort()
    .map((file) => file.replace(/\.webp$/, ".png"));
  for (const file of imageSources) plainFile(sourceRoot, file);
  if (
    path.dirname(output) !== mobileRoot ||
    path.basename(output) !== "www" ||
    fs.realpathSync(mobileRoot) !== mobileRoot
  )
    throw new Error(
      "Refusing to rebuild outside the real mobile www directory",
    );
  if (
    fs.existsSync(output) &&
    (fs.lstatSync(output).isSymbolicLink() ||
      fs.realpathSync(output) !== output)
  )
    throw new Error("Refusing to replace a linked www directory");
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  for (const [file, source] of copies) {
    if (generated.has(file)) continue;
    const destination = path.join(output, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  for (const [file, body] of generated) {
    const destination = path.join(output, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, body);
  }
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  const imagePlan = path.join(
    path.dirname(receiptPath),
    "mobile-image-inputs.json",
  );
  fs.writeFileSync(
    imagePlan,
    JSON.stringify(imageSources.map((file) => file.slice("image/".length))),
  );
  // The public edition has no XinBian page images to convert.
  if (imageSources.length)
    childProcess.execFileSync(
      process.env.KOTOBAFLOW_PYTHON || "python",
      [
        path.join(mobileRoot, "scripts/optimize-mobile-images.py"),
        path.join(sourceRoot, "image"),
        path.join(output, "image"),
        "--max-width",
        "1600",
        "--quality",
        "82",
        "--files",
        imagePlan,
      ],
      { stdio: "inherit" },
    );
  const files = {};
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else {
        const relative = path
          .relative(output, absolute)
          .split(path.sep)
          .join("/");
        const body = readAsset(output, relative);
        files[relative] = { bytes: body.length, sha256: hash(body) };
      }
    }
  }
  visit(output);
  const receipt = {
    schema: 1,
    profile: profile.receipt,
    edition: profile.edition,
    sourceRoot,
    webRoot,
    counts: media.counts,
    examplePruning: examples.pruning,
    files,
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
  const bytes = Object.values(files).reduce(
    (sum, entry) => sum + entry.bytes,
    0,
  );
  console.log(
    `Prepared ${Object.keys(files).length} verified offline assets (${(bytes / 1048576).toFixed(1)} MiB).`,
  );
  console.log(
    `${profile.edition} edition: ${media.counts.books} books, ${media.counts.lessons} lessons; KotobaFlow word rows: ${media.counts.courseWords}.`,
  );
  const { sourceClips, removedClips, removedBytes } = examples.pruning;
  console.log(
    `Example sentence clips: ${media.counts.exampleAudio.clips} of ${sourceClips} kept; ${removedClips} with no packaged text left out (${(removedBytes / 1048576).toFixed(1)} MiB).`,
  );
  console.log(`Private integrity receipt: ${receiptPath}`);
  return receipt;
}

if (require.main === module) prepareWeb(profileFromArgs(process.argv.slice(2)));
module.exports = {
  publicStaging,
  webRoot,
  RUNTIME_FILES,
  lazyShellReferences,
  injectRuntime,
  shellReferences,
  transformRuntimeSource,
  prepareWeb,
};
