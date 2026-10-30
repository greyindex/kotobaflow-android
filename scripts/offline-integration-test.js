"use strict";

// Exercise the generated Android web package through its real mobile controls.
// Only the Android SAF boundary is substituted. Assets, decoding, archive
// validation, persistence, layout and all product event handlers are real.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { chromium, expect } = require(
  path.resolve(__dirname, "../web-source-backup/node_modules/@playwright/test"),
);

// The packaged edition (build receipt): the local eight books with the
// XinBian scenarios, or the public four KotobaFlow books.
const PROFILE = require("./build-profile").packagedProfile();

const ROOT = path.resolve(__dirname, "..");
const WEB = path.resolve(
  process.env.KOTOBAFLOW_OFFLINE_WEB || path.join(ROOT, "www"),
);
const OUTPUT = path.resolve(
  process.env.KOTOBAFLOW_OFFLINE_QA ||
    path.join(
      ROOT,
      "artifacts/offline-integration",
      new Date().toISOString().replace(/[:.]/g, "-"),
    ),
);
const ONLY = process.env.KOTOBAFLOW_OFFLINE_SCENARIO || "";
const report = {
  package: WEB,
  edition: PROFILE.edition,
  started: new Date().toISOString(),
  scenarios: [],
  screenshots: [],
};
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ogg": "audio/ogg",
  ".woff2": "font/woff2",
};
const BOOKS = PROFILE.books;
const LOCAL_BOOKS = BOOKS.includes("XinBian1");
let origin;
let browser;

async function serve() {
  assert.ok(
    fs.existsSync(path.join(WEB, "index.html")),
    "Prepare the mobile web package first",
  );
  const server = http.createServer((req, res) => {
    let name;
    try {
      name = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    // Like Capacitor's html5mode: a path whose last segment has no extension
    // (the web's /textbook/ module addresses) is answered with the app page.
    let relative = name.replace(/^\/+/, "");
    if (!path.posix.basename(relative).includes(".")) relative = "index.html";
    const file = path.resolve(WEB, relative);
    if (!file.startsWith(WEB + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      res.writeHead(404).end();
      return;
    }
    if (!stat.isFile()) {
      res.writeHead(404).end();
      return;
    }
    const headers = {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    };
    let start = 0;
    let end = stat.size - 1;
    let code = 200;
    if (req.headers.range) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      if (!range || Number(range[1]) >= stat.size) {
        res.writeHead(416).end();
        return;
      }
      start = Number(range[1]);
      end = range[2] ? Math.min(Number(range[2]), end) : end;
      headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
      code = 206;
    }
    headers["Content-Length"] = end - start + 1;
    res.writeHead(code, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const stream = fs.createReadStream(file, { start, end });
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(
      Number(process.env.KOTOBAFLOW_OFFLINE_PORT || 0),
      "127.0.0.1",
      resolve,
    );
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return server;
}

async function open(
  viewport = { width: 412, height: 844 },
  setup,
  features = {},
) {
  const context = await browser.newContext({
    viewport,
    hasTouch: true,
    serviceWorkers: "allow",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36",
  });
  const audit = {
    externalRequests: [],
    externalNavigations: [],
    responseFailures: [],
    pageErrors: [],
    consoleErrors: [],
    media: [],
  };
  const currentScenario = report.scenarios.at(-1);
  if (currentScenario) {
    currentScenario.networkAudits ||= [];
    currentScenario.networkAudits.push(audit);
  }
  context.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).origin !== origin
    )
      audit.externalRequests.push(request.url());
  });
  // Never send a failing product request to the actual internet.
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:/.test(url) && new URL(url).origin !== origin)
      return route.abort("blockedbyclient");
    return route.continue();
  });
  await context.addInitScript(
    ({ legacyAbortTimeout, form }) => {
      // Without a pin the runtime detects the form from the screen, as on a
      // device: a shorter side of 600 px or more runs the tablet web layout.
      if (form) localStorage.setItem("kotobaflow_form_factor", form);
      const originalTimeout = AbortSignal.timeout;
      if (legacyAbortTimeout)
        Object.defineProperty(AbortSignal, "timeout", {
          configurable: true,
          writable: true,
          value: undefined,
        });
      window.__offlineProbe = {
        originalTimeout,
        legacyAbortTimeout,
        timeoutMissingBeforeProduct: typeof AbortSignal.timeout !== "function",
        progressRequests: [],
        media: [],
        calls: [],
        files: [],
        picker: [],
        saveResults: [],
        nativeDark: false,
        serviceWorkers: [],
        clicks: [],
      };
      const external = (value) => {
        try {
          return (
            new URL(
              typeof value === "string" ? value : value.url,
              location.href,
            ).origin !== location.origin
          );
        } catch {
          return true;
        }
      };
      document.addEventListener(
        "click",
        (event) => {
          window.__offlineProbe.clicks.push({
            tag: event.target.tagName,
            id: event.target.id,
            className: String(event.target.className),
            html: event.target.outerHTML?.slice(0, 350),
          });
          window.__offlineProbe.clicks = window.__offlineProbe.clicks.slice(-8);
        },
        true,
      );
      const originalFetch = window.fetch;
      window.fetch = function (url, init) {
        if (external(url))
          window.__offlineProbe.calls.push({ kind: "fetch", url: String(url) });
        return originalFetch.call(this, url, init);
      };
      const originalPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        window.__offlineProbe.media.push(this);
        return originalPlay.call(this);
      };
      if (navigator.serviceWorker) {
        const register = navigator.serviceWorker.register.bind(
          navigator.serviceWorker,
        );
        navigator.serviceWorker.register = function (url, options) {
          window.__offlineProbe.serviceWorkers.push(String(url));
          return register(url, options);
        };
      }
      window.KotobaFlowNativeTheme = {
        isDark: () => window.__offlineProbe.nativeDark,
      };
      const files = {
        saveArchive: async (file) => {
          window.__offlineProbe.files.push(file);
          return window.__offlineProbe.saveResults.shift() || { saved: true };
        },
        pickArchive: async () => {
          const result = window.__offlineProbe.picker.shift() || {
            cancelled: true,
          };
          if (!result.deferred) return result;
          return new Promise((resolve) => {
            window.__offlineProbe.releasePicker = () => {
              delete window.__offlineProbe.releasePicker;
              resolve(result);
            };
          });
        },
      };
      // Match Capacitor's injected native bridge. registerPlugin belongs to the
      // imported JS SDK and is deliberately unavailable in this unbundled app.
      window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "android",
        Plugins: {
          OfflineArchive: files,
          App: { addListener: () => ({ remove() {} }) },
        },
        nativePromise: async (name, method, args) => {
          if (name !== "OfflineArchive" || !files[method])
            throw new Error(
              "Unexpected native plugin call " + name + "." + method,
            );
          return files[method](args);
        },
      };
    },
    {
      legacyAbortTimeout: !!features.legacyAbortTimeout,
      form: features.form || "",
    },
  );
  if (setup) await setup(context);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => audit.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") audit.consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico"))
      audit.responseFailures.push({
        url: response.url(),
        status: response.status(),
      });
  });
  page.on("framenavigated", (frame) => {
    if (
      frame === page.mainFrame() &&
      /^https?:/.test(frame.url()) &&
      new URL(frame.url()).origin !== origin
    )
      audit.externalNavigations.push(frame.url());
  });
  await page.goto(origin + "/index.html", { waitUntil: "domcontentloaded" });
  await ready(page);
  return { context, page, audit };
}

