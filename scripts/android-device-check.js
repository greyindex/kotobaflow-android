// Device acceptance for the installed debug APK: drives the app's WebView over
// its DevTools socket and records evidence (screenshots, logcat, JSON report).
//
// Usage: node scripts/android-device-check.js [--serial emulator-5554]
//   [--out artifacts/android-device-check/<stamp>] [--steps a,b,c]
//   [--allow-physical]
//
// The installed APK must be a debug build of the current www/ (byte ranges and
// clip hashes are compared with these files). Its edition is the one in the
// build receipt: the public edition has four KotobaFlow books and, since
// DF-23, the same five tabs and classics library as the local one. A step passes only when it returns `passed === true`.
"use strict";
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { packagedProfile } = require("./build-profile");

const root = path.resolve(__dirname, "..");
const WWW = path.join(root, "www");
const PKG = "lol.kotobaflow.app";
const ACTIVITY = PKG + "/.MainActivity";
const SHARE_STATUS =
  "已打开系统分享面板。备份要在所选应用中确认保存后才算保存。";
const STEPS = [
  "fingerprint",
  "startup",
  "ranges",
  "clips",
  "exampleAudio",
  "wordAudio",
  "pageRead",
  "curlTurn",
  "textbookAudio",
  "phoneReader",
  "phoneModules",
  "wordDetail",
  "grammarBriefs",
  "grammarDetail",
  "grammarFolds",
  "kanaAudio",
  "transitions",
  "dialogueAudio",
  "reloadTextbook",
  "editionBooks",
  "classics",
  "classicsRestart",
  "about",
  "progress",
  "saf",
  "share",
  "dark",
];

function parseArgs(argv) {
  const options = {
    serial: "emulator-5554",
    out: "",
    steps: [],
    allowPhysical: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[++i];
    };
    if (arg === "--serial") options.serial = value();
    else if (arg === "--out") options.out = value();
    else if (arg === "--steps")
      options.steps = value().split(",").filter(Boolean);
    else if (arg === "--allow-physical") options.allowPhysical = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  const unknown = options.steps.filter((name) => !STEPS.includes(name));
  if (unknown.length)
    throw new Error(
      `Unknown step(s): ${unknown.join(", ")}; known: ${STEPS.join(", ")}`,
    );
  return options;
}

function findAdb() {
  const sdkCandidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Android", "Sdk")
      : "",
    process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Android", "sdk")
      : "",
    process.platform === "linux"
      ? path.join(os.homedir(), "Android", "Sdk")
      : "",
  ].filter(Boolean);
  const binary = process.platform === "win32" ? "adb.exe" : "adb";
  for (const sdk of sdkCandidates) {
    const candidate = path.join(sdk, "platform-tools", binary);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    "adb not found. Set ANDROID_HOME or ANDROID_SDK_ROOT to the Android SDK.",
  );
}

function stamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

const options = parseArgs(process.argv.slice(2));
const ADB = findAdb();
const serial = options.serial;
const out = path.resolve(
  options.out || path.join(root, "artifacts", "android-device-check", stamp()),
);
const only = options.steps;

if (!options.allowPhysical && !/^emulator-/.test(serial))
  throw new Error(
    `Device check only runs on emulators by default: ${serial}; pass --allow-physical for a physical device.`,
  );
if (!fs.existsSync(path.join(WWW, "index.html")))
  throw new Error(`Missing ${WWW}; run npm run sync for the installed build.`);
fs.mkdirSync(out, { recursive: true });

const profile = packagedProfile();
const PUBLIC = profile.edition === "public";
// Files Capacitor serves untouched, compared with www/ to tie the install to
// this build: the mobile runtime and the audio and classics indexes.
const FINGERPRINT_FILES = [
  "js/mobile-platform.js",
  "js/mobile-shell.js",
  "js/mobile-native.js",
  "data/example_audio_v1/index.json",
  ...(profile.classics ? ["data/classics_v1/catalog.json"] : []),
];

// stderr is piped so chatty tools (monkey) stay out of the log; a failing
// command still throws with it.
const adb = (...args) =>
  execFileSync(ADB, ["-s", serial, ...args], {
    encoding: "utf8",
    maxBuffer: 64 << 20,
    stdio: ["ignore", "pipe", "pipe"],
  });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
let cdp = null;
let forwardPort = 0;

function shot(name) {
  const png = execFileSync(ADB, ["-s", serial, "exec-out", "screencap", "-p"], {
    maxBuffer: 64 << 20,
  });
  fs.writeFileSync(path.join(out, name + ".png"), png);
}

function topActivity() {
  const dump = adb("shell", "dumpsys", "activity", "activities");
  const line = dump
    .split(/\r?\n/)
    .find((entry) => /topResumedActivity|mResumedActivity/.test(entry));
  return line ? line.trim() : "";
}

// pidof exits 1 when the app is not running.
function appPid() {
  try {
    return adb("shell", "pidof", PKG).trim().split(/\s+/)[0];
  } catch (error) {
    return "";
  }
}

// Bring the app's own activity to the front, starting it when it is not
// running. Leftover system screens (a file picker or share sheet from an
// earlier run) are closed with Back first.
async function ensureAppInFront() {
  for (let attempt = 0; attempt < 4; attempt++) {
    const top = topActivity();
    if (
      top.includes(ACTIVITY) ||
      top.includes(PKG + "/" + PKG + ".MainActivity")
    )
      return;
    if (!appPid()) break;
    if (!top.includes(PKG)) {
      adb("shell", "input", "keyevent", "4");
      await sleep(800);
    } else break;
  }
  adb("shell", "am", "start", "-n", ACTIVITY);
  await sleep(2500);
}

async function connect(timeoutMs = 60000) {
  const started = Date.now();
  let lastError = null;
  let launched = false;
  while (Date.now() - started < timeoutMs) {
    try {
      const pid = appPid();
      if (!pid) {
        if (!launched) {
          launched = true;
          await ensureAppInFront();
        }
        throw new Error("app not running");
      }
      const sockets = adb("shell", "cat", "/proc/net/unix");
      const name = "webview_devtools_remote_" + pid;
      if (!sockets.includes("@" + name))
        throw new Error("no devtools socket for " + pid + " (debug build?)");
      if (forwardPort) {
        try {
          adb("forward", "--remove", "tcp:" + forwardPort);
        } catch (error) {}
      }
      forwardPort = 9300 + Math.floor(Math.random() * 500);
      adb("forward", "tcp:" + forwardPort, "localabstract:" + name);
      const targets = await (
        await fetch(`http://127.0.0.1:${forwardPort}/json`)
      ).json();
      const page = targets.find(
        (t) => t.type === "page" && /^https?:\/\/localhost/.test(t.url),
      );
      if (!page)
        throw new Error(
          "no app page among " + targets.map((t) => t.url).join(", "),
        );
      cdp = await open(page.webSocketDebuggerUrl);
      return await (
        await fetch(`http://127.0.0.1:${forwardPort}/json/version`)
      ).json();
    } catch (error) {
      lastError = error;
      await sleep(1000);
    }
  }
  throw lastError;
}

function open(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let id = 0;
    socket.onopen = () =>
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const callId = ++id;
            pending.set(callId, { res, rej });
            socket.send(JSON.stringify({ id: callId, method, params }));
          });
        },
        close() {
          socket.close();
        },
      });
    socket.onerror = (event) =>
      reject(new Error("websocket error " + (event.message || "")));
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { res, rej } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) rej(new Error(JSON.stringify(message.error)));
        else res(message.result);
      }
    };
    socket.onclose = () => {
      for (const { rej } of pending.values()) rej(new Error("socket closed"));
      pending.clear();
    };
  });
}

async function evaluate(expression, timeoutMs = 30000) {
  const run = cdp.send("Runtime.evaluate", {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  const result = await Promise.race([
    run,
    sleep(timeoutMs).then(() => {
      throw new Error("evaluate timeout");
    }),
  ]);
  if (result.exceptionDetails)
    throw new Error(
      (result.exceptionDetails.exception &&
        result.exceptionDetails.exception.description) ||
        result.exceptionDetails.text,
    );
  return result.result.value;
}

// In-page helpers, defined once per document.
const HELPERS = `
  if (!window.__dc) {
    window.__dc = {
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      async until(test, ms = 20000, step = 100) {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          try { if (await test()) return true; } catch (e) {}
          await new Promise((r) => setTimeout(r, step));
        }
        return false;
      },
      module: () => document.querySelector("#mobileBottomNav [aria-current='page']")?.dataset.mobileModule,
      async tab(name) {
        document.querySelector("#mobileBottomNav [data-mobile-module='" + name + "']").click();
        return window.__dc.until(() => window.__dc.module() === name && window.ModuleSwitcher.getCurrentModule() === name);
      },
      back() { document.body.dispatchEvent(new Event("backbutton", { bubbles: true, cancelable: true })); },
    };
  }
`;

async function ready() {
  await evaluate(
    HELPERS +
      `return window.__dc.until(() => window.appConfig && window.appConfig.status === "ready" && document.documentElement.dataset.mobileShell === "ready", 60000);`,
    70000,
  );
  // DF-16: the launch cover stays until about two seconds after launch.
  await evaluate(
    HELPERS +
      `return window.__dc.until(() => !document.documentElement.hasAttribute("data-mobile-launch"), 12000);`,
    15000,
  );
  await evaluate(HELPERS + "return true;");
}

async function step(name, fn) {
  if (only.length && !only.includes(name)) return;
  const started = Date.now();
  try {
    const detail = await fn();
    const passed = !!detail && detail.passed === true;
    results.push({ name, passed, ms: Date.now() - started, detail });
    console.log(
      passed ? "ok  " : "FAIL",
      name,
      JSON.stringify(detail).slice(0, 400),
    );
  } catch (error) {
    results.push({
      name,
      passed: false,
      ms: Date.now() - started,
      error: String(error.stack || error),
    });
    console.log("FAIL", name, String(error.message || error).slice(0, 400));
    try {
      shot("fail-" + name);
    } catch (e) {}
  }
}

async function restartApp() {
  if (cdp) cdp.close();
  cdp = null;
  adb("shell", "am", "force-stop", PKG);
  await sleep(800);
  adb(
    "shell",
    "monkey",
    "-p",
    PKG,
    "-c",
    "android.intent.category.LAUNCHER",
    "1",
  );
  await sleep(2500);
  await connect();
  await ready();
}

const sha256 = (buffer) =>
  crypto.createHash("sha256").update(buffer).digest("hex");

function localSlice(relative, start, end) {
  const file = path.join(WWW, relative);
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.alloc(end - start + 1);
  fs.readSync(fd, buffer, 0, buffer.length, start);
  fs.closeSync(fd);
  return { size: fs.statSync(file).size, sha: sha256(buffer) };
}

const readJson = (relative) =>
  JSON.parse(fs.readFileSync(path.join(WWW, relative), "utf8"));

// The installed build's version name: the release, then its edition
// ("0.4.2-offline", "0.4.2-public").
function installedVersionName() {
  const match = /versionName=(\S+)/.exec(
    adb("shell", "dumpsys", "package", PKG),
  );
  return match ? match[1] : "";
}
const EDITION_SUFFIX = PUBLIC ? "-public" : "-offline";

// ── System screens (SAF picker, share sheet) ──────────────────────────────
function uiDump() {
  adb("shell", "uiautomator", "dump", "/sdcard/kf-ui.xml");
  return adb("shell", "cat", "/sdcard/kf-ui.xml");
}
function uiNodes(xml) {
  return [...xml.matchAll(/<node [^>]*>/g)].map((match) => {
    const attr = {};
    for (const pair of match[0].matchAll(/([\w-]+)="([^"]*)"/g))
      attr[pair[1]] = pair[2];
    return attr;
  });
}
async function waitNode(test, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const node = uiNodes(uiDump()).find(test);
      if (node) return node;
    } catch (error) {}
    await sleep(700);
  }
  return null;
}
function tapNode(node) {
  const [x1, y1, x2, y2] = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/
    .exec(node.bounds)
    .slice(1)
    .map(Number);
  adb(
    "shell",
    "input",
    "tap",
    String(Math.round((x1 + x2) / 2)),
    String(Math.round((y1 + y2) / 2)),
  );
}
async function waitTop(test, ms = 15000) {
  const end = Date.now() + ms;
  let top = "";
  while (Date.now() < end) {
    top = topActivity();
    if (test(top)) return { ok: true, top };
    await sleep(500);
  }
  return { ok: false, top };
}
function findValue(object, key) {
  if (!object || typeof object !== "object") return undefined;
  if (key in object) return object[key];
  for (const value of Object.values(object)) {
    const found = findValue(value, key);
    if (found !== undefined) return found;
  }
  return undefined;
}
const inDocumentsUi = (node) => /documentsui/.test(node.package || "");

