const fs = require("node:fs");
const path = require("node:path");

// Package editions. The local edition is this device's own eight-book copy
// with the classics library; the public edition holds only what the web
// project's public package may (PUB-05): the four KotobaFlow books, no
// XinBian text, images or section audio. Since 2026-10-30 (DF-23) it keeps
// the classics library too. prepare-web.js records the edition in the build
// receipt; every later step reads it there.
const XINBIAN = ["XinBian1", "XinBian2", "XinBian3", "XinBian4"];
const KOTOBAFLOW = ["KotobaFlow1", "KotobaFlow2", "KotobaFlow3", "KotobaFlow4"];
const PROFILES = {
  local: {
    edition: "local",
    receipt: "local-offline-eight-books",
    books: [...XINBIAN, ...KOTOBAFLOW],
    sectionFamilies: ["XinBian", "KotobaFlow"],
    classics: true,
  },
  public: {
    edition: "public",
    receipt: "public-kotobaflow-four-books",
    books: KOTOBAFLOW,
    sectionFamilies: ["KotobaFlow"],
    classics: true,
  },
};
const receiptPath = path.resolve(
  __dirname,
  "..",
  "artifacts",
  "mobile-web-manifest.json",
);

function profileFromArgs(argv) {
  const at = argv.indexOf("--profile");
  if (at === -1) return PROFILES.local;
  const profile = PROFILES[argv[at + 1]];
  if (!profile || !Object.hasOwn(PROFILES, argv[at + 1]))
    throw new Error(
      `Usage: --profile ${Object.keys(PROFILES).join("|")} (got ${argv[at + 1]})`,
    );
  return profile;
}

function profileOfReceipt(receipt) {
  const profile = Object.values(PROFILES).find(
    (entry) => entry.receipt === receipt.profile,
  );
  if (!profile || (receipt.edition || "local") !== profile.edition)
    throw new Error(`Unknown package profile: ${receipt.profile}`);
  return profile;
}

// The edition of the package currently in www (and, after cap sync, the APK).
function packagedProfile() {
  return profileOfReceipt(JSON.parse(fs.readFileSync(receiptPath, "utf8")));
}

module.exports = {
  PROFILES,
  receiptPath,
  profileFromArgs,
  profileOfReceipt,
  packagedProfile,
};