function isTablet(page) {
  return page.evaluate(
    () => document.documentElement.dataset.nativeForm === "tablet",
  );
}

async function ready(page) {
  await page.waitForFunction(
    () => {
      const root = document.documentElement;
      return (
        window.appConfig?.status === "ready" &&
        root.dataset.mobileShell ===
          (root.dataset.nativeForm === "tablet" ? "off" : "ready")
      );
    },
    null,
    { timeout: 45000 },
  );
  if (await isTablet(page)) {
    await expect(page.locator("#mobileBottomNav")).toHaveCount(0);
    await expect(page.locator("#moduleSwitcher")).toBeVisible();
  } else {
    // The four study modules, and 古典 when the edition packages its library.
    await expect(
      page.locator("#mobileBottomNav [data-mobile-module]:not([hidden])"),
    ).toHaveCount(PROFILE.classics ? 5 : 4);
  }
  await expect(page.locator("#loading")).toHaveClass(/hidden/);
  const timeoutSupport = await page.evaluate(() => ({
    legacy: window.__offlineProbe.legacyAbortTimeout,
    absentBeforeProduct: window.__offlineProbe.timeoutMissingBeforeProduct,
    available: typeof AbortSignal.timeout === "function",
    nativePreserved:
      AbortSignal.timeout === window.__offlineProbe.originalTimeout,
  }));
  assert.equal(
    timeoutSupport.available,
    true,
    "The offline runtime must provide a real timeout signal API",
  );
  if (timeoutSupport.legacy)
    assert.equal(timeoutSupport.absentBeforeProduct, true);
  else
    assert.equal(
      timeoutSupport.nativePreserved,
      true,
      "Existing browser AbortSignal.timeout must remain untouched",
    );
  await page.evaluate(() => {
    if (window.__offlineProbe.guardsObserved) return;
    window.__offlineProbe.guardsObserved = true;
    const guardedFetch = window.fetch;
    window.fetch = function (input, init) {
      const raw =
        typeof input === "string" || input instanceof URL
          ? String(input)
          : input.url;
      try {
        if (new URL(raw, location.href).pathname === "/api/progress") {
          const signal =
            init?.signal || (input instanceof Request ? input.signal : null);
          window.__offlineProbe.progressRequests.push({
            method:
              init?.method || (input instanceof Request ? input.method : "GET"),
            hasSignal: !!signal,
            aborted: !!signal?.aborted,
          });
        }
        if (new URL(raw, location.href).origin !== location.origin)
          window.__offlineProbe.calls.push({ kind: "guarded-fetch", url: raw });
      } catch {}
      return guardedFetch.call(this, input, init);
    };
  });
}

async function noOverflow(page) {
  const result = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.ok(
    result.scroll <= result.width + 1,
    `Page overflows: ${JSON.stringify(result)}`,
  );
}

async function shot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await noOverflow(page);
  const file = path.join(OUTPUT, name + ".png");
  await page.screenshot({ path: file, animations: "disabled" });
  report.screenshots.push(file);
}

async function moduleTab(page, name) {
  if (await isTablet(page)) {
    const button = page.locator(`#moduleSwitcher [data-module="${name}"]`);
    await button.click();
    await expect(button).toHaveAttribute("aria-current", "page");
    return;
  }
  await page.locator(`#mobileBottomNav [data-mobile-module="${name}"]`).click();
  await expect(
    page.locator(`#mobileBottomNav [data-mobile-module="${name}"]`),
  ).toHaveAttribute("aria-current", "page");
}

async function filter(page) {
  if (await isTablet(page)) {
    // The web layout opens its sidebar from the rail, or as a drawer behind
    // its own toggle at narrower widths.
    const toggle = page.locator("#tabletSidebarToggle");
    const rail = page.locator("#statusBarShowBtn");
    if (await toggle.isVisible()) {
      if ((await toggle.getAttribute("aria-expanded")) !== "true")
        await toggle.click();
    } else if ((await rail.getAttribute("aria-expanded")) !== "true") {
      await rail.click();
    }
    await page
      .locator("#unifiedSidebar")
      .evaluate((el) =>
        Promise.all(
          el
            .getAnimations()
            .map((animation) => animation.finished.catch(() => {})),
        ),
      );
    return;
  }
  if (!(await page.locator("#mobileFilterSheet").isVisible()))
    await page.locator("#mobileAppContextButton").click();
  await expect(page.locator("#mobileFilterSheet")).toBeVisible();
}

async function closeFilter(page) {
  if (await isTablet(page)) {
    const toggle = page.locator("#tabletSidebarToggle");
    if (
      (await toggle.isVisible()) &&
      (await toggle.getAttribute("aria-expanded")) === "true"
    )
      await toggle.click();
    return;
  }
  if (await page.locator("#mobileFilterSheet").isVisible())
    await page.locator("#mobileFilterClose").click();
  await expect(page.locator("#mobileFilterSheet")).toBeHidden();
}

async function settings(page) {
  await moduleTab(page, "dashboard");
  await page.locator("#mobileAppContextButton").click();
  await expect(page.locator("#mobileSettingsSheet")).toBeVisible();
}

async function dataSettings(page) {
  await settings(page);
  await page.locator("#mobileSettingsDataButton").click();
  await expect(page.locator("#mobileSettingsDataPage")).toBeVisible();
}

async function openArchive(page) {
  await dataSettings(page);
  await page.locator("#appArchiveOpen").click();
  await expect(page.locator("#archiveDialog")).toBeVisible();
  await expect(page.locator("#archiveFile")).toBeHidden();
  await expect(page.locator("#archiveChooseFile")).toBeVisible();
  await expect(page.locator("#archiveChooseFile")).toHaveText("选择备份文件");
  await expect(page.locator("#archiveChosenFile")).toHaveText(
    "尚未选择备份文件",
  );
}

async function pickArchive(page, text, options = {}) {
  const name = options.name || "test-backup.json";
  await page.evaluate((file) => window.__offlineProbe.picker.push(file), {
    text,
    name,
    deferred: !!options.holdPicker,
  });
  await page.locator("#archiveChooseFile").click();
  if (options.holdPicker) {
    await expect(page.locator("#archiveChooseFile")).toBeDisabled();
    await page.evaluate(() => window.__offlineProbe.releasePicker());
  }
  await expect
    .poll(() => page.evaluate(() => window.__offlineProbe.picker.length))
    .toBe(0);
  await expect(page.locator("#archiveStatus")).not.toHaveText("正在处理…");
  await expect(page.locator("#archiveChosenFile")).toHaveText(
    "已选择：" + name,
  );
  await expect(page.locator("#archiveChooseFile")).toBeEnabled();
}

