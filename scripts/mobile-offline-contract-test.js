const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
  transformIndex,
  transformArchiveUI,
  transformProgressStore,
  EXCLUDED_ASSETS,
} = require("./mobile-offline-transform");
const sourceRoot = path.resolve(__dirname, "../web-source-backup");

test("the current web page becomes offline while retaining all local modules and full archive controls", () => {
  const input = fs.readFileSync(path.join(sourceRoot, "index.html"), "utf8");
  const output = transformIndex(input);
  for (const id of [
    "cloudArchiveOpen",
    "cloudDialog",
    "appFeedbackOpen",
    "feedbackDialog",
    "mobileUnsupportedNotice",
  ])
    assert.ok(!output.includes(`id="${id}"`), id);
  for (const id of [
    "archiveDialog",
    "archiveFile",
    "archiveExport",
    "archiveRestore",
    "archiveMode",
    "archiveBackup",
    "archiveRemoteBackup",
  ])
    assert.ok(output.includes(`id="${id}"`), id);
  for (const excluded of EXCLUDED_ASSETS)
    assert.ok(!output.includes(`./${excluded}`), excluded);
  assert.doesNotMatch(output, /<a[^>]+href="https?:/);
  assert.match(output, /Content-Security-Policy[^>]+connect-src 'self'/);
  assert.match(output, /frame-src 'none'/);
  // Site metadata and the public about page stay out of the app.
  assert.doesNotMatch(output, /rel="canonical"|og:url|sitePageSchema/);
  assert.doesNotMatch(output, /privacy\.html/);
  assert.match(output, /<title>词基流动<\/title>/);
  assert.match(output, /<button id="appAboutLink"[^>]*type="button"/);
  // The base keeps assets on the package root after module address changes.
  assert.match(output, /<base href="\/">/);
  assert.match(output, /base-uri 'self'/);
  const scripts = (text) =>
    Array.from(
      text.matchAll(/<script src="([^"?]+)(?:[^"]*)"/g),
      (match) => match[1],
    );
  assert.deepEqual(
    scripts(output),
    scripts(input).filter((src) => !EXCLUDED_ASSETS.includes(src.slice(2))),
  );
  assert.match(output, /js\/content-config\.js/);
  assert.match(output, /js\/core\/archive\.js/);
});

test("archive adapter awaits native save and keeps upstream import validation, preview and conflict protection", () => {
  const input = fs.readFileSync(
    path.join(sourceRoot, "js/archive-ui.js"),
    "utf8",
  );
  const output = transformArchiveUI(input);
  assert.doesNotThrow(() => new vm.Script(output));
  assert.doesNotMatch(output, /createObjectURL|anchor\.click|revokeObjectURL/);
  assert.match(output, /await window\.JPLearnMobileFiles\.saveArchive/);
  // Shared backups are not reported as saved files.
  assert.equal(
    output.split("window.JPLearnMobileFiles.resultText(").length - 1,
    3,
  );
  assert.match(output, /event\.detail && event\.detail\.nativeFile/);
  for (const code of [
    "api.exportArchive(snapshot)",
    "api.validate(await file.text())",
    "window.ProgressStore.prepareRestore()",
    "window.ProgressStore.restoreProgress(next, preview)",
    "if (file.size > api.MAX_BYTES)",
  ])
    assert.ok(output.includes(code), code);
});

test("a moved upstream anchor fails packaging instead of silently losing offline protections", () => {
  assert.throws(
    () => transformIndex("<html></html>"),
    /Missing offline transform anchor/,
  );
  assert.throws(
    () => transformArchiveUI("function download() {}"),
    /Missing archive download adapter anchor/,
  );
  assert.throws(
    () => transformProgressStore("function save() {}"),
    /Unexpected offline progress error text anchor/,
  );
});
