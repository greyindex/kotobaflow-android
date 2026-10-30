const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function runtime(options = {}) {
  const values = new Map();
  const faults = {};
  const storage = {
    getItem(key) {
      if (faults.read) throw new DOMException("blocked", "SecurityError");
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (faults.write) throw new DOMException("full", "QuotaExceededError");
      if (faults.dropWrite) return;
      values.set(key, value);
    },
  };
  const network = [];
  const window = {
    fetch: async (input) => {
      network.push(input);
      return new Response("asset");
    },
    location: { href: "http://localhost/" },
    ...options.window,
  };
  const navigator = { sendBeacon: () => true };
  const context = {
    window,
    navigator,
    localStorage: storage,
    sessionStorage: { setItem() {} },
    document: {
      documentElement: { setAttribute() {}, style: {} },
      readyState: "loading",
      addEventListener() {},
      getElementById() {
        return null;
      },
      ...options.document,
    },
    URL,
    Request,
    Response,
    DOMException,
    CustomEvent,
    Blob,
    setTimeout,
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../runtime/mobile-platform.js"),
      "utf8",
    ),
    context,
  );
  const key = "kotobaflow_android_progress_v1";
  return {
    window,
    context,
    navigator,
    faults,
    values,
    network,
    key,
    post: (
      revision,
      body = {
        version: 2,
        vocabulary: {},
        usage: {},
        plan: { dailyMinutes: 45 },
      },
    ) =>
      window.fetch("/api/progress", {
        method: "POST",
        headers: revision === undefined ? {} : { "If-Match": String(revision) },
        body: JSON.stringify(body),
      }),
  };
}

test("legacy storage keeps its contents and gains a revision on confirmed write", async () => {
  const r = runtime();
  r.values.set(
    r.key,
    JSON.stringify({ version: 2, vocabulary: { known: [7] }, usage: {} }),
  );
  const existing = await (await r.window.fetch("/api/progress")).json();
  assert.equal(existing.revision, 0);
  assert.deepEqual(existing.vocabulary.known, [7]);
  const response = await r.post(0, { ...existing, pending: true });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(r.values.get(r.key)).revision, 1);
  assert.equal(JSON.parse(r.values.get(r.key)).pending, undefined);
});

test("fresh and legacy minimal GET snapshots support the actual archive summary without writing or dropping old data", async () => {
  const archiveUI = fs.readFileSync(
    path.join(__dirname, "../web-source-backup/js/archive-ui.js"),
    "utf8",
  );
  const summarySource = archiveUI.slice(
    archiveUI.indexOf("  function summary("),
    archiveUI.indexOf("  async function download("),
  );
  for (const original of [
    null,
    { version: 1, vocabulary: { known: [7] }, usage: {} },
    {
      version: 2,
      revision: 19,
      vocabulary: { favorite: [9] },
      usage: { "2026-10-11": { focusedMs: 45000 } },
      plan: { dailyMinutes: 45 },
      navigation: {
        textbook: { bookId: "KotobaFlow3", lessonId: "lesson_40" },
      },
    },
  ]) {
    const r = runtime();
    const before = original === null ? null : JSON.stringify(original);
    if (before !== null) r.values.set(r.key, before);
    const response = await r.window.fetch("/api/progress");
    assert.equal(response.status, 200);
    const snapshot = await response.json();
    assert.equal(snapshot.version, 2);
    assert.equal(snapshot.revision, original?.revision || 0);
    assert.equal(r.values.get(r.key) ?? null, before);
    assert.match(
      vm.runInNewContext(summarySource + "summary(snapshot)", { snapshot }),
      /每日目标 .* 分钟/,
    );
    assert.equal(snapshot.navigation.version, 1);
    assert.equal(snapshot.plan.dailyNewWords, 20);
    if (original?.vocabulary.known)
      assert.deepEqual(snapshot.vocabulary.known, original.vocabulary.known);
    if (original?.plan) assert.equal(snapshot.plan.dailyMinutes, 45);
    if (original?.navigation)
      assert.deepEqual(
        snapshot.navigation.textbook,
        original.navigation.textbook,
      );
  }
});