async function lesson(page, book, lessonId) {
  await moduleTab(page, "lesson");
  await filter(page);
  // On a phone the sheet picks a textbook from list rows (ART-16) and the
  // select is hidden; the wide web layout keeps the select.
  const bookRow = page.locator(
    `#mobileFilterContent .mobile-book-row[data-book-id="${book}"]`,
  );
  if (await bookRow.count()) {
    // The rows fold under 教材册 (DF-07).
    const books = page.locator("#mobileFilterContent .mobile-book-fold");
    if ((await books.count()) && !(await books.evaluate((el) => el.open)))
      await books.locator(":scope > summary").click();
    await bookRow.click();
  } else {
    if (!(await page.locator("#tbBookSelect").isVisible())) {
      await page.screenshot({
        path: path.join(OUTPUT, "lesson-picker-hidden.png"),
      });
      throw new Error("Book picker hidden after opening the controls");
    }
    await page.locator("#tbBookSelect").selectOption(book);
  }
  const directory = page.locator(".tb-lesson-directory");
  if ((await directory.count()) && !(await directory.evaluate((el) => el.open)))
    await directory.locator("summary").click();
  const card = page.locator(`.tb-lesson-card[data-lesson-id="${lessonId}"]`);
  await card.click();
  await expect(card).toHaveAttribute("aria-current", "page");
  // Selecting a lesson commits navigation and closes its sheet asynchronously.
  await expect(page.locator("#mobileFilterSheet")).toBeHidden();
  await closeFilter(page);
  await expect(page.locator("#tbReader .book-frame")).toBeVisible();
  await page.waitForFunction(() => {
    const m = window.ModuleSwitcher.getTextbookModule();
    return m?.currentLesson && m?._bookPager?.spreads > 0 && !m._loading;
  });
  const cover = page.locator("#tbReader .tb-book-cover img");
  if (await cover.count()) {
    await expect
      .poll(() => cover.evaluate((img) => img.complete && img.naturalWidth > 0))
      .toBe(true);
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
}

async function outline(page, name) {
  // A phone page keeps 本课目录 in the filter sheet, under the page's actions.
  if (
    await page.evaluate(
      () => document.documentElement.dataset.mobileReader === "page",
    )
  ) {
    await filter(page);
    // 本课目录 opens folded (DF-07).
    const fold = page.locator("#mobileSheetCurrent .mobile-sheet-outline-fold");
    if ((await fold.count()) && !(await fold.evaluate((el) => el.open)))
      await fold.locator(":scope > summary").click();
    await page
      .locator("#mobileSheetCurrent .mobile-sheet-outline")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(page.locator("#mobileFilterSheet")).toBeHidden();
    return;
  }
  const menu = page.locator("#tbReader .tb-outline");
  if (!(await menu.evaluate((el) => el.open)))
    await menu.locator("summary").click();
  await menu.getByRole("link", { name, exact: true }).click();
}

// A curl turn (web 5417d47) lays frozen copies of the turning pages, controls
// included, over the frame until its motion ends.
async function turnSettled(book) {
  await expect(book.locator(".book-flip-layer")).toHaveCount(0);
}

// Choose the actual page containing a control using the user-facing page picker.
// DOM geometry only discovers the page; the product's pager is never commanded.
async function revealBookControl(page, control) {
  const book = control.locator(
    "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' book-frame ')][1]",
  );
  const picker = book.locator(".book-page-select");
  const values = await picker
    .locator("option")
    .evaluateAll((options) => options.map((option) => option.value));
  let candidates = values;
  if (values.length > 1) {
    await picker.selectOption(values[0]);
    await turnSettled(book);
    const x = await control.evaluate((el) => {
      const body = el.closest(".book-frame").querySelector(".book-body");
      return (
        el.getBoundingClientRect().left - body.getBoundingClientRect().left
      );
    });
    await picker.selectOption(values[1]);
    await turnSettled(book);
    const stride = await book
      .locator(".book-body")
      .evaluate((body) => body.scrollLeft);
    const nearest = Math.floor(x / stride);
    candidates = [
      ...new Set(
        [nearest, nearest - 1, nearest + 1, 0]
          .filter((n) => n >= 0 && n < values.length)
          .map((n) => values[n])
          .concat(values),
      ),
    ];
  }
  for (const value of candidates) {
    await picker.selectOption(value);
    await turnSettled(book);
    if (
      await control.evaluate((el) => {
        const body = el
          .closest(".book-frame")
          .querySelector(".book-body")
          .getBoundingClientRect();
        return [...el.getClientRects()].some(
          (r) =>
            r.width > 0 &&
            r.left >= body.left - 1 &&
            r.right <= body.right + 1 &&
            r.top >= body.top - 1 &&
            r.bottom <= body.bottom + 1,
        );
      })
    )
      return;
  }
  throw new Error(
    "No selectable page exposes control: " +
      (await control.evaluate((el) => el.outerHTML.slice(0, 250))),
  );
}

async function realAudio(page, control, label) {
  const count = await page.evaluate(() => window.__offlineProbe.media.length);
  await shot(page, "audio-" + label.replace(/[^a-z0-9]+/gi, "-"));
  await control.tap();
  try {
    await expect
      .poll(
        () =>
          page.evaluate(
            (count) =>
              window.__offlineProbe.media
                .slice(count)
                .some(
                  (audio) =>
                    audio.readyState >= 2 &&
                    Number.isFinite(audio.duration) &&
                    audio.duration > 0 &&
                    !audio.error,
                ),
            count,
          ),
        { timeout: 30000, message: label + " must decode packaged media" },
      )
      .toBe(true);
  } catch (error) {
    const state = await page.evaluate((count) => {
      const tts = window.ModuleSwitcher.getTextbookModule()?.ttsState;
      return {
        clicks: window.__offlineProbe.clicks,
        readerOnClick: typeof document.getElementById("tbReader").onclick,
        currentLesson:
          window.ModuleSwitcher.getTextbookModule()?.currentLessonId,
        count,
        media: window.__offlineProbe.media.map((audio) => ({
          src: audio.currentSrc || audio.src,
          ready: audio.readyState,
          duration: audio.duration,
          error: audio.error?.code,
          paused: audio.paused,
        })),
        tts: tts && {
          mode: tts.mode,
          lastMode: tts.lastMode,
          loading: tts.loading,
          statusText: tts.statusText,
        },
      };
    }, count);
    throw new Error(
      label + " did not decode packaged media: " + JSON.stringify(state),
      { cause: error },
    );
  }
  const media = await page.evaluate(
    (count) =>
      window.__offlineProbe.media.slice(count).map((audio) => ({
        src: audio.currentSrc || audio.src,
        duration: audio.duration,
        error: audio.error?.code || null,
      })),
    count,
  );
  for (const item of media) {
    assert.equal(
      new URL(item.src).origin,
      origin,
      label + " uses an external audio URL",
    );
    assert.ok(/\.ogg(?:\?|$)/.test(item.src), label + " must use packaged OGG");
  }
  await page.evaluate(() =>
    window.__offlineProbe.media.forEach((audio) => audio.pause()),
  );
  return media;
}

async function auditEnd(app, options = {}) {
  const calls = await app.page.evaluate(() => window.__offlineProbe.calls);
  assert.deepEqual(
    app.audit.externalRequests,
    [],
    "Offline product attempted external requests",
  );
  assert.deepEqual(
    app.audit.externalNavigations,
    [],
    "Offline product attempted external navigation",
  );
  assert.deepEqual(
    calls,
    [],
    "Offline product called the external fetch boundary",
  );
  assert.deepEqual(app.audit.pageErrors, [], "Uncaught product errors");
  const serviceWorkers = await app.page.evaluate(async () => ({
    attempts: window.__offlineProbe.serviceWorkers,
    actual: navigator.serviceWorker
      ? (await navigator.serviceWorker.getRegistrations()).map(
          (registration) => registration.scope,
        )
      : [],
  }));
  assert.deepEqual(
    serviceWorkers,
    { attempts: [], actual: [] },
    "Android must not register a PWA service worker",
  );
  const failures = app.audit.responseFailures.filter(
    (item) =>
      !(options.allowedFailures || []).some((pattern) =>
        pattern.test(item.url),
      ),
  );
  assert.deepEqual(
    failures,
    [],
    "Unexpected missing or failed packaged resources",
  );
  return app.audit;
}

async function scenario(name, body) {
  if (ONLY && !name.includes(ONLY)) return;
  const entry = { name, status: "running", started: new Date().toISOString() };
  report.scenarios.push(entry);
  console.log(`START ${name}`);
  try {
    entry.result = await body();
    entry.status = "passed";
  } catch (error) {
    entry.status = "failed";
    entry.error = error.stack || String(error);
    process.exitCode = 1;
  }
  entry.finished = new Date().toISOString();
  fs.writeFileSync(
    path.join(OUTPUT, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    `${entry.status.toUpperCase()} ${name}${entry.error ? "\n" + entry.error : ""}`,
  );
}

async function catalogScenario() {
  const app = await open();
  try {
    await moduleTab(app.page, "lesson");
    await filter(app.page);
    const offered = await app.page
      .locator("#tbBookSelect option")
      .evaluateAll((options) =>
        options.map((option) => option.value).filter(Boolean),
      );
    assert.deepEqual(offered, BOOKS);
    await closeFilter(app.page);
    const coverage = await app.page.evaluate(async () => {
      const results = [];
      for (const book of await TextbookLoader.getBooks()) {
        const index = await TextbookLoader.getBookIndex(book.id);
        const rows = [];
        for (const item of index.lessons) {
          const data = await TextbookLoader.getLesson(book.id, item.lesson_id);
          const words = await TextbookLoader.getLessonVocab(
            book.id,
            item.lesson_id,
          );
          rows.push({
            id: item.lesson_id,
            actual: data.lesson.item_id,
            words: words.length,
            enriched: words.filter(
              (word) => word.learning_enrichment?.senses?.length,
            ).length,
            wrongIdentity: words.some(
              (word) =>
                word.learning_enrichment &&
                word.learning_enrichment.textbook_uid !== word.textbook_uid,
            ),
          });
        }
        results.push({ id: book.id, rows });
      }
      return results;
    });
    const kotoba = coverage.filter((book) => book.id.startsWith("KotobaFlow"));
    assert.equal(
      kotoba.reduce((n, book) => n + book.rows.length, 0),
      77,
      "All 77 new lessons must load",
    );
    assert.equal(
      kotoba.reduce(
        (n, book) => n + book.rows.reduce((sum, row) => sum + row.words, 0),
        0,
      ),
      6518,
      "Full vocabulary enrichment batch must be present",
    );
    for (const book of coverage)
      for (const row of book.rows) {
        assert.equal(row.actual, row.id);
        assert.equal(
          row.wrongIdentity,
          false,
          `${book.id}/${row.id} enrichment identity`,
        );
        if (book.id.startsWith("KotobaFlow"))
          assert.equal(
            row.enriched,
            row.words,
            `${book.id}/${row.id} enrichment coverage`,
          );
      }
    for (const book of BOOKS) {
      const id = coverage
        .find((row) => row.id === book)
        .rows.find((row) => row.words > 0).id;
      await lesson(app.page, book, id);
      assert.ok(
        (await app.page.locator("#tbReader .book-body").innerText()).length >
          50,
        `${book} readable content`,
      );
      await noOverflow(app.page);
    }
    return { coverage, audit: await auditEnd(app) };
  } finally {
    await app.context.close();
  }
}

async function layoutScenario(viewport) {
  const app = await open(viewport);
  const page = app.page;
  const suffix = `${viewport.width}x${viewport.height}`;
  try {
    await shot(page, `dashboard-${suffix}`);
    for (const [name, host] of [
      ["vocab", "#card-container"],
      ["grammar", "#gmGrammarList"],
    ]) {
      await moduleTab(page, name);
      const book = page.locator(host + " .book-frame");
      await expect(book).toBeVisible();
      const picker = book.locator(".book-page-select");
      await expect
        .poll(() => picker.locator("option").count())
        .toBeGreaterThan(1);
      const start = await picker.inputValue();
      await book.locator(".book-turn.is-next").click();
      await expect(picker).not.toHaveValue(start);
      await book.locator(".book-turn.is-prev").click();
      await expect(picker).toHaveValue(start);
      await shot(page, `${name}-${suffix}`);
    }
    await lesson(page, "KotobaFlow1", "lesson_01");
    const picker = page.locator("#tbReader .book-page-select");
    await expect
      .poll(() => picker.locator("option").count())
      .toBeGreaterThan(5);
    await picker.selectOption("5");
    const saved = await page.evaluate(() =>
      ModuleSwitcher.getTextbookModule().exportNavigation(),
    );
    assert.ok(
      saved.bookAnchor.target.text,
      "Reading must save a text-unit anchor",
    );
    await page.evaluate(() => ProgressStore.save());
    await shot(page, `reading-${suffix}`);
    await moduleTab(page, "dashboard");
    await page.reload();
    await ready(page);
    // The mobile shell automatically resumes the saved content module after
    // app:ready. Wait for that asynchronous navigation instead of racing its
    // transition by clicking a dashboard button that is being hidden.
    await expect(page.locator("#tbReader .book-frame")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator("#tbBookSelect")).toHaveValue("KotobaFlow1");
    await expect(picker).toHaveValue("5");
    // Reopen at the other size as a new launch would. Resizing the open page
    // first lays the lesson out at an intermediate size, and the reader then
    // keeps the first unit beginning on that page; whether that one or the
    // saved unit is stored depended on how far the cover and fonts had loaded
    // (the public edition opens KotobaFlow1 sooner and stored the former).
    await page.goto("about:blank");
    await page.setViewportSize(
      viewport.width > 1000
        ? { width: 390, height: 844 }
        : { width: 1280, height: 720 },
    );
    await page.goto(origin + "/index.html", { waitUntil: "domcontentloaded" });
    await ready(page);
    await expect(page.locator("#tbReader .book-frame")).toBeVisible({
      timeout: 15000,
    });
    await expect
      .poll(
        () =>
          page.evaluate((anchor) => {
            const body = document.querySelector("#tbReader .book-body");
            if (!body) return false;
            const area = body.getBoundingClientRect();
            const section = [
              ...body.querySelectorAll(":scope > .tb-section"),
            ].find(
              (el) =>
                el
                  .querySelector(".tb-section-badge, .tb-wiki-title")
                  ?.textContent.trim() === anchor.target.section,
            );
            const target =
              section &&
              [
                ...section.querySelectorAll(
                  "header,p,li,h4,.tb-unit,.tb-dialogue-turn,.tb-reading-vocab-row,.tb-item,tr",
                ),
              ].find(
                (el) =>
                  el.textContent.replace(/\s+/g, " ").trim().slice(0, 160) ===
                  anchor.target.text,
              );
            return (
              !!target &&
              [...target.getClientRects()].some(
                (r) =>
                  r.right > area.left &&
                  r.left < area.right &&
                  r.bottom > area.top &&
                  r.top < area.bottom,
              )
            );
          }, saved.bookAnchor),
        { timeout: 20000 },
      )
      .toBe(true);
    await noOverflow(page);
    return { saved, audit: await auditEnd(app) };
  } finally {
    await app.context.close();
  }
}

async function preferencesScenario() {
  const app = await open();
  const page = app.page;
  try {
    await settings(page);
    // DF-14: the phone picks the page theme at the top of 配色与字体.
    await page.locator("#appAppearanceOpen").click();
    for (const mode of ["dark", "light", "auto"]) {
      await page
        .locator(`#mobileAppearanceTheme [data-theme-choice="${mode}"]`)
        .click();
      if (mode !== "auto")
        await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    }
    await page.locator("#appearanceClose").click();
    await expect(page.locator("#appearanceDialog")).toBeHidden();
    await page.evaluate(() => {
      window.__offlineProbe.nativeDark = true;
      window.__KOTOBAFLOW_APPLY_NATIVE_THEME__();
    });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.locator("#appAppearanceOpen").click();
    if (!(await page.locator("#appearanceDialog").isVisible())) {
      await page.screenshot({
        path: path.join(OUTPUT, "appearance-not-open.png"),
      });
      const state = await page.evaluate(() => ({
        dialog: document
          .getElementById("appearanceDialog")
          .outerHTML.slice(0, 500),
        topLayer: window.JPLearn.topLayer.getCurrent(),
        mobileLayer: document.documentElement.dataset.mobileTopLayer,
      }));
      throw new Error(
        "Appearance did not open: " +
          JSON.stringify({ state, audit: app.audit }),
      );
    }
    await expect(page.locator("#appearanceDialog")).toBeVisible();
    // Twelve looks since the web added 简洁 (plain) as its default.
    assert.equal(
      await page.locator("#appearancePresets [data-preset]").count(),
      12,
    );
    const preset = page.locator("#appearancePresets [data-preset]").last();
    const chosen = await preset.getAttribute("data-preset");
    await preset.click();
    const font = page.locator("#appearanceFont-japanese");
    const value = await font.locator("option").last().getAttribute("value");
    await font.selectOption(value);
    await shot(page, "appearance-mobile");
    await page.locator("#appearanceApply").click();
    await expect(page.locator("#appearanceDialog")).toBeHidden();
    // A density saved before DF-14 hid its row still applies after a reload.
    await page.evaluate(() =>
      localStorage.setItem("jp_learning_display_density", "compact"),
    );
    await page.reload();
    await ready(page);
    await settings(page);
    const kept = await page.evaluate(() => ({
      density: document.documentElement.dataset.density,
      densityRow: document
        .querySelector(".app-density-control:not(.app-reading-layout-control)")
        .getBoundingClientRect().height,
      theme: localStorage.getItem("jp_learning_theme"),
    }));
    assert.deepEqual(kept, { density: "compact", densityRow: 0, theme: "auto" });
    await page.evaluate(() =>
      localStorage.removeItem("jp_learning_display_density"),
    );
    await page.locator("#appAppearanceOpen").click();
    await page.locator("#appearanceEditMode").selectOption("dark");
    await expect(font).toHaveValue(value);
    await expect(
      page.locator(`#appearancePresets [data-preset="${chosen}"]`),
    ).toHaveAttribute("aria-pressed", "true");
    await page.locator("#appearanceClose").click();
    assert.equal(
      await page
        .locator("#appFeedbackOpen, #cloudArchiveOpen, #cloudDialog")
        .count(),
      0,
      "Online-only UI must be absent",
    );
    return { audit: await auditEnd(app) };
  } finally {
    await app.context.close();
  }
}

async function startPractice(page, mode) {
  await moduleTab(page, "vocab");
  await filter(page);
  await page.locator('[data-mobile-vocab-mode="study"]').click();
  await closeFilter(page);
  await page.locator(`[data-practice-mode="${mode}"]`).click();
  await page.locator('[data-count="20"]').click();
  await page.locator("#btnStartStudy").click();
  await expect(page.locator("#study-container")).toBeVisible();
}

async function nativeSaveScenario() {
  const app = await open(undefined, async (context) => {
    await context.addInitScript(() =>
      Object.defineProperty(Navigator.prototype, "onLine", {
        configurable: true,
        get: () => false,
      }),
    );
  });
  const page = app.page;
  try {
    assert.equal(await page.evaluate(() => navigator.onLine), false);
    async function plan(minutes) {
      await page.locator('[data-dashboard-action="open-plan"]').first().click();
      await page.locator("#dashboardPlanMinutes").fill(String(minutes));
      await page
        .locator('[data-dashboard-plan-form] button[type="submit"]')
        .click();
      await page.evaluate(() => ProgressStore.save());
    }
    await plan(35);
    await page.evaluate(() => {
      window.__restoreStorage = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "kotobaflow_android_progress_v1")
          throw new DOMException("test quota", "QuotaExceededError");
        return window.__restoreStorage.call(this, key, value);
      };
    });
    await plan(55);
    const failure = await page.evaluate(() => ({
      durable: JSON.parse(
        localStorage.getItem("kotobaflow_android_progress_v1"),
      ).plan.dailyMinutes,
      retry: JSON.parse(localStorage.getItem("jp_learning_progress_offline_v1"))
        .plan.dailyMinutes,
      status: document.getElementById("progressSyncStatus").textContent,
    }));
    assert.equal(failure.durable, 35);
    assert.equal(failure.retry, 55);
    assert.match(failure.status, /本机/);
    assert.match(failure.status, /重试/);
    assert.doesNotMatch(failure.status, /联网/);
    await page.reload();
    await ready(page);
    await page.evaluate(() => ProgressStore.save());
    assert.equal(
      await page.evaluate(() => ProgressStore.getPlan().dailyMinutes),
      55,
    );
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("kotobaflow_android_progress_v1"))
            .plan.dailyMinutes,
      ),
      55,
    );
    return { failure, audit: await auditEnd(app) };
  } finally {
    await app.context.close();
  }
}