// Export through the export sheet and the system "save" screen; returns the
// file name, the saved path on the device and the parsed archive.
async function exportThroughPicker(label) {
  const name = await evaluate(`
    const dialog = document.getElementById("archiveDialog");
    if (!dialog.open) document.getElementById("appArchiveOpen").click();
    await window.__dc.until(() => dialog.open);
    document.getElementById("archiveExport").click();
    await window.__dc.until(() => document.getElementById("mobileExportDialog")?.open);
    const name = document.getElementById("mobileExportFile").textContent.split(" · ")[0];
    document.querySelector('[data-mobile-export="save"]').click();
    return name;`);
  const save = await waitNode(
    (node) => inDocumentsUi(node) && /^(save|保存)$/i.test(node.text),
  );
  if (!save) throw new Error("system save screen did not show a Save button");
  shot(label + "-picker");
  tapNode(save);
  const status = await evaluate(
    `
    const status = document.getElementById("archiveStatus");
    await window.__dc.until(() => status.textContent && status.textContent !== "正在处理…", 30000);
    return status.textContent;`,
    40000,
  );
  await sleep(800);
  const found = adb(
    "shell",
    `find /storage/emulated/0/ -name '${name}' 2>/dev/null; true`,
  )
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const text = found.length ? adb("exec-out", "cat", found[0]) : "";
  let archive = null;
  try {
    archive = JSON.parse(text);
  } catch (error) {}
  return {
    name,
    status,
    path: found[0] || "",
    bytes: Buffer.byteLength(text),
    archive,
  };
}

let originalNightMode = "";
let originalPlanMinutes = null;

async function restoreDevice() {
  if (originalNightMode) {
    try {
      adb("shell", "cmd", "uimode", "night", originalNightMode);
    } catch (error) {
      console.log("could not restore night mode:", error.message);
    }
  }
  if (originalPlanMinutes !== null && cdp) {
    try {
      await evaluate(
        `const plan = window.ProgressStore.getPlan(); plan.dailyMinutes = ${originalPlanMinutes}; window.ProgressStore.updatePlan(plan); await window.ProgressStore.save(); return true;`,
      );
      // WebView commits localStorage to disk a moment after the write.
      await sleep(1500);
    } catch (error) {
      console.log("could not restore the daily plan:", error.message);
    }
  }
}