test("present malformed nested progress is preserved and blocks both reads and writes", async () => {
  for (const changed of [
    { vocabulary: { known: null } },
    { vocabulary: { favorite: {} } },
    { vocabulary: { srsVersion: 2 } },
    { plan: null },
    { plan: { dailyMinutes: "45" } },
    { navigation: { vocab: [] } },
    { navigation: { version: 2 } },
    { usage: { "2026-10-11": { focusedMs: "broken" } } },
  ]) {
    const r = runtime();
    const stored = JSON.stringify({
      version: 2,
      vocabulary: {},
      usage: {},
      ...changed,
    });
    r.values.set(r.key, stored);
    assert.equal((await r.window.fetch("/api/progress")).status, 503);
    assert.equal((await r.post(0)).status, 503);
    assert.equal(r.values.get(r.key), stored);
    const healthy = runtime();
    assert.equal((await healthy.post(0, JSON.parse(stored))).status, 400);
    assert.equal(healthy.values.has(healthy.key), false);
  }
});

test("offline fetch accepts bundled assets but refuses all remote APIs without touching progress", async () => {
  const r = runtime();
  await r.post(0);
  const saved = r.values.get(r.key);
  assert.equal(
    await (await r.window.fetch("./data/grammar_index.json")).text(),
    "asset",
  );
  await assert.rejects(
    r.window.fetch(new URL("https://example.com/api/progress")),
    { name: "TypeError" },
  );
  assert.equal(
    (await r.window.fetch(new URL("http://localhost/api/progress"))).status,
    200,
  );
  for (const url of [
    "https://example.com/api/progress",
    "https://accounts.google.com/gsi/client",
    "//evil.example/data.json",
    "data:application/json,{}",
  ])
    await assert.rejects(r.window.fetch(url), { name: "TypeError" });
  assert.equal((await r.window.fetch("/api/tts/qwen/speak")).status, 503);
  assert.equal((await r.window.fetch("/api/cloud-progress")).status, 503);
  assert.equal(r.navigator.sendBeacon("https://example.com/", "{}"), false);
  assert.equal(r.values.get(r.key), saved);
  assert.deepEqual(r.network, ["./data/grammar_index.json"]);
});

test("archive export resolves only after native durable save and propagates cancellation/failure", async () => {
  let complete;
  let args;
  let calls = 0;
  const r = runtime({
    window: {
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          OfflineArchive: {
            pickArchive() {},
            saveArchive(value) {
              args = value;
              calls++;
              return new Promise((resolve) => {
                complete = resolve;
              });
            },
          },
        },
      },
    },
  });
  let done = false;
  const saving = r.window.JPLearnMobileFiles.saveArchive(
    '{"日本語":true}',
    "backup.json",
  ).then(() => {
    done = true;
  });
  await Promise.resolve();
  assert.equal(done, false);
  assert.equal(args.text, '{"日本語":true}');
  assert.equal(args.name, "backup.json");
  complete({ saved: true });
  await saving;
  const cancelled = r.window.JPLearnMobileFiles.saveArchive(
    "{}",
    "backup.json",
  );
  complete({ cancelled: true });
  await assert.rejects(cancelled, /已取消保存/);
  const failed = r.window.JPLearnMobileFiles.saveArchive("{}", "backup.json");
  complete({ saved: false });
  await assert.rejects(failed, /未能保存/);
  assert.equal(calls, 3);
  assert.equal(r.values.size, 0);
});

test("a backup sent to another app is not reported as saved or handed over", async () => {
  let saves = 0;
  const shared = [];
  const r = runtime({
    window: {
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          OfflineArchive: {
            pickArchive() {},
            saveArchive() {
              saves++;
              return Promise.resolve({ saved: true });
            },
          },
        },
      },
      KotobaFlowNativeShell: {
        chooseExport: async () => "share",
        shareExport: (file) => {
          shared.push(file);
          return true;
        },
      },
    },
  });
  const files = r.window.JPLearnMobileFiles;
  assert.equal(await files.saveArchive('{"a":1}', "backup.json"), "shared");
  assert.equal(saves, 0);
  assert.equal(
    JSON.stringify(shared),
    JSON.stringify([
      { name: "backup.json", type: "application/json", text: '{"a":1}' },
    ]),
  );
  // The share sheet reports neither the app chosen nor a cancel.
  const status = files.resultText("备份已保存。");
  assert.match(status, /分享面板/);
  assert.doesNotMatch(status, /已交给|已保存。/);
  r.window.KotobaFlowNativeShell.shareExport = () => false;
  await assert.rejects(
    files.saveArchive("{}", "backup.json"),
    /无法打开系统分享面板/,
  );
});

test("missing native archive plugin reports a usable error instead of pretending the save succeeded", async () => {
  const r = runtime({
    window: { Capacitor: { isNativePlatform: () => true, Plugins: {} } },
  });
  await assert.rejects(
    r.window.JPLearnMobileFiles.saveArchive("{}", "backup.json"),
    /本机存档组件不可用/,
  );
  assert.equal(r.values.size, 0);
});