async function storageScenario() {
  const app = await open();
  const page = app.page;
  try {
    await startPractice(page, "classic");
    const before = await page.evaluate(() => ({
      session: appConfig.studyMode.exportCheckpoint(),
      snapshot: StudyStorage.exportSnapshot(),
      progress: ProgressStore.exportProgress(),
    }));
    assert.equal(before.session.queueIndices.length, 20);
    await page.evaluate(() => {
      window.__restoreStorage = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "tgv_known")
          throw new DOMException("test quota", "QuotaExceededError");
        return window.__restoreStorage.call(this, key, value);
      };
    });
    await page.locator('[data-fb="known"]').click();
    await expect(page.locator(".study-save-error")).toContainText("尚未推进");
    assert.deepEqual(
      await page.evaluate(() => StudyStorage.exportSnapshot()),
      before.snapshot,
    );
    assert.deepEqual(
      await page.evaluate(() => appConfig.studyMode.exportCheckpoint()),
      before.session,
    );
    await page.evaluate(() => {
      Storage.prototype.setItem = window.__restoreStorage;
    });
    await page.locator('[data-fb="known"]').click();
    const answered = await page.evaluate(() =>
      appConfig.studyMode.exportCheckpoint(),
    );
    assert.notDeepEqual(answered, before.session);
    await page.evaluate(() => ProgressStore.save());
    await page.reload();
    await ready(page);
    await expect
      .poll(() => page.evaluate(() => appConfig.studyMode.exportCheckpoint()), {
        timeout: 15000,
      })
      .not.toBeNull();
    assert.deepEqual(
      (await page.evaluate(() => appConfig.studyMode.exportCheckpoint()))
        .queueIndices,
      answered.queueIndices,
    );
    await dataSettings(page);
    await page.evaluate(() => {
      window.__restoreStorage = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "tgv_known")
          throw new DOMException("test quota", "QuotaExceededError");
        return window.__restoreStorage.call(this, key, value);
      };
    });
    const preClear = await page.evaluate(() => ({
      session: appConfig.studyMode.exportCheckpoint(),
      snapshot: StudyStorage.exportSnapshot(),
    }));
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#appClearStudyData").click();
    await expect(page.locator("#appClearStudyDataStatus")).toContainText(
      "未确认",
    );
    assert.deepEqual(
      await page.evaluate(() => StudyStorage.exportSnapshot()),
      preClear.snapshot,
    );
    assert.deepEqual(
      await page.evaluate(() => appConfig.studyMode.exportCheckpoint()),
      preClear.session,
    );
    await page.evaluate(() => {
      Storage.prototype.setItem = window.__restoreStorage;
    });
    if (!(await page.locator("#appClearStudyData").isVisible())) {
      await shot(page, "clear-failure-retry-hidden");
      throw new Error(
        "Clear retry became hidden after storage failure: " +
          JSON.stringify(
            await page.locator("#appClearStudyData").evaluate((el) => {
              const nodes = [];
              for (let p = el; p; p = p.parentElement)
                nodes.push({
                  id: p.id,
                  className: p.className,
                  hidden: p.hidden,
                  open: p.open,
                  display: getComputedStyle(p).display,
                });
              return nodes;
            }),
          ),
      );
    }
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#appClearStudyData").click();
    await expect(page.locator("#appClearStudyDataStatus")).toHaveText(
      "学习记录已清空",
    );
    await page.evaluate(() => ProgressStore.save());
    await page.reload();
    await ready(page);
    const cleared = await page.evaluate(() => ({
      session: appConfig.studyMode.exportCheckpoint(),
      progress: ProgressStore.exportProgress(),
    }));
    assert.equal(cleared.session, null);
    assert.equal(cleared.progress.navigation.vocab.studySession, null);
    for (const field of [
      "known",
      "favorite",
      "grammarFavorite",
      "history",
      "srs",
    ])
      assert.deepEqual(cleared.progress.vocabulary[field], []);
    assert.deepEqual(cleared.progress.plan, before.progress.plan);
    return { audit: await auditEnd(app) };
  } finally {
    await app.context.close();
  }
}