async function main() {
  const state = adb("get-state").trim();
  if (state !== "device") throw new Error(`${serial} is not ready: ${state}`);
  adb("logcat", "-c");
  await ensureAppInFront();
  const version = await connect();
  await ready();
  const info = {
    serial,
    webview: version.Browser,
    userAgent: version["User-Agent"],
    android: adb("shell", "getprop", "ro.build.version.release").trim(),
    sdk: adb("shell", "getprop", "ro.build.version.sdk").trim(),
    edition: profile.edition,
    installedVersion: installedVersionName(),
    out,
  };
  console.log(JSON.stringify(info));
  originalPlanMinutes = await evaluate(
    `return window.ProgressStore.getPlan().dailyMinutes;`,
  );

  await step("fingerprint", async () => {
    // Capacitor injects its bridge into served HTML, so compare files it
    // serves untouched: the mobile runtime and the audio indexes.
    const local = {};
    for (const file of FINGERPRINT_FILES)
      local[file] = sha256(fs.readFileSync(path.join(WWW, file)));
    const state = await evaluate(`
      const snapshot = window.ProgressStore.exportProgress();
      const raw = localStorage.getItem("kotobaflow_android_progress_v1") || "";
      const count = (value) => (value && typeof value === "object" ? Object.keys(value).length : 0);
      const hex = (buffer) => Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
      const files = {};
      for (const file of ${JSON.stringify(FINGERPRINT_FILES)}) {
        const body = await (await fetch("/" + file, { cache: "no-store" })).arrayBuffer();
        files[file] = hex(await crypto.subtle.digest("SHA-256", body));
      }
      return {
        files,
        plan: window.ProgressStore.getPlan().dailyMinutes,
        usageDays: count(snapshot.usage),
        vocab: count(snapshot.vocab || snapshot.words || snapshot.vocabulary),
        favorites: count(snapshot.favorites),
        keys: Object.keys(snapshot).sort(),
        localKeys: Object.keys(localStorage).filter((key) => /kotobaflow|jp_learning/.test(key)).sort(),
        rawBytes: raw.length,
        revision: snapshot.revision,
        navigation: snapshot.navigation && snapshot.navigation.textbook ? [snapshot.navigation.textbook.bookId, snapshot.navigation.textbook.lessonId].join("/") : "",
        records: hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(snapshot.vocabulary)))).slice(0, 16),
      };`);
    fs.writeFileSync(
      path.join(out, "fingerprint.json"),
      JSON.stringify(state, null, 2),
    );
    // The installed APK must carry this www/, or the byte checks below
    // compare against the wrong files.
    state.mismatched = FINGERPRINT_FILES.filter(
      (file) => state.files[file] !== local[file],
    );
    state.passed = state.mismatched.length === 0;
    return state;
  });

  await step("startup", async () => {
    shot("01-startup-today");
    const state = await evaluate(`return {
      form: document.documentElement.dataset.nativeForm,
      shell: document.documentElement.dataset.mobileShell,
      theme: document.documentElement.dataset.theme,
      preset: document.documentElement.dataset.appearancePreset,
      storage: window.ProgressStore.getStorageMode(),
      nav: document.querySelectorAll("#mobileBottomNav [data-mobile-module]:not([hidden])").length,
      words: window.taxonomyManager.allWords.length,
      colorMix: CSS.supports("color", "color-mix(in srgb, red 50%, blue)"),
      timeout: typeof AbortSignal.timeout,
      finished: "finished" in Animation.prototype,
      hero: getComputedStyle(document.querySelector(".dashboard-start-card")).backgroundColor,
      heroText: getComputedStyle(document.querySelector(".dashboard-start-card h2")).color,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      url: location.href,
      launch: Object.assign({ cover: document.documentElement.getAttribute("data-mobile-launch"), bridge: typeof window.KotobaFlowNative.launchReady }, window.KotobaFlowNativeShell.launch),
    };`);
    state.version = info.installedVersion;
    state.passed =
      state.shell === "ready" &&
      state.form === "phone" &&
      state.storage === "local-api" &&
      state.nav === (profile.classics ? 5 : 4) &&
      state.version.endsWith(EDITION_SUFFIX) &&
      state.words > 10000 &&
      state.timeout === "function" &&
      state.finished &&
      // DF-16: the native splash held until the first screen was drawn
      // (well within eight seconds), then the bar ran to about two seconds.
      state.launch.cover === null &&
      state.launch.bridge === "function" &&
      state.launch.lifted === true &&
      typeof state.launch.drawn === "number" &&
      state.launch.drawn < 8000 &&
      state.launch.drawn + state.launch.hold >= 1900;
    return state;
  });

  await step("ranges", async () => {
    const index = readJson("data/example_audio_v1/index.json");
    const pack = "data/example_audio_v1/" + index.packs[0];
    // A long file read from the middle and to its end: a classics narration,
    // or in the public edition (no classics) the first example pack again.
    let mp3 = pack;
    let middle = 3000000;
    if (profile.classics) {
      const catalog = readJson("data/classics_v1/catalog.json");
      const narrated = catalog.books.find((b) => b.audio);
      const bookIndex = readJson(`data/classics_v1/${narrated.id}/index.json`);
      mp3 = `data/classics_v1/${narrated.id}/${bookIndex.audio.file}`;
      middle = 5000000;
    }
    const packLocal = localSlice(pack, 1000, 1999);
    const mp3Local = localSlice(mp3, middle, middle + 99);
    const mp3TailLocal = localSlice(
      mp3,
      mp3Local.size - 100,
      mp3Local.size - 1,
    );
    const remote = await evaluate(
      `
      const read = async (url, range) => {
        const response = await fetch(url, range ? { headers: { Range: range } } : undefined);
        const body = new Uint8Array(await response.arrayBuffer());
        const digest = await crypto.subtle.digest("SHA-256", body);
        return { status: response.status, range: response.headers.get("Content-Range"), length: body.length,
          sha: Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join(""),
          head: String.fromCharCode.apply(null, Array.from(body.slice(0, 4))) };
      };
      return {
        pack: await read(${JSON.stringify("/" + pack)}, "bytes=1000-1999"),
        packStart: await read(${JSON.stringify("/" + pack)}, "bytes=0-3"),
        packWhole: await read(${JSON.stringify("/" + pack)}),
        packPast: await read(${JSON.stringify("/" + pack)}, "bytes=999999999-").catch((error) => ({ rejected: String(error) })),
        mp3: await read(${JSON.stringify("/" + mp3)}, "bytes=${middle}-${middle + 99}"),
        mp3Tail: await read(${JSON.stringify("/" + mp3)}, "bytes=${mp3Local.size - 100}-"),
      };`,
      60000,
    );
    remote.passed =
      remote.pack.status === 206 &&
      remote.pack.length === 1000 &&
      remote.pack.sha === packLocal.sha &&
      remote.pack.range === `bytes 1000-1999/${packLocal.size}` &&
      remote.packStart.head === "OggS" &&
      remote.packWhole.status === 200 &&
      remote.packWhole.length === packLocal.size &&
      // WebView fails a range past the end inside its own loader.
      !!remote.packPast.rejected &&
      remote.mp3.status === 206 &&
      remote.mp3.length === 100 &&
      remote.mp3.sha === mp3Local.sha &&
      remote.mp3Tail.status === 206 &&
      remote.mp3Tail.length === 100 &&
      remote.mp3Tail.sha === mp3TailLocal.sha &&
      remote.mp3Tail.range ===
        `bytes ${mp3Local.size - 100}-${mp3Local.size - 1}/${mp3Local.size}`;
    remote.pack.expected = packLocal;
    remote.mp3.expected = mp3Local;
    remote.mp3.file = mp3;
    return remote;
  });

  // Strict sample of example-sentence clips as the app requests them: one
  // byte range per clip (the first clip, then the clip nearest the end of
  // each further pack), answered with 206 and exactly the clip's bytes.
  await step("clips", async () => {
    const sample = await evaluate(
      `
      const base = "/data/example_audio_v1/";
      const index = await (await fetch(base + "index.json")).json();
      const entries = [];
      for (const shardPath of index.shards.slice(0, 4)) {
        const shard = await (await fetch(base + shardPath)).json();
        for (const [key, entry] of Object.entries(shard)) entries.push([key, ...entry]);
      }
      const byOffset = entries.slice().sort((a, b) => a[2] - b[2]);
      const picks = [byOffset[0]];
      const seenPacks = new Set([byOffset[0][1]]);
      for (const entry of byOffset.slice().reverse()) {
        if (picks.length >= 8) break;
        if (seenPacks.has(entry[1])) continue;
        seenPacks.add(entry[1]);
        picks.push(entry);
      }
      const hex = (buffer) => Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
      const out = [];
      for (const [key, pack, offset, length] of picks) {
        const result = { key, pack: index.packs[pack], offset, length };
        try {
          const response = await fetch(base + index.packs[pack], { headers: { Range: "bytes=" + offset + "-" + (offset + length - 1) } });
          const buffer = await response.arrayBuffer();
          result.status = response.status;
          result.contentRange = response.headers.get("Content-Range");
          result.bytes = buffer.byteLength;
          result.head = String.fromCharCode(...new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength)));
          result.sha256 = hex(await crypto.subtle.digest("SHA-256", buffer));
        } catch (error) {
          result.error = String(error);
        }
        out.push(result);
      }
      return out;`,
      90000,
    );
    fs.writeFileSync(
      path.join(out, "clip-sample.json"),
      JSON.stringify(sample, null, 1),
    );
    const rows = sample.map((clip) => {
      const file = path.join(WWW, "data/example_audio_v1", clip.pack);
      const body = fs.readFileSync(file);
      const expected = sha256(
        body.subarray(clip.offset, clip.offset + clip.length),
      );
      const range = `bytes ${clip.offset}-${clip.offset + clip.length - 1}/${body.length}`;
      const ok =
        clip.status === 206 &&
        clip.bytes === clip.length &&
        clip.head === "OggS" &&
        clip.contentRange === range &&
        clip.sha256 === expected;
      return {
        pack: clip.pack,
        offset: clip.offset,
        length: clip.length,
        status: clip.status,
        contentRange: clip.contentRange,
        match: clip.sha256 === expected,
        ok,
        error: clip.error,
      };
    });
    const state = {
      clips: rows.length,
      maxOffset: Math.max(...rows.map((r) => r.offset)),
      packs: new Set(rows.map((r) => r.pack)).size,
      passed: rows.length >= 8 && rows.every((r) => r.ok),
      rows,
    };
    fs.writeFileSync(
      path.join(out, "clip-compare.json"),
      JSON.stringify(state, null, 1),
    );
    return state;
  });

  await step("exampleAudio", async () => {
    const state = await evaluate(
      `
      await window.__dc.tab("vocab");
      await window.__dc.sleep(800);
      document.querySelector(".cc-book-body .cc-card-body").click();
      await window.__dc.until(() => document.querySelector("#detailPanel.anchored-detail-open"));
      const ok = await window.__dc.until(() => document.documentElement.dataset.exampleAudio === "ready" && document.querySelector("#detailPanel .example-audio-btn"));
      const button = document.querySelector("#detailPanel .example-audio-btn");
      button.scrollIntoView({ block: "center" });
      const rect = button.getBoundingClientRect();
      const after = getComputedStyle(button, "::after");
      button.click();
      const playing = await window.__dc.until(() => button.dataset.state === "playing", 15000);
      return { ok: !!ok, playing, state: button.dataset.state, size: [rect.width, rect.height], hit: [after.width, after.height] };`,
      40000,
    );
    shot("02-example-audio");
    await sleep(1200);
    state.after1200ms = await evaluate(
      `const b = document.querySelector("#detailPanel .example-audio-btn"); const s = b.dataset.state; window.JPLearn.exampleAudio.stop(); window.__dc.back(); return s;`,
    );
    state.passed =
      state.playing && state.size[0] === 32 && state.hit[0] === "44px";
    return state;
  });

  await step("wordAudio", async () => {
    const state = await evaluate(
      `
      const word = window.appConfig.getCurrentWords()[0];
      window.VocabTTS.playOne(word.index);
      const advanced = await window.__dc.until(() => window.VocabTTS.audio && window.VocabTTS.audio.currentTime > 0.2, 15000);
      const t = window.VocabTTS.audio ? window.VocabTTS.audio.currentTime : -1;
      window.VocabTTS.stop();
      return { word: word.word, advanced, time: t };`,
      30000,
    );
    state.passed = state.advanced;
    return state;
  });

  await step("pageRead", async () => {
    const state = await evaluate(
      `
      // ART-22: reading aloud from the sheet, stop in the bar. DF-12: no 学 20
      // in the bar; the sheet's 随机学 20 词 is the study entry.
      const read = document.getElementById("mobileVocabReadPage");
      const bar = { study: !!document.getElementById("mobileVocabStudy"), readHidden: read.hidden };
      document.getElementById("mobileAppContextButton").click();
      await window.__dc.until(() => !document.getElementById("mobileFilterSheet").hidden, 5000);
      await window.__dc.sleep(400);
      const study = [...document.querySelectorAll("#mobileSheetCurrent .mobile-sheet-action")].some((b) => /^随机学 [0-9]+ 词$/.test(b.textContent.trim()));
      const proxy = [...document.querySelectorAll("#mobileSheetCurrent .mobile-sheet-action")].find((b) => b.textContent.includes("顺序朗读本页"));
      if (proxy) proxy.click();
      const started = await window.__dc.until(() => window.VocabTTS.isPlaying && !read.hidden && read.getAttribute("aria-pressed") === "true", 10000);
      await window.__dc.sleep(1500);
      const still = window.VocabTTS.isPlaying;
      // A tap at the stop button's centre must reach it (DF-12).
      const box = read.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      const tappable = !!hit && read.contains(hit);
      read.click();
      const stopped = await window.__dc.until(() => !window.VocabTTS.isPlaying && read.hidden, 5000);
      return { bar, study, proxy: !!proxy, started, still, tappable, stopped };`,
      30000,
    );
    state.passed =
      !state.bar.study &&
      state.study &&
      state.bar.readHidden &&
      state.tappable &&
      state.proxy &&
      state.started &&
      state.still &&
      state.stopped;
    return state;
  });

  await step("curlTurn", async () => {
    const state = await evaluate(
      `
      const frame = document.querySelector("#card-container .book-frame");
      const select = frame.querySelector(".book-page-select");
      const before = select.value;
      window.JPLearn.bookTurn && (window.JPLearn.bookTurn.lastFallback = null);
      frame.querySelector(".book-turn[data-book-flip='next']").click();
      await window.__dc.sleep(120);
      const layer = !!frame.querySelector(".book-flip-layer");
      const turning = frame.classList.contains("is-turning");
      const cleared = await window.__dc.until(() => !frame.querySelector(".book-flip-layer") && !frame.classList.contains("is-turning"), 5000);
      const after = select.value;
      return { before, after, layer, turning, cleared, fallback: window.JPLearn.bookTurn ? window.JPLearn.bookTurn.lastFallback : "no api" };`,
      20000,
    );
    shot("03-vocab-book");
    await evaluate(
      `const s = document.querySelector("#card-container .book-page-select"); s.value = "0"; s.dispatchEvent(new Event("change", { bubbles: true })); return true;`,
    );
    state.passed =
      state.after !== state.before &&
      state.layer &&
      state.cleared &&
      !state.fallback;
    return state;
  });

  // A real touch drag on the word book: a long swipe turns a page each way,
  // a short slow one springs back (book-pager.js, touch-action: pan-y).
  await step("swipeTurn", async () => {
    const READ = `
      const frame = document.querySelector("#card-container .book-frame");
      const body = frame.querySelector(".book-body");
      const rect = body.getBoundingClientRect();
      return { page: frame.querySelector(".book-page-select").value, scrollLeft: Math.round(body.scrollLeft), transform: body.style.transform, touchAction: getComputedStyle(body).touchAction, y: Math.round((rect.top + rect.height / 2) * devicePixelRatio), left: Math.round(rect.left * devicePixelRatio), width: Math.round(rect.width * devicePixelRatio) };`;
    const read = () => evaluate(READ);
    const swipe = (from, to, y, ms) =>
      adb("shell", "input", "swipe", from, y, to, y, ms);
    const start = await read();
    const at = (share) => String(Math.round(start.left + start.width * share));
    const y = String(start.y);
    swipe(at(0.85), at(0.15), y, "250");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const forward = await read();
    swipe(at(0.15), at(0.85), y, "250");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const back = await read();
    swipe(at(0.6), at(0.52), y, "700");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const short = await read();
    const state = {
      touchAction: start.touchAction,
      pages: [start.page, forward.page, back.page, short.page],
      scrollLeft: [forward.scrollLeft, back.scrollLeft, short.scrollLeft],
      transform: short.transform,
    };
    state.passed =
      state.touchAction.startsWith("pan-y") &&
      start.page === "0" &&
      forward.page === "1" &&
      forward.scrollLeft > 0 &&
      back.page === "0" &&
      short.page === "0" &&
      short.scrollLeft === 0 &&
      !short.transform;
    return state;
  });

  await step("textbookAudio", async () => {
    const state = await evaluate(
      `
      await window.__dc.tab("lesson");
      await window.__dc.until(() => window.ModuleSwitcher.getTextbookModule() && window.ModuleSwitcher.getTextbookModule().currentLesson && document.querySelector("#tbReader .book-frame"), 30000);
      const tb = window.ModuleSwitcher.getTextbookModule();
      let button = document.querySelector("#tbReader button[data-tts-mode^='reading:']:not([disabled])");
      if (!button) {
        document.getElementById("mobileAppContextButton").click();
        await window.__dc.until(() => document.getElementById("tbBookSelect"));
        const select = document.getElementById("tbBookSelect");
        if (select.value !== "KotobaFlow1") { select.value = "KotobaFlow1"; select.dispatchEvent(new Event("change", { bubbles: true })); }
        await window.__dc.until(() => tb.currentBookId === "KotobaFlow1" && document.querySelector(".tb-lesson-card[data-lesson-id='lesson_01']"), 30000);
        document.querySelector(".tb-lesson-card[data-lesson-id='lesson_01']").click();
        await window.__dc.until(() => tb.currentLessonId === "lesson_01" && document.querySelector("#tbReader button[data-tts-mode^='reading:']:not([disabled])"), 30000);
        await window.__dc.sleep(600);
        button = document.querySelector("#tbReader button[data-tts-mode^='reading:']:not([disabled])");
      }
      if (!button) return { book: tb.currentBookId, lesson: tb.currentLessonId, button: false };
      button.click();
      const advanced = await window.__dc.until(() => tb.ttsState.audio && !tb.ttsState.audio.paused && tb.ttsState.audio.currentTime > 0.3, 20000);
      const time = tb.ttsState.audio ? tb.ttsState.audio.currentTime : -1;
      const mini = !document.getElementById("mobileLessonMiniPlayer")?.hidden;
      return { book: tb.currentBookId, lesson: tb.currentLessonId, button: true, advanced, time, mini };`,
      60000,
    );
    shot("04-lesson-audio");
    // DF-06: pause in place, drag the track to the middle (a byte range from
    // a non-zero offset, which WebView 83 must play through), then resume.
    const player = await evaluate(
      `
      const tb = window.ModuleSwitcher.getTextbookModule();
      const audio = tb.ttsState.audio;
      const toggle = document.getElementById("mobileLessonMiniPause");
      const seek = document.getElementById("mobileLessonMiniSeek");
      if (!audio || !toggle || toggle.hidden) return { toggle: false };
      toggle.click();
      await window.__dc.sleep(500);
      const pausedAt = audio.currentTime;
      await window.__dc.sleep(800);
      const paused = { paused: audio.paused, held: audio.currentTime === pausedAt, shown: !document.getElementById("mobileLessonMiniPlayer").hidden, label: toggle.getAttribute("aria-label") };
      seek.value = "600";
      seek.dispatchEvent(new Event("input", { bubbles: true }));
      seek.dispatchEvent(new Event("change", { bubbles: true }));
      toggle.click();
      const target = audio.duration * 0.6;
      const played = await window.__dc.until(() => !audio.paused && audio.currentTime > target + 1, 20000);
      const stopRect = document.getElementById("mobileLessonMiniStop").getBoundingClientRect();
      return { toggle: true, paused, target, played, time: audio.currentTime, duration: audio.duration, error: audio.error ? audio.error.code : 0, stop: [stopRect.width, stopRect.height] };`,
      40000,
    );
    shot("04-lesson-audio-seeked");
    await evaluate(
      `document.getElementById("mobileLessonMiniStop")?.click(); return true;`,
    );
    state.player = player;
    state.passed =
      state.advanced === true &&
      player.toggle === true &&
      player.paused.paused &&
      player.paused.held &&
      player.paused.shown &&
      player.paused.label === "继续" &&
      player.played === true &&
      player.error === 0 &&
      player.time < player.target + 15 &&
      player.stop[1] <= 48;
    return state;
  });

  // The phone page (data-mobile-reader="page"): a running head in the app
  // bar, a frameless page with a folio, and the page heading's title,
  // actions and outline in the sheet's 本页 section. A jump from the
  // outline closes the sheet and leaves no focus ring.
  await step("phoneReader", async () => {
    const state = await evaluate(
      `
      const tb = window.ModuleSwitcher.getTextbookModule();
      const frame = document.querySelector("#tbReader .book-frame");
      const select = frame.querySelector(".book-page-select");
      select.value = String(Math.min(11, select.options.length - 1));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await window.__dc.sleep(900);
      const bar = document.getElementById("mobileAppBar").getBoundingClientRect();
      const nav = document.getElementById("mobileBottomNav").getBoundingClientRect();
      const rect = frame.getBoundingClientRect();
      const folio = frame.querySelector(".mobile-folio");
      // ART-B3: headings whose first line of text starts on a later page.
      const body = frame.querySelector(".book-body");
      const bounds = body.getBoundingClientRect();
      const column = body.clientWidth + (parseFloat(getComputedStyle(body).columnGap) || 0);
      const columnOf = (r) => Math.floor(((r.left - bounds.left) * (body.clientWidth / bounds.width) + body.scrollLeft + 2) / column);
      const range = document.createRange();
      const stranded = [...body.querySelectorAll(".tb-section-head, .tb-cgrammar-head, .tb-cgrammar-subhead")].filter((head) => {
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        walker.currentNode = head.lastChild || head;
        let text = walker.nextNode();
        while (text && (head.contains(text) || !text.textContent.trim())) text = walker.nextNode();
        if (!text) return false;
        range.selectNodeContents(text);
        const r = range.getClientRects()[0];
        return r && columnOf(r) > columnOf(head.getClientRects()[0]);
      }).map((head) => head.textContent.trim().slice(0, 20));
      return {
        stranded,
        breaks: body.querySelectorAll("[data-mobile-keep]").length,
        lesson: tb.currentBookId + "/" + tb.currentLessonId,
        width: innerWidth, height: innerHeight,
        barHeight: Math.round(bar.height),
        heading: document.getElementById("tbLessonHeading").getClientRects().length,
        outline: document.querySelector("#tbReader .tb-outline-slot").getClientRects().length,
        running: document.getElementById("mobileRunningTitle").textContent.trim(),
        aside: document.getElementById("mobileRunningAside").textContent.trim(),
        frameTop: Math.round(rect.top),
        frameHeight: Math.round(rect.height),
        bodyHeight: Math.round(frame.querySelector(".book-body").getBoundingClientRect().height),
        navTop: Math.round(nav.top),
        frameBorder: getComputedStyle(frame).borderTopWidth,
        folio: folio ? folio.textContent : "",
        pages: select.options.length,
      };`,
      30000,
    );
    shot("04b-phone-page");
    const sheet = await evaluate(
      `
      document.getElementById("mobileAppContextButton").click();
      await window.__dc.until(() => !document.getElementById("mobileFilterSheet").hidden, 5000);
      await window.__dc.sleep(500);
      const current = document.querySelector("#mobileSheetCurrent .mobile-sheet-outline-link[aria-current]");
      return {
        title: (document.getElementById("mobileSheetCurrentTitle") || {}).textContent || "",
        actions: [...document.querySelectorAll("#mobileSheetCurrent .mobile-sheet-action")].map((b) => b.textContent.trim()),
        sections: document.querySelectorAll("#mobileSheetCurrent .mobile-sheet-outline-link").length,
        current: current ? current.textContent : "",
        focus: document.activeElement ? document.activeElement.id : "",
        // DF-07: no 继续本课; 本课目录 and 教材册 fold.
        continueProxy: !!document.querySelector("#mobileSheetCurrent [data-sheet-action='continue']"),
        outlineOpen: (document.querySelector("#mobileSheetCurrent .mobile-sheet-outline-fold") || { open: null }).open,
        booksOpen: (document.querySelector("#mobileFilterContent .mobile-book-fold") || { open: null }).open,
      };`,
      20000,
    );
    shot("04c-phone-sheet");
    const jumped = await evaluate(
      `
      const select = document.querySelector("#tbReader .book-page-select");
      const before = select.value;
      const links = document.querySelectorAll("#mobileSheetCurrent .mobile-sheet-outline-link");
      links[links.length - 1].click();
      await window.__dc.sleep(900);
      const focused = document.activeElement;
      return {
        before, after: select.value, closed: document.getElementById("mobileFilterSheet").hidden,
        focus: { id: focused.id, tabindex: focused.getAttribute("tabindex"), outline: getComputedStyle(focused).outlineStyle },
      };`,
      20000,
    );
    shot("04c2-phone-outline-jump");
    Object.assign(state, { sheet, jumped });
    state.passed =
      state.stranded.length === 0 &&
      state.heading === 0 &&
      state.outline === 0 &&
      !!state.running &&
      !!state.aside &&
      state.frameTop <= state.barHeight + 2 &&
      state.frameTop + state.frameHeight <= state.navTop &&
      state.frameBorder === "0px" &&
      /^\d+(–\d+)? \/ \d+$/.test(state.folio) &&
      !!sheet.title &&
      sheet.sections > 1 &&
      !!sheet.current &&
      sheet.focus === "mobileFilterTitle" &&
      !sheet.continueProxy &&
      sheet.outlineOpen === false &&
      sheet.booksOpen === false &&
      jumped.closed &&
      jumped.after !== jumped.before &&
      (jumped.focus.tabindex !== "-1" || jumped.focus.outline === "none");
    return state;
  });

  // Today's calendar, and word and grammar pages: no item cut in two by a
  // page edge, and word entries part with the grammar rows' hairline (the
  // web draws it with color-mix(), which WebView 83 drops).
  await step("phoneModules", async () => {
    const SHOWN = `
      const shown = () => {
        const frame = [...document.querySelectorAll(".book-frame")].find((f) => f.getClientRects().length);
        if (!frame) return { frame: false };
        const items = frame.querySelectorAll(".tb-reading-vocab-row, .tb-dialogue-turn, .tb-cgrammar-examples > li, .tb-exercise-choice, .cc-card, .gm-card, .gm-brief-card");
        let cut = 0;
        items.forEach((el) => { if ([...el.getClientRects()].filter((r) => r.width && r.height).length > 1) cut++; });
        const rules = [...frame.querySelectorAll(".cc-card, .gm-card")].slice(0, 3).map((el) => {
          const style = getComputedStyle(el);
          return style.borderBottomStyle + " " + style.borderBottomWidth + " " + style.borderBottomColor;
        });
        return { items: items.length, cut, rules, pages: frame.querySelector(".book-page-select").options.length };
      };`;
    const today = await evaluate(
      `
      await window.__dc.tab("dashboard");
      await window.__dc.sleep(900);
      const cells = document.querySelectorAll("#dashboardMain .dashboard-activity-graph span.cg-cell:not(.cg-pad)");
      // DF-14a, DF-14b: the phone home keeps only these blocks, and nothing
      // sits under 今日学习 in the app bar.
      const blocks = { date: ".dashboard-eyebrow", plan: ".dashboard-plan-action", goal: ".dashboard-progress-card", calendar: ".dashboard-activity", recent: ".dashboard-recent", start: ".dashboard-start-card", tasks: ".dashboard-tasks", insights: "[data-dashboard-insights]", achievements: "[data-dashboard-achievements]" };
      const home = Object.keys(blocks).filter((name) => { const el = document.querySelector("#dashboardMain " + blocks[name]); return !!el && el.getBoundingClientRect().height > 0; });
      return { days: cells.length, cell: cells.length ? Math.round(cells[0].getBoundingClientRect().width) : 0, home, subtitle: document.getElementById("mobileAppBarSubtitle").textContent };`,
      30000,
    );
    shot("04d-phone-today");
    const vocab = await evaluate(
      SHOWN +
        `
      await window.__dc.tab("vocab");
      await window.__dc.until(() => document.querySelector("#card-container .book-frame"), 20000);
      await window.__dc.sleep(700);
      return Object.assign(shown(), { running: document.getElementById("mobileRunningTitle").textContent.trim() });`,
      30000,
    );
    shot("04e-phone-vocab");
    const grammar = await evaluate(
      SHOWN +
        `
      await window.__dc.tab("grammar");
      await window.__dc.until(() => document.querySelector("#gmGrammarList .book-frame"), 20000);
      await window.__dc.sleep(700);
      return shown();`,
      30000,
    );
    shot("04f-phone-grammar");
    await evaluate(
      `await window.__dc.tab("lesson"); await window.__dc.sleep(700); return true;`,
      30000,
    );
    const state = { today, vocab, grammar };
    state.passed =
      today.days > 0 &&
      today.cell > 0 &&
      today.home.join() === "date,plan,goal,calendar,recent" &&
      today.subtitle === "" &&
      vocab.items > 0 &&
      vocab.cut === 0 &&
      !!vocab.running &&
      grammar.items > 0 &&
      grammar.cut === 0 &&
      /^solid 1px /.test(grammar.rules[0] || "") &&
      vocab.rules.length === 3 &&
      vocab.rules.every((rule) => rule === grammar.rules[0]);
    return state;
  });

  // An open word on a phone is a page under the app bar: the running head
  // names it over the panel's label, the panel's heading row is gone, and
  // Back gives the running head back to the page.
  await step("wordDetail", async () => {
    const state = await evaluate(
      `
      await window.__dc.tab("vocab");
      await window.__dc.until(() => document.querySelector("#card-container .book-frame"), 20000);
      await window.__dc.sleep(600);
      const running = () => document.getElementById("mobileRunningTitle").textContent.trim();
      const listHead = running();
      const entry = [...document.querySelectorAll("#card-container .cc-card-body")].find((body) => {
        const r = body.getBoundingClientRect();
        return r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
      });
      entry.click();
      const word = () => document.querySelector("#detailPanel .vocab-detail-title-row h3");
      const named = await window.__dc.until(() => word() && running() === word().textContent.trim(), 20000);
      await window.__dc.sleep(500);
      if (window.VocabTTS && window.VocabTTS.stop) window.VocabTTS.stop();
      return {
        listHead,
        named,
        running: running(),
        aside: document.getElementById("mobileRunningAside").textContent.trim(),
        heading: getComputedStyle(document.querySelector("#detailPanel .detail-panel-header")).display,
        gap: Math.round(document.getElementById("detailContent").getBoundingClientRect().top - document.getElementById("mobileAppBar").getBoundingClientRect().bottom),
        focus: document.activeElement ? document.activeElement.id : "",
      };`,
      40000,
    );
    shot("04e2-phone-word-detail");
    state.after = await evaluate(
      `
      document.getElementById("mobileAppBarBack").click();
      await window.__dc.until(() => !document.body.classList.contains("mobile-detail-open"), 10000);
      await window.__dc.sleep(500);
      return document.getElementById("mobileRunningTitle").textContent.trim();`,
      20000,
    );
    state.passed =
      state.named &&
      state.aside === "词汇详情" &&
      state.heading === "none" &&
      Math.abs(state.gap) <= 1 &&
      state.after === state.listHead;
    return state;
  });

  // FIX-44 (web 47b8b04): the target-grammar briefs of an auxiliary lesson
  // show their marked grammar in bold, not as raw [[ ]].
  await step("grammarBriefs", async () => {
    const state = await evaluate(
      `
      await window.__dc.tab("grammar");
      await window.__dc.until(() => document.getElementById("gmSideNavLesson"), 20000);
      document.getElementById("gmSideNavLesson").click();
      await window.__dc.until(() => document.querySelector(".gm-lesson-card"), 20000);
      document.querySelector(".gm-lesson-card").click();
      await window.__dc.until(() => document.querySelector("#gmReaderTargets .gm-brief-card"), 20000);
      await window.__dc.sleep(900);
      const targets = document.getElementById("gmReaderTargets");
      const cards = [...targets.querySelectorAll(".gm-brief-card")];
      return {
        lesson: ((document.querySelector("#gmLessonReader .gm-reader-lesson-no") || {}).textContent || "").trim(),
        cards: cards.length,
        raw: cards.filter((card) => /\\[\\[|\\]\\]/.test(card.textContent)).length,
        bold: targets.querySelectorAll(".gm-brief-sample-ja strong, .gm-brief-sample-zh strong").length,
        first: ((targets.querySelector(".gm-brief-sample-ja") || {}).textContent || "").trim(),
        firstBold: ((targets.querySelector(".gm-brief-sample-ja strong") || {}).textContent || "").trim(),
      };`,
      40000,
    );
    const jump = await evaluate(
      `
      document.getElementById("mobileAppContextButton").click();
      await window.__dc.until(() => !document.getElementById("mobileFilterSheet").hidden, 5000);
      await window.__dc.sleep(400);
      const link = [...document.querySelectorAll("#mobileSheetCurrent .mobile-sheet-outline-link")].find((a) => /目标语法/.test(a.textContent));
      if (link) link.click();
      await window.__dc.sleep(1200);
      const card = document.querySelector("#gmReaderTargets .gm-brief-card");
      const r = card ? card.getBoundingClientRect() : null;
      const focused = document.activeElement;
      return {
        link: link ? link.textContent.trim() : "",
        closed: document.getElementById("mobileFilterSheet").hidden,
        cardOnScreen: !!r && r.width > 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight,
        focus: { tag: focused.tagName, tabindex: focused.getAttribute("tabindex"), outline: getComputedStyle(focused).outlineStyle },
      };`,
      20000,
    );
    shot("04g-phone-briefs");
    await evaluate(
      `
      document.getElementById("mobileAppBarBack").click();
      await window.__dc.sleep(700);
      await window.__dc.tab("lesson");
      await window.__dc.sleep(700);
      return true;`,
      30000,
    );
    state.jump = jump;
    state.passed =
      state.cards > 0 &&
      state.raw === 0 &&
      state.bold > 0 &&
      !!state.firstBold &&
      !!jump.link &&
      jump.closed &&
      (jump.focus.tabindex !== "-1" || jump.focus.outline === "none");
    return state;
  });

  // The grammar detail on a phone. The running head names the point over
  // the panel's label; the panel's heading row is gone; 开始练习 is gone
  // (DF-08); the section tabs make one bar. A script click
  // opens the point as a key would, and focus goes to the app bar's Back,
  // its close; a section tab focuses its summary and sets the section just
  // under the tabs, which stay under the app bar. Neither focus draws the
  // WebView ring without a key press. The comparison table reads as
  // entries; FIX-45/46 leave no raw [[ ]] or [object Object].
  await step("grammarDetail", async () => {
    const opened = await evaluate(
      `
      await window.__dc.tab("grammar");
      document.getElementById("gmSideNavGrammar").click();
      // Click a card on the shown page: the detail closes itself when its
      // anchor is off screen, and the other pages sit beside the screen.
      const visible = () => [...document.querySelectorAll("#gmGrammarList .gm-card")].find((card) => {
        const r = card.getBoundingClientRect();
        return r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
      });
      await window.__dc.until(visible, 20000);
      await window.__dc.sleep(500);
      visible().click();
      const open = await window.__dc.until(() => document.querySelector("#grammarDetailPanel.anchored-detail-open .gm-detail-outline"), 20000);
      if (!open) throw new Error("the grammar detail did not open");
      const title = () => document.querySelector("#grammarDetailPanel .gm-detail-title").textContent.trim();
      const running = () => document.getElementById("mobileRunningTitle").textContent.trim();
      await window.__dc.until(() => running() === title(), 10000);
      await window.__dc.sleep(700);
      const ring = () => {
        const node = document.activeElement;
        return { id: node.id, tag: node.tagName, outline: getComputedStyle(node).outlineStyle };
      };
      const edge = (selector, side) => Math.round(document.querySelector(selector).getBoundingClientRect()[side]);
      const first = ring();
      const top = {
        running: running(),
        aside: document.getElementById("mobileRunningAside").textContent.trim(),
        title: title(),
        heading: getComputedStyle(document.querySelector("#grammarDetailPanel .detail-panel-header")).display,
        panelTop: edge("#grammarDetailPanel", "top"),
        headerTop: edge("#grammarDetailPanel .gm-detail-header", "top"),
        tabsTop: edge("#grammarDetailPanel .gm-detail-outline", "top"),
        tabsBottom: edge("#grammarDetailPanel .gm-detail-outline", "bottom"),
        firstSection: edge("#grammarDetailPanel .gm-detail-section > summary", "top"),
        study: getComputedStyle(document.getElementById("gmStartPractice")).display,
      };
      document.querySelector("#grammarDetailPanel .gm-detail-nav-btn[data-section-target='gm-section-confusable']").click();
      await window.__dc.sleep(1200);
      const summary = ring();
      // What stays above a section read further down (CSS px = dp).
      const content = document.getElementById("gmDetailContent");
      const jump = {
        tabsTop: edge("#grammarDetailPanel .gm-detail-outline", "top"),
        tabsBottom: edge("#grammarDetailPanel .gm-detail-outline", "bottom"),
        sectionTop: edge("#gm-section-confusable", "top"),
        atEnd: content.scrollTop + content.clientHeight >= content.scrollHeight - 1,
      };
      const table = document.querySelector("#gm-section-confusable .gm-conf-table");
      const cells = table ? [...table.querySelector("tbody tr").children] : [];
      return {
        input: document.documentElement.dataset.mobileInput,
        top,
        jump,
        first,
        summary,
        table: !!table,
        display: cells.length ? getComputedStyle(cells[0]).display : "",
        widths: cells.length ? [Math.round(cells[0].getBoundingClientRect().width), Math.round(table.getBoundingClientRect().width)] : [],
        names: cells.slice(1).map((cell) => getComputedStyle(cell, "::before").content),
      };`,
      40000,
    );
    shot("04h-phone-grammar-detail");
    const marks = await evaluate(
      `
      const out = [];
      const panel = document.getElementById("grammarDetailPanel");
      const title = () => panel.querySelector(".gm-detail-title");
      for (const uid of ["N1-065", "N5-036"]) {
        // Opened as a search result is. Search is hidden over an open entry,
        // so Back comes first, and no one picks a result before the closed
        // entry has handed focus back: opened sooner, the new entry closes
        // when that focus lands outside it. A point off the list's page also
        // anchors the panel to the focused element, and one still inside the
        // old entry would close the panel as soon as the entry is redrawn.
        if (document.body.classList.contains("mobile-detail-open")) {
          document.getElementById("mobileAppBarBack").click();
          await window.__dc.until(() => !document.body.classList.contains("mobile-detail-open") && !panel.contains(document.activeElement), 10000);
          await window.__dc.sleep(500);
        }
        await window.ModuleSwitcher.openGrammarResult(uid);
        const shown = await window.__dc.until(() => window.grammarModule.grammarList.detailPanel.currentUid === uid && document.body.classList.contains("mobile-detail-open") && title(), 20000);
        const named = await window.__dc.until(() => document.getElementById("mobileRunningTitle").textContent.trim() === title().textContent.trim(), 5000);
        panel.querySelectorAll("details.gm-detail-section").forEach((section) => { section.open = true; });
        await window.__dc.sleep(300);
        const text = panel.textContent;
        out.push({
          uid,
          shown,
          named,
          raw: /\\[\\[|\\]\\]/.test(text),
          object: /\\[object Object\\]/.test(text),
          bold: panel.querySelectorAll("strong").length,
        });
      }
      return out;`,
      60000,
    );
    shot("04i-phone-grammar-marks");
    await evaluate(
      `
      document.getElementById("mobileAppBarBack").click();
      await window.__dc.sleep(700);
      await window.__dc.tab("lesson");
      await window.__dc.sleep(700);
      return true;`,
      30000,
    );
    const state = Object.assign(opened, { marks });
    const top = opened.top;
    state.passed =
      top.running === top.title &&
      top.aside === "语法详情" &&
      top.heading === "none" &&
      top.headerTop === top.panelTop &&
      top.study === "none" &&
      top.tabsBottom - top.tabsTop <= 46 &&
      opened.first.id === "mobileAppBarBack" &&
      opened.first.outline === "none" &&
      opened.summary.tag === "SUMMARY" &&
      opened.summary.outline === "none" &&
      opened.jump.tabsTop === top.panelTop &&
      (Math.abs(opened.jump.sectionTop - opened.jump.tabsBottom) <= 1 ||
        opened.jump.atEnd) &&
      opened.table &&
      opened.display === "block" &&
      opened.widths[0] === opened.widths[1] &&
      opened.names.join("|") === '"区别"|"何时用这个"|"何时不用"' &&
      marks.every(
        (mark) => mark.shown && mark.named && !mark.raw && !mark.object,
      );
    return state;
  });

  // DF-03/04/09/11a on WebView 83. KotobaFlow 3 lesson 1: the grammar
  // section folds under its heading; its 7th point (44 examples) shows three
  // and folds the rest under 更多例句, one row on the page. N3-139 (54
  // examples): the same fold in the detail, a folded example plays its
  // audio, the tabs follow the scrolling, and the entry closed last keeps
  // no bar over its text.
  await step("grammarFolds", async () => {
    const lesson = await evaluate(
      `
      const tb = window.ModuleSwitcher.getTextbookModule();
      await window.__dc.tab("lesson");
      document.getElementById("mobileAppContextButton").click();
      await window.__dc.until(() => document.getElementById("tbBookSelect"));
      const select = document.getElementById("tbBookSelect");
      if (select.value !== "KotobaFlow3") { select.value = "KotobaFlow3"; select.dispatchEvent(new Event("change", { bubbles: true })); }
      await window.__dc.until(() => tb.currentBookId === "KotobaFlow3" && document.querySelector(".tb-lesson-card[data-lesson-id='lesson_01']"), 30000);
      document.querySelector(".tb-lesson-card[data-lesson-id='lesson_01']").click();
      await window.__dc.until(() => tb.currentLessonId === "lesson_01" && document.querySelector("#tbReader .book-body .mobile-more-examples"), 30000);
      const close = document.getElementById("mobileFilterClose");
      if (close && close.getClientRects().length) close.click();
      await window.__dc.sleep(1200);
      if (window.__dc.module() !== "lesson" || !document.querySelector("#tbReader .book-body").getClientRects().length)
        throw new Error("the lesson is not on screen (" + window.__dc.module() + ")");
      // The pager is read each time: a lesson laid out again replaces it.
      const book = () => document.querySelector("#tbReader .book-frame")._mobilePager;
      const show = async (node) => { const pager = book(); pager.goTo(Math.floor(pager.columnOf(node) / pager.perSpread), false); await window.__dc.sleep(700); };
      const onPage = (node) => Math.floor(book().columnOf(node) / book().perSpread) === book().page;
      const point = document.querySelectorAll("#tbReader .tb-cgrammar")[6];
      const list = point.querySelector(".tb-cgrammar-examples");
      const toggle = point.querySelector(".mobile-more-examples");
      const shown = () => [...list.children].filter((item) => item.getClientRects().length).length;
      await show(toggle);
      const folded = { shown: shown(), label: toggle.textContent, height: Math.round(toggle.getBoundingClientRect().height), pages: book().spreads, onPage: onPage(toggle) };
      toggle.click();
      await window.__dc.sleep(900);
      const opened = { shown: shown(), label: toggle.textContent, pages: book().spreads, onPage: onPage(toggle) };
      toggle.click();
      await window.__dc.sleep(900);
      const refolded = { shown: shown(), pages: book().spreads, onPage: onPage(toggle) };
      const head = document.querySelector("#tbReader .tb-section-grammar > .tb-section-head");
      const points = () => [...head.parentElement.querySelectorAll(".tb-cgrammar")].filter((p) => p.getClientRects().length).length;
      await show(head);
      head.click();
      await window.__dc.sleep(900);
      const closed = { expanded: head.getAttribute("aria-expanded"), points: points(), pages: book().spreads, onPage: onPage(head) };
      return { folded, opened, refolded, closed };`,
      90000,
    );
    shot("04j-phone-lesson-grammar-folded");
    lesson.reopened = await evaluate(
      `
      const head = document.querySelector("#tbReader .tb-section-grammar > .tb-section-head");
      head.click();
      await window.__dc.sleep(900);
      return { expanded: head.getAttribute("aria-expanded"), pages: document.querySelector("#tbReader .book-frame")._mobilePager.spreads };`,
      30000,
    );
    const detail = await evaluate(
      `
      await window.__dc.tab("grammar");
      const panel = document.getElementById("grammarDetailPanel");
      await window.ModuleSwitcher.openGrammarResult("N3-139");
      await window.__dc.until(() => window.grammarModule.grammarList.detailPanel.currentUid === "N3-139" && document.body.classList.contains("mobile-detail-open") && panel.querySelector("#gm-section-examples .mobile-more-examples"), 20000);
      await window.__dc.sleep(800);
      const content = document.getElementById("gmDetailContent");
      const tabs = panel.querySelector(".gm-detail-outline");
      const active = () => tabs.querySelector(".gm-detail-nav-btn.active").getAttribute("data-section-target");
      const scrollTo = async (id) => {
        const summary = document.getElementById(id).querySelector("summary");
        content.scrollTop += summary.getBoundingClientRect().bottom - tabs.getBoundingClientRect().bottom + 40;
        await window.__dc.sleep(500);
        return active();
      };
      const follow = { examples: await scrollTo("gm-section-examples") };
      const body = panel.querySelector("#gm-section-examples .gm-detail-section-body");
      // The first list (example analysis); the toggle follows its last row.
      const toggle = body.querySelector(".mobile-more-examples");
      const rows = [...body.children].slice(0, [...body.children].indexOf(toggle)).filter((node) => node.matches(".gm-ex-card, .gm-ex-simple"));
      const fold = { rows: rows.length, shown: rows.filter((row) => row.getClientRects().length).length, label: toggle.textContent };
      toggle.click();
      await window.__dc.sleep(400);
      fold.opened = rows.filter((row) => row.getClientRects().length).length;
      const button = rows[rows.length - 1].querySelector(".example-audio-btn");
      button.scrollIntoView({ block: "center" });
      await window.__dc.until(() => document.documentElement.dataset.exampleAudio === "ready");
      button.click();
      fold.playing = await window.__dc.until(() => button.dataset.state === "playing", 15000);
      window.JPLearn.exampleAudio.stop();
      toggle.click();
      await window.__dc.sleep(400);
      fold.refolded = rows.filter((row) => row.getClientRects().length).length;
      follow.connection = await scrollTo("gm-section-connection");
      follow.confusable = await scrollTo("gm-section-confusable");
      // Back to the list, then open its first entry shown, as a tap does:
      // that entry carries the selection mark once it is closed.
      document.getElementById("mobileAppBarBack").click();
      await window.__dc.until(() => !document.body.classList.contains("mobile-detail-open") && !panel.contains(document.activeElement), 10000);
      await window.__dc.sleep(600);
      const visible = () => [...document.querySelectorAll("#gmGrammarList .gm-card")].find((card) => {
        const r = card.getBoundingClientRect();
        return r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
      });
      await window.__dc.until(visible, 20000);
      visible().click();
      await window.__dc.until(() => document.body.classList.contains("mobile-detail-open"), 20000);
      await window.__dc.sleep(800);
      return { follow, fold };`,
      60000,
    );
    shot("04k-phone-grammar-entry-reopened");
    const closed = await evaluate(
      `
      document.getElementById("mobileAppBarBack").click();
      await window.__dc.until(() => !document.body.classList.contains("mobile-detail-open"), 10000);
      await window.__dc.sleep(900);
      const card = document.querySelector("#gmGrammarList .gm-card-selected");
      const result = card ? { uid: card.dataset.uid, shadow: getComputedStyle(card).boxShadow } : null;
      // The lesson steps that follow start from the lesson, as after grammarDetail.
      await window.__dc.tab("lesson");
      await window.__dc.sleep(700);
      return result;`,
      30000,
    );
    const state = { lesson, detail, closed };
    state.passed =
      lesson.folded.shown === 3 &&
      lesson.folded.label === "更多例句（41）" &&
      lesson.folded.height <= 56 &&
      lesson.folded.onPage &&
      lesson.opened.shown === 44 &&
      lesson.opened.label === "收起例句" &&
      lesson.opened.pages > lesson.folded.pages &&
      lesson.refolded.shown === 3 &&
      lesson.refolded.pages === lesson.folded.pages &&
      lesson.refolded.onPage &&
      lesson.closed.expanded === "false" &&
      lesson.closed.points === 0 &&
      lesson.closed.pages < lesson.folded.pages &&
      lesson.closed.onPage &&
      lesson.reopened.expanded === "true" &&
      lesson.reopened.pages === lesson.folded.pages &&
      detail.fold.rows > 3 &&
      detail.fold.shown === 3 &&
      detail.fold.label === "更多例句（" + (detail.fold.rows - 3) + "）" &&
      detail.fold.opened === detail.fold.rows &&
      detail.fold.playing &&
      detail.fold.refolded === 3 &&
      detail.follow.examples === "gm-section-examples" &&
      detail.follow.connection === "gm-section-connection" &&
      detail.follow.confusable === "gm-section-confusable" &&
      !!closed &&
      closed.shadow === "none";
    return state;
  });

  await step("kanaAudio", async () => {
    const state = await evaluate(
      `
      const tb = window.ModuleSwitcher.getTextbookModule();
      document.getElementById("mobileAppContextButton").click();
      await window.__dc.until(() => document.getElementById("tbBookSelect"));
      const select = document.getElementById("tbBookSelect");
      if (select.value !== "KotobaFlow1") { select.value = "KotobaFlow1"; select.dispatchEvent(new Event("change", { bubbles: true })); }
      await window.__dc.until(() => tb.currentBookId === "KotobaFlow1" && document.querySelector(".tb-lesson-card[data-lesson-id='lesson_00']"), 30000);
      document.querySelector(".tb-lesson-card[data-lesson-id='lesson_00']").click();
      await window.__dc.until(() => tb.currentLessonId === "lesson_00" && document.querySelector("#tbReader .tb-kana-sound"), 30000);
      await window.__dc.sleep(600);
      // DF-22: the chart starts a page; each part sits on one page under its header.
      await window.__dc.until(() => document.querySelector("#tbReader .tb-section-kana [data-mobile-kana-part]"), 10000);
      const section = document.querySelector("#tbReader .tb-section-kana");
      const pager = section.closest(".book-frame")._mobilePager;
      const chart = Array.from(section.querySelectorAll(".tb-kana-table")).map((t) => ({ head: pager.columnOf(t.tHead), rows: t.tBodies[0].rows.length, pages: Array.from(new Set(Array.from(t.tBodies[0].rows).map((r) => pager.columnOf(r)))) }));
      const pageSelect = document.querySelector("#tbReader .book-page-select");
      pageSelect.value = String(pager.columnOf(section));
      pageSelect.dispatchEvent(new Event("change", { bubbles: true }));
      await window.__dc.sleep(800);
      const audios = [];
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () { audios.push(this); return play.apply(this, arguments); };
      try {
        const kana = document.querySelector("#tbReader .tb-kana-sound");
        kana.click();
        const advanced = await window.__dc.until(() => audios.some((a) => a.currentTime > 0.1 || a.ended), 15000);
        const detail = document.querySelector("#tbReader .tb-kana-detail");
        const card = detail.hasAttribute("data-mobile-kana-open") && getComputedStyle(detail).position === "fixed";
        return { advanced, chart, card, src: audios.map((a) => a.currentSrc.split("/").slice(-2).join("/")), sheet: document.getElementById("mobileFilterSheet")?.hidden };
      } finally { HTMLMediaElement.prototype.play = play; }`,
      90000,
    );
    shot("05-kana");
    state.passed =
      state.advanced &&
      state.card &&
      state.chart.length >= 2 &&
      state.chart.reduce((sum, part) => sum + part.rows, 0) === 11 &&
      state.chart.every(
        (part, index) =>
          part.pages.length === 1 &&
          part.pages[0] === part.head &&
          part.head === state.chart[0].head + index,
      );
    return state;
  });

  // DF-20 on WebView 83: a module fades in, an entry slides in from the
  // right and out again on Back before it closes.
  await step("transitions", async () => {
    const state = await evaluate(
      `
      await window.__dc.tab("dashboard");
      await window.__dc.sleep(400);
      document.querySelector("#mobileBottomNav [data-mobile-module='vocab']").click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const main = document.getElementById("vocabMain");
      const fade = { marked: main.hasAttribute("data-mobile-enter"), opacity: Number(getComputedStyle(main).opacity) };
      await window.__dc.until(() => document.querySelector("#card-container .cc-card .cc-word"), 20000);
      await window.__dc.sleep(500);
      fade.after = Number(getComputedStyle(main).opacity);
      document.querySelector("#card-container .cc-card .cc-word").click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const panel = document.querySelector(".detail-panel.anchored-detail-open");
      const shift = () => new WebKitCSSMatrix(getComputedStyle(panel).transform).m41;
      const slideIn = { first: shift() };
      await window.__dc.sleep(400);
      slideIn.settled = shift();
      window.__dc.back();
      await window.__dc.sleep(90);
      const slideOut = { open: panel.classList.contains("anchored-detail-open"), shift: shift(), leaving: window.KotobaFlowMobileShell.getState().detailLeaving };
      await window.__dc.sleep(450);
      slideOut.closed = !panel.classList.contains("anchored-detail-open");
      slideOut.layer = document.documentElement.dataset.mobileTopLayer;
      const result = { motion: document.documentElement.dataset.mobileMotion || "", fade, slideIn, slideOut };
      // The lesson steps that follow start from the lesson, as after grammarFolds.
      await window.__dc.tab("lesson");
      await window.__dc.sleep(700);
      return result;`,
      60000,
    );
    state.passed =
      state.fade.marked &&
      state.fade.opacity < 1 &&
      state.fade.after === 1 &&
      state.slideIn.first > 0 &&
      state.slideIn.settled === 0 &&
      state.slideOut.open &&
      state.slideOut.leaving &&
      state.slideOut.shift > 0 &&
      state.slideOut.closed &&
      state.slideOut.layer === "none";
    return state;
  });

  await step("dialogueAudio", async () => {
    const state = await evaluate(
      `
      const tb = window.ModuleSwitcher.getTextbookModule();
      document.getElementById("mobileAppContextButton").click();
      await window.__dc.until(() => document.querySelector(".tb-lesson-card[data-lesson-id='lesson_01']"), 30000);
      document.querySelector(".tb-lesson-card[data-lesson-id='lesson_01']").click();
      const found = await window.__dc.until(() => tb.currentLessonId === "lesson_01" && document.querySelector("#tbReader [data-tts-mode^='dialogue:']"), 30000);
      if (!found) return { book: tb.currentBookId, lesson: tb.currentLessonId, mode: null };
      await window.__dc.sleep(600);
      const mode = document.querySelector("#tbReader [data-tts-mode^='dialogue:']").getAttribute("data-tts-mode");
      tb._handleTtsButtonClick(mode);
      const advanced = await window.__dc.until(() => tb.ttsState.audio && !tb.ttsState.audio.paused && tb.ttsState.audio.currentTime > 0.5, 20000);
      await window.__dc.sleep(1500);
      const time = tb.ttsState.audio ? tb.ttsState.audio.currentTime : -1;
      const src = tb.ttsState.audio ? tb.ttsState.audio.currentSrc.split("/").slice(-3).join("/") : "";
      const turn = !!document.querySelector("#tbReader .tb-dialogue-turn.is-active, #tbReader .tb-dialogue-turn[aria-current]");
      return { book: tb.currentBookId, lesson: tb.currentLessonId, mode, advanced, time, src, turn };`,
      90000,
    );
    shot("05b-dialogue");
    await evaluate(
      `document.getElementById("mobileLessonMiniStop")?.click(); const tb = window.ModuleSwitcher.getTextbookModule(); tb._stopTtsPlayback && tb._stopTtsPlayback(); return true;`,
    );
    state.passed = !!state.mode && state.advanced && state.time > 1.5;
    return state;
  });

  await step("reloadTextbook", async () => {
    const before = await evaluate(`
      const tb = window.ModuleSwitcher.getTextbookModule();
      const select = document.querySelector("#tbReader .book-page-select");
      select.value = String(Math.min(2, select.options.length - 1));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await window.__dc.sleep(1200);
      await window.ProgressStore.save();
      return { url: location.pathname, book: tb.currentBookId, lesson: tb.currentLessonId, page: select.value };`);
    await evaluate(`setTimeout(() => location.reload(), 50); return true;`);
    await sleep(2500);
    await ready();
    const after = await evaluate(
      `
      await window.__dc.until(() => window.ModuleSwitcher.getTextbookModule() && window.ModuleSwitcher.getTextbookModule().currentLesson && document.querySelector("#tbReader .book-page-select"), 30000);
      await window.__dc.sleep(1500);
      const tb = window.ModuleSwitcher.getTextbookModule();
      return { url: location.pathname, module: window.ModuleSwitcher.getCurrentModule(), book: tb.currentBookId, lesson: tb.currentLessonId, page: document.querySelector("#tbReader .book-page-select")?.value };`,
      60000,
    );
    shot("06-after-reload");
    return {
      before,
      after,
      passed:
        after.module === "lesson" &&
        after.book === before.book &&
        after.lesson === before.lesson &&
        after.page === before.page,
    };
  });

  // The books on offer are exactly this edition's, and the classics tab is
  // there only when the edition packs the classics library.
  await step("editionBooks", async () => {
    const state = await evaluate(
      `
      await window.__dc.tab("lesson");
      document.getElementById("mobileAppContextButton").click();
      await window.__dc.until(() => document.getElementById("tbBookSelect"));
      const offered = Array.from(document.querySelectorAll("#tbBookSelect option")).map((o) => o.value).filter(Boolean);
      const current = window.ModuleSwitcher.getTextbookModule().currentBookId;
      window.__dc.back();
      await window.__dc.sleep(500);
      return {
        offered,
        current,
        classicsOffered: window.JPLearn.textbooks.classicsOffered(),
        classicsTab: !!document.querySelector('#mobileBottomNav [data-mobile-module="classics"]:not([hidden])'),
      };`,
      40000,
    );
    shot("06b-edition-books");
    state.passed =
      JSON.stringify(state.offered) === JSON.stringify(profile.books) &&
      profile.books.includes(state.current) &&
      state.classicsOffered === profile.classics &&
      state.classicsTab === profile.classics;
    return state;
  });

  if (profile.classics)
    await step("classics", async () => {
      const works = readJson("data/classics_v1/catalog.json").books.length;
      const state = await evaluate(
        `
      await window.__dc.tab("classics");
      const cl = window.ModuleSwitcher.getClassicsModule();
      await window.__dc.until(() => document.querySelector("#clReader .book-frame") && cl.reader.book, 30000);
      const catalog = cl.catalog.books;
      const narrated = catalog.find((b) => b.audio);
      if (cl.reader.currentBookId() !== narrated.id) {
        await cl.openWork(narrated.id);
        await window.__dc.until(() => cl.reader.currentBookId() === narrated.id && document.querySelector("#clReader .cl-audio-play"), 30000);
      }
      return { works: catalog.length, narrated: narrated.id, title: document.getElementById("mobileAppBarTitle").textContent, tab: document.querySelector('#mobileBottomNav [data-mobile-module="classics"]').textContent.trim(), subtitle: document.getElementById("mobileAppBarSubtitle").textContent, hash: location.hash };`,
        60000,
      );
      shot("07-classics");
      const audio = await evaluate(
        `
      const reader = window.ModuleSwitcher.getClassicsModule().reader;
      document.querySelector("#clReader .cl-audio-play").click();
      const playing = await window.__dc.until(() => reader.audio && !reader.audio.paused && reader.audio.currentTime > 0.2, 20000);
      const duration = reader.audio.duration;
      const target = Math.floor(duration * 0.6);
      reader._seek(target);
      const resumed = await window.__dc.until(() => reader.audio.currentTime > target + 1 && !reader.audio.paused, 20000, 200);
      const time = reader.audio.currentTime;
      const stillPlaying = !reader.audio.paused;
      const error = reader._audioError || (reader.audio.error && reader.audio.error.code) || "";
      reader.audio.pause();
      return { playing, duration, target, time, resumed, stillPlaying, error };`,
        60000,
      );
      shot("08-classics-seek");
      state.audio = audio;
      state.expectedWorks = works;
      state.passed =
        state.works === works &&
        state.hash === "#classics" &&
        // DF-15: the phone calls the module 拓展阅读.
        state.title === "拓展阅读" &&
        state.tab === "拓展阅读" &&
        audio.playing &&
        audio.resumed &&
        audio.time - audio.target < 25 &&
        audio.stillPlaying &&
        !audio.error;
      return state;
    });

  if (profile.classics)
    await step("classicsRestart", async () => {
      await restartApp();
      const state = await evaluate(
        `
      await window.__dc.until(() => window.ModuleSwitcher.getCurrentModule() === "classics" && window.__dc.module() === "classics", 30000);
      return { module: window.ModuleSwitcher.getCurrentModule(), nav: window.__dc.module(), hash: location.hash, note: localStorage.getItem("kotobaflow_mobile_last_view") };`,
        40000,
      );
      shot("09-classics-restart");
      state.passed =
        state.module === "classics" &&
        state.nav === "classics" &&
        state.hash === "#classics";
      return state;
    });

  await step("about", async () => {
    const row = await evaluate(
      `
      await window.__dc.tab("dashboard");
      document.getElementById("mobileAppContextButton").click();
      await window.__dc.until(() => document.documentElement.dataset.mobileTopLayer === "settings");
      await window.__dc.sleep(600);
      const trigger = document.querySelector("#mobileSettingsSheet #appAboutLink");
      trigger.scrollIntoView({ block: "center" });
      await window.__dc.sleep(500);
      const rect = trigger.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, dpr: window.devicePixelRatio };`,
      30000,
    );
    // A real tap, so the dialog sees a pointer-originated open.
    const webView = uiNodes(uiDump()).find(
      (node) => node.class === "android.webkit.WebView",
    );
    const [left, top] = /\[(\d+),(\d+)\]/
      .exec(webView.bounds)
      .slice(1)
      .map(Number);
    adb(
      "shell",
      "input",
      "tap",
      String(Math.round(left + row.x * row.dpr)),
      String(Math.round(top + row.y * row.dpr)),
    );
    const state = await evaluate(
      `
      await window.__dc.until(() => document.getElementById("mobileAboutDialog")?.open);
      await window.__dc.sleep(600);
      const dialog = document.getElementById("mobileAboutDialog");
      return { open: dialog.open, focusInside: dialog.contains(document.activeElement), version: document.getElementById("mobileAboutVersion").textContent, layer: document.documentElement.dataset.mobileTopLayer };`,
      30000,
    );
    shot("10-about");
    adb("shell", "input", "keyevent", "4");
    await sleep(1000);
    const closed = await evaluate(
      `return { open: document.getElementById("mobileAboutDialog").open, focus: document.activeElement && document.activeElement.id, layer: document.documentElement.dataset.mobileTopLayer };`,
    );
    adb("shell", "input", "keyevent", "4");
    await sleep(800);
    state.afterBack = closed;
    state.afterSecondBack = await evaluate(
      `return document.documentElement.dataset.mobileTopLayer || "none";`,
    );
    state.installedVersion = info.installedVersion;
    state.passed =
      state.open &&
      state.focusInside &&
      !!info.installedVersion &&
      // The dialog shows the release number without the edition.
      state.version.includes(info.installedVersion.split("-")[0]) &&
      !/offline|public/.test(state.version) &&
      state.layer === "dialog" &&
      !closed.open &&
      closed.focus === "appAboutLink" &&
      closed.layer === "settings" &&
      state.afterSecondBack === "none";
    return state;
  });

  await step("progress", async () => {
    const before = await evaluate(
      `return window.ProgressStore.getPlan().dailyMinutes;`,
    );
    const next = before === 25 ? 30 : 25;
    const applied = await evaluate(`
      await window.__dc.tab("dashboard");
      await window.__dc.until(() => (document.documentElement.dataset.mobileTopLayer || "none") === "none");
      document.querySelector("[data-dashboard-action='open-plan']").click();
      await window.__dc.until(() => document.documentElement.dataset.mobileTopLayer === "plan" && document.querySelector("[data-dashboard-plan-form]")?.offsetParent);
      await window.__dc.sleep(800);
      const input = document.getElementById("dashboardPlanMinutes");
      input.value = "${next}";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("[data-dashboard-plan-form] button[type='submit']").click();
      await window.__dc.until(() => window.ProgressStore.getPlan().dailyMinutes === ${next});
      await window.ProgressStore.save();
      return window.ProgressStore.getPlan().dailyMinutes;`);
    // WebView commits localStorage to disk a moment after the write; a
    // force-stop within about 0.2 s loses it, after 1 s it is kept.
    await sleep(1500);
    await restartApp();
    const after = await evaluate(
      `return window.ProgressStore.getPlan().dailyMinutes;`,
    );
    return {
      before,
      next,
      applied,
      after,
      passed: applied === next && after === next,
    };
  });

  await step("saf", async () => {
    // A marker the restore must bring back: the daily plan minutes.
    await evaluate(
      `const dialog = document.getElementById("archiveDialog"); if (dialog.open) document.getElementById("archiveClose").click(); return true;`,
    );
    const original = await evaluate(
      `return window.ProgressStore.getPlan().dailyMinutes;`,
    );
    const marker = original === 35 ? 40 : 35;
    await evaluate(
      `await window.__dc.tab("dashboard"); const plan = window.ProgressStore.getPlan(); plan.dailyMinutes = ${marker}; window.ProgressStore.updatePlan(plan); await window.ProgressStore.save(); return true;`,
    );
    const first = await exportThroughPicker("12-saf-export");
    const exportedMinutes = findValue(first.archive, "dailyMinutes");
    // Change the record, then replace it from the saved file.
    await evaluate(
      `const plan = window.ProgressStore.getPlan(); plan.dailyMinutes = 20; window.ProgressStore.updatePlan(plan); await window.ProgressStore.save(); return true;`,
    );
    await evaluate(
      `document.getElementById("archiveChooseFile").click(); return true;`,
    );
    let entry = await waitNode(
      (node) => inDocumentsUi(node) && node.text === first.name,
      8000,
    );
    if (!entry) {
      const roots = await waitNode(
        (node) =>
          inDocumentsUi(node) &&
          /show roots|显示根目录/i.test(node["content-desc"] || ""),
        5000,
      );
      if (roots) tapNode(roots);
      const downloads = await waitNode(
        (node) => inDocumentsUi(node) && /^(downloads|下载)$/i.test(node.text),
        8000,
      );
      if (downloads) tapNode(downloads);
      entry = await waitNode(
        (node) => inDocumentsUi(node) && node.text === first.name,
        12000,
      );
    }
    if (!entry)
      throw new Error(
        "saved backup not listed in the system picker: " + first.name,
      );
    shot("13-saf-pick");
    // DocumentsUI ignores injected taps on its rows (they carry no finger
    // tool type); its keyboard selection is used instead: focus, then Enter.
    const entryTop = Number(/\[\d+,(\d+)\]/.exec(entry.bounds)[1]);
    let picked = false;
    for (let move = 0; move < 12 && !picked; move++) {
      adb("shell", "input", "keyevent", "KEYCODE_DPAD_DOWN");
      await sleep(500);
      const focused = uiNodes(uiDump()).find(
        (node) =>
          node.focused === "true" &&
          /item_root/.test(node["resource-id"] || ""),
      );
      if (!focused) continue;
      const [, top, , bottom] = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/
        .exec(focused.bounds)
        .slice(1)
        .map(Number);
      if (entryTop >= top && entryTop < bottom) {
        adb("shell", "input", "keyevent", "KEYCODE_ENTER");
        picked = true;
      }
    }
    if (!picked)
      throw new Error("could not focus the saved backup in the picker");
    const restore = await evaluate(
      `
      await window.__dc.until(() => !document.getElementById("archivePreview").hidden, 30000);
      const incoming = document.getElementById("archiveIncoming").textContent;
      const chosen = document.getElementById("archiveChosenFile")?.textContent || "";
      const mode = document.getElementById("archiveMode");
      mode.value = "replace";
      mode.dispatchEvent(new Event("change", { bubbles: true }));
      document.getElementById("archiveRestore").click();
      const saved = await window.__dc.until(() => !document.getElementById("archiveReload").hidden, 30000);
      return { incoming, chosen, saved, status: document.getElementById("archiveStatus").textContent };`,
      70000,
    );
    shot("14-saf-restored");
    await evaluate(
      `setTimeout(() => document.getElementById("archiveReload").click(), 50); return true;`,
    );
    await sleep(3000);
    await connect();
    await ready();
    const afterReload = await evaluate(
      `return window.ProgressStore.getPlan().dailyMinutes;`,
    );
    await restartApp();
    const afterRestart = await evaluate(
      `return window.ProgressStore.getPlan().dailyMinutes;`,
    );
    const second = await exportThroughPicker("15-saf-reexport");
    await evaluate(
      `document.getElementById("archiveClose").click(); return true;`,
    );
    const state = {
      marker,
      first: {
        name: first.name,
        path: first.path,
        bytes: first.bytes,
        status: first.status,
        minutes: exportedMinutes,
      },
      restore,
      afterReload,
      afterRestart,
      second: {
        name: second.name,
        path: second.path,
        bytes: second.bytes,
        status: second.status,
        minutes: findValue(second.archive, "dailyMinutes"),
      },
    };
    state.passed =
      !!first.path &&
      exportedMinutes === marker &&
      restore.saved &&
      afterReload === marker &&
      afterRestart === marker &&
      !!second.path &&
      second.name !== first.name &&
      state.second.minutes === marker;
    return state;
  });

  // "Send to another app" opens the system share sheet. The sheet does not
  // report a choice, so the status must not claim the backup was saved, and
  // closing the sheet with Back must leave it unchanged.
  await step("share", async () => {
    const opened = await evaluate(`
      const dialog = document.getElementById("archiveDialog");
      if (!dialog.open) document.getElementById("appArchiveOpen").click();
      await window.__dc.until(() => dialog.open);
      document.getElementById("archiveExport").click();
      await window.__dc.until(() => document.getElementById("mobileExportDialog")?.open);
      const name = document.getElementById("mobileExportFile").textContent;
      document.querySelector('[data-mobile-export="share"]').click();
      return { name };`);
    const chooser = await waitTop((top) => /ChooserActivity/.test(top));
    await sleep(800);
    shot("16-share-chooser");
    const readStatus = `return { status: document.getElementById("archiveStatus").textContent, exportOpen: !!document.getElementById("mobileExportDialog")?.open, archiveOpen: document.getElementById("archiveDialog").open };`;
    const during = await evaluate(readStatus);
    adb("shell", "input", "keyevent", "4");
    const back = await waitTop((top) => top.includes(PKG));
    await sleep(1000);
    shot("17-share-after-back");
    const after = await evaluate(readStatus);
    await evaluate(
      `const d = document.getElementById("archiveDialog"); if (d.open) document.getElementById("archiveClose").click(); return true;`,
    );
    return {
      file: opened.name,
      chooser,
      during,
      back,
      after,
      passed:
        chooser.ok &&
        during.status === SHARE_STATUS &&
        back.ok &&
        after.status === SHARE_STATUS,
    };
  });

  await step("dark", async () => {
    const original =
      (/Night mode:\s*(\w+)/.exec(adb("shell", "cmd", "uimode", "night")) ||
        [])[1] || "no";
    originalNightMode = original;
    adb("shell", "cmd", "uimode", "night", "yes");
    await sleep(3000);
    try {
      await connect();
      await ready();
    } catch (error) {}
    const state = await evaluate(
      `await window.__dc.sleep(800); return { theme: document.documentElement.dataset.theme, mode: document.documentElement.dataset.themeMode, hero: getComputedStyle(document.querySelector(".dashboard-start-card")).backgroundColor, body: getComputedStyle(document.body).backgroundColor };`,
    );
    shot("11-dark");
    adb("shell", "cmd", "uimode", "night", "no");
    await sleep(3000);
    try {
      await connect();
      await ready();
    } catch (error) {}
    state.lightAfter = await evaluate(
      `await window.__dc.sleep(800); return document.documentElement.dataset.theme;`,
    );
    state.originalNightMode = original;
    if (original !== "no") {
      adb("shell", "cmd", "uimode", "night", original);
      await sleep(3000);
      try {
        await connect();
        await ready();
      } catch (error) {}
    }
    originalNightMode = "";
    state.passed = state.theme === "dark" && state.lightAfter === "light";
    return state;
  });

  return info;
}

(async () => {
  let info = { serial, out };
  let crash = null;
  try {
    info = await main();
  } catch (error) {
    crash = String(error.stack || error);
    console.error(error);
  }
  await restoreDevice();
  let fatal = [];
  try {
    const logcat = adb("logcat", "-d", "-v", "threadtime");
    fs.writeFileSync(path.join(out, "logcat.txt"), logcat);
    fatal = logcat
      .split(/\r?\n/)
      .filter((line) => /FATAL EXCEPTION|ANR in lol\.kotobaflow/.test(line));
  } catch (error) {}
  const passed =
    !crash &&
    results.length > 0 &&
    results.every((r) => r.passed) &&
    !fatal.length;
  const report = { info, passed, crash, fatal, results };
  fs.writeFileSync(
    path.join(out, "device-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      passed,
      failed: results.filter((r) => !r.passed).map((r) => r.name),
      fatal: fatal.length,
      report: path.join(out, "device-report.json"),
    }),
  );
  if (cdp) cdp.close();
  if (forwardPort) {
    try {
      adb("forward", "--remove", "tcp:" + forwardPort);
    } catch (error) {}
  }
  process.exit(passed ? 0 : 1);
})();