test("native import reaches the upstream change handler without DataTransfer or FileList support", async () => {
  const ready = [];
  const actions = {};
  const changes = [];
  const status = { textContent: "" };
  const selected = { textContent: "尚未选择备份文件" };
  let chooseClick, openClick, selection;
  const choose = {
    disabled: false,
    addEventListener(name, handler) {
      chooseClick = handler;
    },
  };
  const open = {
    addEventListener(name, handler) {
      openClick = handler;
    },
  };
  const input = {
    disabled: false,
    addEventListener(name, handler) {
      actions[name] = handler;
    },
    dispatchEvent(event) {
      changes.push(event);
    },
    click() {
      selection = actions.click({ preventDefault() {} });
    },
  };
  let picked = { text: '{"日本語":true}', name: "archive.json" };
  runtime({
    window: {
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          OfflineArchive: {
            saveArchive() {},
            async pickArchive() {
              return picked;
            },
          },
        },
      },
    },
    document: {
      addEventListener(name, handler) {
        if (name === "DOMContentLoaded") ready.push(handler);
      },
      getElementById(id) {
        if (id === "archiveChooseFile") return choose;
        if (id === "archiveChosenFile") return selected;
        if (id === "appArchiveOpen") return open;
        return id === "archiveFile"
          ? input
          : id === "archiveStatus"
            ? status
            : null;
      },
    },
  });
  ready.forEach((handler) => handler());
  let prevented = false;
  await actions.click({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(changes.length, 1);
  const file = changes[0].detail.nativeFile;
  assert.equal(file.name, "archive.json");
  assert.equal(file.size, Buffer.byteLength(picked.text, "utf8"));
  assert.equal(await file.text(), picked.text);
  assert.equal(selected.textContent, "已选择：archive.json");
  assert.equal(choose.disabled, false);
  picked = { cancelled: true };
  chooseClick();
  await selection;
  assert.equal(changes.length, 1);
  assert.equal(selected.textContent, "已选择：archive.json");
  assert.equal(status.textContent, "");
  input.disabled = true;
  picked = { text: "{}", name: "不应选择.json" };
  chooseClick();
  await Promise.resolve();
  assert.equal(changes.length, 1);
  openClick();
  assert.equal(selected.textContent, "尚未选择备份文件");
});

test("quota and security failures cannot report success or replace a confirmed save", async () => {
  const r = runtime();
  await r.post(0);
  const saved = r.values.get(r.key);
  r.faults.write = true;
  assert.equal((await r.post(1)).status, 503);
  assert.equal(r.values.get(r.key), saved);
  r.faults.read = true;
  assert.equal((await r.window.fetch("/api/progress")).status, 503);
  assert.equal((await r.post(1)).status, 503);
  assert.equal(r.values.get(r.key), saved);
});

test("corrupt storage is preserved, not treated as a new user", async () => {
  for (const value of ["broken json", "null", "[]", '{"revision":-1}']) {
    const r = runtime();
    r.values.set(r.key, value);
    assert.equal((await r.window.fetch("/api/progress")).status, 503);
    assert.equal((await r.post(0)).status, 503);
    assert.equal(r.values.get(r.key), value);
  }
});

test("invalid structures and future versions cannot be accepted or overwrite an archive", async () => {
  const invalid = [
    {},
    { version: 2, usage: {} },
    { version: 2, vocabulary: {}, usage: null },
    { version: 2, vocabulary: [], usage: {} },
    { version: 2, vocabulary: {}, usage: [] },
    { version: 3, vocabulary: {}, usage: {} },
  ];
  for (const body of invalid) {
    const r = runtime();
    const saved = JSON.stringify(body);
    r.values.set(r.key, saved);
    assert.equal((await r.window.fetch("/api/progress")).status, 503);
    assert.equal((await r.post(0)).status, 503);
    assert.equal(r.values.get(r.key), saved);

    const healthy = runtime();
    await healthy.post(0);
    const confirmed = healthy.values.get(healthy.key);
    assert.equal((await healthy.post(1, body)).status, 400);
    assert.equal(healthy.values.get(healthy.key), confirmed);
  }
});