async function mixedScenario() {
  const app = await open();
  const page = app.page;
  try {
    await startPractice(page, "mixed");
    for (let index = 0; index < 4; index++) {
      const options = page.locator(".practice-option");
      if (await options.count()) await options.first().click();
      else {
        await page.locator("#practiceAnswerInput").fill("テスト");
        await page.locator("#btnPracticeSubmit").click();
      }
      await expect(page.locator(".practice-feedback")).toBeVisible();
      await expect(page.locator("#btnPracticeNext")).toBeEnabled();
      await page.locator("#btnPracticeNext").click();
    }
    await shot(page, "mixed-practice-mobile");
    const checkpoint = await page.evaluate(() =>
      appConfig.studyMode.exportCheckpoint(),
    );
    await page.evaluate(() => ProgressStore.save());
    await page.reload();
    await ready(page);
    await expect
      .poll(() => page.evaluate(() => appConfig.studyMode.exportCheckpoint()), {
        timeout: 15000,
      })
      .not.toBeNull();
    const after = await page.evaluate(() =>
      appConfig.studyMode.exportCheckpoint(),
    );
    assert.deepEqual(after.queueIndices, checkpoint.queueIndices);
    assert.equal(after.currentIndex, checkpoint.currentIndex);
    return { checkpoint, audit: await auditEnd(app) };
  } finally {
    await app.context.close();
  }
}

async function archiveScenario() {
  const app = await open();
  const page = app.page;
  let target;
  try {
    // Produce the first real reading-unit bookmark through the book controls.
    // Its index 0 is a reading position, independent of vocabulary identities.
    await lesson(
      page,
      ...(LOCAL_BOOKS
        ? ["XinBian1", "lesson_02"]
        : ["KotobaFlow1", "lesson_01"]),
    );
    await page.locator("#tbReader .book-page-select").selectOption("0");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            ModuleSwitcher.getTextbookModule().exportNavigation().bookAnchor
              ?.target?.index,
        ),
      )
      .toBe(0);
    const readingBookmark = await page.evaluate(
      () => ModuleSwitcher.getTextbookModule().exportNavigation().bookAnchor,
    );
    assert.ok(readingBookmark.target.text);
    await startPractice(page, "classic");
    await page.locator('[data-fb="known"]').click();
    await openArchive(page);
    await page.locator("#archiveExport").click();
    await expect
      .poll(() => page.evaluate(() => window.__offlineProbe.files.length))
      .toBe(1);
    const file = await page.evaluate(() => window.__offlineProbe.files[0]);
    const exported = JSON.parse(file.text);
    assert.ok(
      exported.progress.navigation.vocab.studySession.queueIndices.length > 1,
    );
    assert.ok(exported.progress.vocabulary.srs.length > 0);
    assert.equal(
      exported.progress.navigation.textbook.bookAnchor.target.index,
      0,
    );
    assert.deepEqual(
      exported.progress.navigation.textbook.bookAnchor,
      readingBookmark,
    );
    await page.evaluate(() =>
      window.__offlineProbe.saveResults.push({ cancelled: true }),
    );
    await page.locator("#archiveExport").click();
    await expect(page.locator("#archiveStatus")).toContainText("取消");
    // A cancelled SAF picker must not enable import or mutate the document.
    await page.locator("#archiveChooseFile").click();
    await expect(page.locator("#archiveChosenFile")).toHaveText(
      "尚未选择备份文件",
    );
    await expect(page.locator("#archiveRestore")).toBeDisabled();
    for (const invalid of [
      "{invalid",
      JSON.stringify({ ...exported, archiveVersion: 999 }),
      JSON.stringify({ ...exported, contentVersion: "unrecognized-catalog" }),
    ]) {
      await pickArchive(page, invalid);
      await expect(page.locator("#archiveStatus")).not.toHaveText("正在处理…");
      await expect(page.locator("#archiveRestore")).toBeDisabled();
      assert.deepEqual(
        await page.evaluate(() => StudyStorage.exportSnapshot()),
        exported.progress.vocabulary,
      );
    }
    target = await open(undefined, undefined, { legacyAbortTimeout: true });
    await openArchive(target.page);
    const pickedName = "本机备份-课文与练习.json";
    await pickArchive(target.page, file.text, {
      name: pickedName,
      holdPicker: true,
    });
    if (!(await target.page.locator("#archivePreview").isVisible()))
      throw new Error(
        "Native archive preview rejected actual export: " +
          (await target.page.locator("#archiveStatus").textContent()),
      );
    await expect(target.page.locator("#archivePreview")).toBeVisible();
    await expect(target.page.locator("#archiveRestore")).toBeEnabled();
    await target.page.locator("#archiveChooseFile").click();
    await expect(target.page.locator("#archiveChosenFile")).toHaveText(
      "已选择：" + pickedName,
    );
    await expect(target.page.locator("#archivePreview")).toBeVisible();
    await expect(target.page.locator("#archiveRestore")).toBeEnabled();
    await shot(target.page, "archive-preview-mobile");
    await target.page.locator("#archiveMode").selectOption("replace");
    const beforeReplacementRequests = await target.page.evaluate(
      () => window.__offlineProbe.progressRequests.length,
    );
    await target.page.locator("#archiveRestore").click();
    await expect(target.page.locator("#archiveReload")).toBeVisible();
    const replacementRequests = await target.page.evaluate(
      (start) =>
        window.__offlineProbe.progressRequests
          .slice(start)
          .filter((request) => request.method === "POST"),
      beforeReplacementRequests,
    );
    assert.ok(
      replacementRequests.length > 0 &&
        replacementRequests.every(
          (request) => request.hasSignal && !request.aborted,
        ),
      "Old-WebView replacement must issue a real abortable progress write",
    );
    await expect(target.page.locator("#archiveChooseFile")).toBeDisabled();
    await expect(target.page.locator("#archiveFile")).toBeDisabled();
    await target.page.locator("#archiveBackup").click();
    await expect
      .poll(() =>
        target.page.evaluate(() => window.__offlineProbe.files.length),
      )
      .toBe(1);
    const beforeRestore = await target.page.evaluate(() =>
      JSON.parse(window.__offlineProbe.files[0].text),
    );
    assert.deepEqual(beforeRestore.progress.vocabulary.known, []);
    await target.page.locator("#archiveReload").click();
    await ready(target.page);
    await expect
      .poll(
        () =>
          target.page.evaluate(() => appConfig.studyMode.exportCheckpoint()),
        { timeout: 15000 },
      )
      .not.toBeNull();
    const restored = await target.page.evaluate(() =>
      ProgressStore.exportProgress(),
    );
    assert.deepEqual(restored.vocabulary, exported.progress.vocabulary);
    assert.deepEqual(restored.plan, exported.progress.plan);
    assert.deepEqual(restored.navigation.textbook.bookAnchor, readingBookmark);
    assert.deepEqual(
      restored.navigation.vocab.studySession.queueIndices,
      exported.progress.navigation.vocab.studySession.queueIndices,
    );
    // Importing the same archive in merge mode must not duplicate SRS/history.
    await openArchive(target.page);
    await pickArchive(target.page, file.text);
    await expect(target.page.locator("#archiveRestore")).toBeEnabled();
    await target.page.locator("#archiveMode").selectOption("merge");
    const beforeMergeRequests = await target.page.evaluate(
      () => window.__offlineProbe.progressRequests.length,
    );
    await target.page.locator("#archiveRestore").click();
    await expect(target.page.locator("#archiveReload")).toBeVisible();
    const mergeRequests = await target.page.evaluate(
      (start) =>
        window.__offlineProbe.progressRequests
          .slice(start)
          .filter((request) => request.method === "POST"),
      beforeMergeRequests,
    );
    assert.ok(
      mergeRequests.length > 0 &&
        mergeRequests.every((request) => request.hasSignal && !request.aborted),
      "Old-WebView merge must issue a real abortable progress write",
    );
    await expect(target.page.locator("#archiveChooseFile")).toBeDisabled();
    await target.page.locator("#archiveReload").click();
    await ready(target.page);
    await expect
      .poll(
        () =>
          target.page.evaluate(() => appConfig.studyMode.exportCheckpoint()),
        { timeout: 15000 },
      )
      .not.toBeNull();
    assert.deepEqual(
      await target.page.evaluate(
        () => ProgressStore.exportProgress().vocabulary,
      ),
      restored.vocabulary,
    );
    assert.deepEqual(
      await target.page.evaluate(
        () => ProgressStore.exportProgress().navigation.textbook.bookAnchor,
      ),
      readingBookmark,
    );
    return {
      savedName: file.name,
      pickedName,
      readingBookmark,
      legacyTimeout: {
        absentBeforeProduct: true,
        replacementRequests,
        mergeRequests,
      },
      audit: await auditEnd(app),
      restoredAudit: await auditEnd(target),
    };
  } finally {
    await app.context.close();
    if (target) await target.context.close();
  }
}