test("silently dropped writes fail verification while version 1 archives remain migratable", async () => {
  const r = runtime();
  r.values.set(
    r.key,
    JSON.stringify({ version: 1, vocabulary: { known: [7] }, usage: {} }),
  );
  const legacy = await (await r.window.fetch("/api/progress")).json();
  assert.deepEqual(legacy.vocabulary.known, [7]);
  const before = r.values.get(r.key);
  r.faults.dropWrite = true;
  assert.equal((await r.post(0, { ...legacy, version: 2 })).status, 503);
  assert.equal(r.values.get(r.key), before);
  r.faults.dropWrite = false;
  assert.equal((await r.post(0, { ...legacy, version: 2 })).status, 200);
  assert.deepEqual(JSON.parse(r.values.get(r.key)).vocabulary.known, [7]);
});

test("concurrent same-revision writes have only one winner; unversioned writes and Beacon are refused", async () => {
  const r = runtime();
  assert.equal((await r.post()).status, 428);
  const results = await Promise.all([r.post(0), r.post(0)]);
  assert.deepEqual(
    results.map((response) => response.status).sort(),
    [200, 409],
  );
  const saved = r.values.get(r.key);
  assert.equal(r.navigator.sendBeacon("/api/progress", "{}"), false);
  assert.equal(r.values.get(r.key), saved);
});

test("Request input and abort semantics are retained", async () => {
  const r = runtime();
  const request = new Request("http://localhost/api/progress", {
    method: "POST",
    headers: { "If-Match": "0" },
    body: JSON.stringify({ version: 2, vocabulary: {}, usage: {} }),
  });
  assert.equal((await r.window.fetch(request)).status, 200);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    r.window.fetch("/api/progress", { signal: controller.signal }),
    { name: "AbortError" },
  );
  const reason = new Error("caller cancelled");
  const custom = new AbortController();
  custom.abort(reason);
  await assert.rejects(
    r.window.fetch("/api/progress", { signal: custom.signal }),
    (error) => error === reason,
  );
});

test("missing AbortSignal.timeout is supplied and rejects an expired restore before modifying saved progress", async () => {
  // Match an older native environment: the timeout static method is absent,
  // while the existing AbortController still creates real request signals.
  const legacySignal = function AbortSignal() {};
  const r = runtime({ window: { AbortSignal: legacySignal, AbortController } });
  const signal = legacySignal.timeout(5);
  assert.equal(signal.aborted, false);
  assert.throws(() => legacySignal.timeout(-1), { name: "RangeError" });
  let aborts = 0;
  await new Promise((resolve) =>
    signal.addEventListener(
      "abort",
      () => {
        aborts++;
        resolve();
      },
      { once: true },
    ),
  );
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason.name, "TimeoutError");
  await assert.rejects(
    r.window.fetch("/api/progress", {
      method: "POST",
      headers: { "If-Match": "0" },
      body: JSON.stringify({ version: 2, vocabulary: {}, usage: {} }),
      signal,
    }),
    { name: "TimeoutError" },
  );
  assert.equal(aborts, 1);
  assert.equal(r.values.has(r.key), false);
});

test("a native AbortSignal.timeout implementation is left intact", () => {
  const existing = () => "native timeout";
  const NativeSignal = function AbortSignal() {};
  NativeSignal.timeout = existing;
  runtime({ window: { AbortSignal: NativeSignal, AbortController } });
  assert.equal(NativeSignal.timeout, existing);
});

test("native auto theme updates the web theme owner and appearance events without replacing user preference", () => {
  let nativeDark = true;
  const events = [];
  const r = runtime({
    window: {
      KotobaFlowNativeTheme: { isDark: () => nativeDark },
      matchMedia: () => ({ matches: false, addEventListener() {} }),
      addEventListener() {},
      dispatchEvent: (event) => {
        events.push(event.detail);
      },
    },
  });
  r.values.set("jp_learning_theme", "auto");
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../web-source-backup/js/theme.js"),
      "utf8",
    ),
    r.context,
  );
  assert.equal(r.window.AppTheme.getTheme(), "dark");
  assert.equal(events.at(-1).theme, "dark");
  nativeDark = false;
  r.window.__KOTOBAFLOW_APPLY_NATIVE_THEME__();
  assert.equal(r.window.AppTheme.getTheme(), "light");
  assert.equal(events.at(-1).mode, "auto");
  assert.equal(events.at(-1).theme, "light");
  assert.equal(r.values.get("jp_learning_theme"), "auto");
  r.window.AppTheme.setMode("dark");
  r.window.__KOTOBAFLOW_APPLY_NATIVE_THEME__();
  assert.equal(r.window.AppTheme.getTheme(), "dark");
  assert.equal(r.values.get("jp_learning_theme"), "dark");
});