async function searchAndFavoritesScenario() {
  const app = await open();
  const page = app.page;
  try {
    await moduleTab(page, "vocab");
    const favorite = page.locator("#card-container .cc-fav").first();
    const index = Number(await favorite.getAttribute("data-fav"));
    await favorite.click();
    await expect(favorite).toHaveClass(/active/);
    await page.evaluate(() => {
      window.__restoreStorage = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "tgv_favorites")
          throw new DOMException("test quota", "QuotaExceededError");
        return window.__restoreStorage.call(this, key, value);
      };
    });
    await favorite.click();
    await expect(favorite).toHaveClass(/active/);
    assert.equal(
      await page.evaluate(
        (id) => StudyStorage.getWordStatus(id).isFavorite,
        index,
      ),
      true,
    );
    await page.evaluate(() => {
      Storage.prototype.setItem = window.__restoreStorage;
    });
    await favorite.click();
    await expect(favorite).not.toHaveClass(/active/);
    await page.locator("#card-container .cc-card-body").first().click();
    await expect(page.locator("#detailPanel")).toBeVisible();
    const media = await realAudio(
      page,
      page.locator("#detailPanel .vocab-detail-audio"),
      "JLPT detail word",
    );
    await shot(page, "vocabulary-detail-mobile");
    await page.locator("#mobileAppBarBack").click();
    await expect(page.locator("#detailPanel")).toBeHidden();
    await moduleTab(page, "grammar");
    const grammar = page.locator(".gm-card-fav").first();
    const uid = await grammar.getAttribute("data-grammar-fav");
    await grammar.click();
    await expect(grammar).toHaveClass(/active/);
    await page.locator("#mobileAppSearchButton").click();
    await page.locator("#globalSearchInput").fill("学生");
    await expect(
      page.locator("#globalSearchResults [data-search-index]").first(),
    ).toBeVisible();
    await shot(page, "global-search-mobile");
    await page
      .locator("#globalSearchResults [data-search-index]")
      .first()
      .click();
    await expect(page.locator("#detailPanel")).toBeVisible();
    // A learner reads the detail before returning; its search context must not
    // expire merely because an asynchronous navigation handoff once had a timer.
    await page.waitForTimeout(6200);
    await page.locator("#mobileAppBarBack").click();
    await expect(page.locator("#globalSearchOverlay")).toBeVisible();
    await expect(page.locator("#globalSearchInput")).toHaveValue("学生");
    await page.locator("button[data-global-search-close]").click();
    await page.evaluate(() => ProgressStore.save());
    await page.reload();
    await ready(page);
    assert.equal(
      await page.evaluate((id) => StudyStorage.isGrammarFavorite(id), uid),
      true,
    );
    assert.equal(
      await page.evaluate(
        (id) => StudyStorage.getWordStatus(id).isFavorite,
        index,
      ),
      false,
    );
    return { media, audit: await auditEnd(app) };
  } finally {
    await app.context.close();
  }
}

async function mediaScenario() {
  const app = await open();
  const page = app.page;
  const media = [];
  try {
    await lesson(page, "KotobaFlow1", "lesson_00");
    const kana = page.locator(".tb-kana-sound").first();
    await revealBookControl(page, kana);
    media.push(...(await realAudio(page, kana, "Kana")));
    await expect(page.locator(".tb-kana-detail").first()).toContainText("あ");
    await lesson(page, "KotobaFlow1", "lesson_01");
    for (const [kind, selector] of [
      ["reading", 'button[data-tts-mode="reading:body"]'],
      ["dialogue", 'button[data-tts-mode="dialogue:conversation"]'],
    ]) {
      const button = page.locator(`#tbReader ${selector}`).first();
      await expect(button).toBeAttached();
      await revealBookControl(page, button);
      media.push(...(await realAudio(page, button, kind)));
    }
    const word = page.locator("#tbReader [data-vocab-detail-index]").first();
    await revealBookControl(page, word);
    // On a phone one tap opens the word's entry and reads it aloud (phone
    // shell); a second tap on the entry's play button would stop it.
    media.push(...(await realAudio(page, word, "KotobaFlow word")));
    await expect(page.locator("#textbookDetailPanel")).toBeVisible();
    await page.locator("#mobileAppBarBack").click();
    await expect(page.locator("#textbookDetailPanel")).toBeHidden();
    await outline(page, "语法");
    await expect(page.locator("#tbReader .tb-cgrammar").first()).toBeVisible();
    // KotobaFlow teaches grammar inline; the independently linked grammar
    // library/course-return path currently belongs to the local XinBian books.
    if (LOCAL_BOOKS) {
      await lesson(page, "XinBian1", "lesson_02");
      await filter(page);
      const readingTools = page.locator(".tb-sidebar-reading-group");
      if (!(await readingTools.evaluate((el) => el.open)))
        await readingTools.locator(":scope > summary").click();
      const toggle = page.locator('[data-course-action="toggle"]');
      if ((await toggle.getAttribute("aria-expanded")) === "false")
        await toggle.click();
      const others = page.locator('[data-course-action="toggle-others"]');
      if (
        (await others.count()) &&
        (await others.getAttribute("aria-expanded")) === "false"
      )
        await others.click();
      await page
        .locator(
          'button[data-course-action="step"][data-course-step="grammar"]',
        )
        .click();
      await expect(
        page.locator("#mobileBottomNav [data-mobile-module='grammar']"),
      ).toHaveAttribute("aria-current", "page");
      await expect(page.locator("#gmCourseContext")).toContainText("本课");
      await page.locator(".gm-course-grammar-card").first().click();
      await expect(page.locator("#grammarDetailPanel")).toBeVisible();
      await shot(page, "course-grammar-detail-mobile");
      await page.locator("#mobileAppBarBack").click();
      await expect(page.locator("#grammarDetailPanel")).toBeHidden();
      // The phone folds the heading's 返回课文 into the app bar's Back.
      await page.locator("#mobileAppBarBack").click();
      await expect(page.locator("#tbReader .book-frame")).toBeVisible();
      await lesson(page, "XinBian1", "lesson_02");
      const reading = page
        .locator('#tbReader button[data-tts-mode="reading:body"]')
        .first();
      await revealBookControl(page, reading);
      media.push(...(await realAudio(page, reading, "XinBian reading")));
    }
    const sourceLinks = await page.locator('#tbReader a[href^="http"]').count();
    assert.equal(
      sourceLinks,
      0,
      "Offline textbook sources must be plain attribution, not external navigation",
    );
    // Only the XinBian books carry Wikipedia readings with an attribution.
    if (LOCAL_BOOKS)
      assert.ok(
        (
          await page.locator("#tbReader .tb-wiki-source").first().textContent()
        ).trim().length > 10,
        "Offline source attribution must remain readable",
      );
    return { media, sourceLinks, audit: await auditEnd(app) };
  } finally {
    await app.context.close();
  }
}

async function missingAudioScenario() {
  const app = await open(undefined, async (context) => {
    await context.route("**/kotobaflow_reading_chirp_v1/**/*.ogg*", (route) =>
      route.fulfill({
        status: 404,
        body: "Deliberately absent local recording",
      }),
    );
  });
  try {
    await lesson(app.page, "KotobaFlow1", "lesson_01");
    const control = app.page
      .locator('#tbReader button[data-tts-mode="reading:body"]')
      .first();
    await revealBookControl(app.page, control);
    await control.click();
    await expect
      .poll(() =>
        app.page.evaluate(
          () => ModuleSwitcher.getTextbookModule().ttsState.statusText,
        ),
      )
      .toMatch(/失败|不可用|无法/);
    assert.equal(
      await app.page.locator("#cloudArchiveOpen, #appFeedbackOpen").count(),
      0,
    );
    return {
      audit: await auditEnd(app, {
        allowedFailures: [/kotobaflow_reading_chirp_v1\/.*\.ogg/],
      }),
    };
  } finally {
    await app.context.close();
  }
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  assert.equal(
    fs.existsSync(path.join(WEB, "sw.js")),
    false,
    "Offline Android package must omit the web service worker asset",
  );
  report.runtimeHashes = Object.fromEntries(
    [
      "index.html",
      "js/mobile-platform.js",
      "js/mobile-shell.js",
      "css/mobile-layout.css",
    ].map((file) => [
      file,
      createHash("sha256")
        .update(fs.readFileSync(path.join(WEB, file)))
        .digest("hex"),
    ]),
  );
  const server = await serve();
  browser = await chromium.launch({ headless: true });
  try {
    await scenario("catalogs-and-enrichment", catalogScenario);
    for (const viewport of [
      { width: 1600, height: 900 },
      { width: 1280, height: 720 },
      { width: 390, height: 844 },
      { width: 412, height: 844 },
    ])
      await scenario(`default-books-and-restore-${viewport.width}`, () =>
        layoutScenario(viewport),
      );
    await scenario("settings-and-appearance", preferencesScenario);
    await scenario("native-progress-save-failure-recovery", nativeSaveScenario);
    await scenario("practice-save-failure-clear-reload", storageScenario);
    await scenario("mixed-practice-resume", mixedScenario);
    await scenario("native-file-archive-roundtrip", archiveScenario);
    await scenario(
      "search-details-favorites-offline",
      searchAndFavoritesScenario,
    );
    await scenario("real-offline-media-and-course-grammar", mediaScenario);
    await scenario(
      "missing-local-audio-no-online-fallback",
      missingAudioScenario,
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    report.changedRuntimeFilesDuringRun = Object.entries(report.runtimeHashes)
      .filter(
        ([file, before]) =>
          createHash("sha256")
            .update(fs.readFileSync(path.join(WEB, file)))
            .digest("hex") !== before,
      )
      .map(([file]) => file);
    if (report.changedRuntimeFilesDuringRun.length) process.exitCode = 1;
    report.finished = new Date().toISOString();
    fs.writeFileSync(
      path.join(OUTPUT, "report.json"),
      JSON.stringify(report, null, 2),
    );
  }
  console.log(
    `Offline integration: ${report.scenarios.filter((s) => s.status === "passed").length}/${report.scenarios.length} passed. Evidence: ${OUTPUT}`,
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
