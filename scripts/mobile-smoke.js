const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

let chromium;
try {
  ({ chromium } = require(
    path.join(
      __dirname,
      "..",
      "web-source-backup",
      "node_modules",
      "playwright",
    ),
  ));
} catch (error) {
  throw new Error(
    "Mobile smoke test needs web-source-backup/node_modules. Run npm --prefix web-source-backup ci first.",
    { cause: error },
  );
}

const requestedUrl = process.env.KOTOBAFLOW_MOBILE_TEST_URL || "";
let baseUrl = requestedUrl;
const viewports = [
  { width: 320, height: 844 },
  { width: 360, height: 844 },
  { width: 393, height: 844 },
  { width: 412, height: 844 },
  { width: 480, height: 844 },
  { width: 600, height: 844 },
  { width: 640, height: 844 },
  { width: 840, height: 900 },
  { width: 844, height: 412 },
];

async function appState(page) {
  return page.evaluate(() => ({
    shell: document.documentElement.dataset.mobileShell || "",
    viewport: document.documentElement.dataset.mobileViewport || "",
    orientation: document.documentElement.dataset.mobileOrientation || "",
    module:
      document.querySelector("#mobileBottomNav [aria-current='page']")?.dataset
        .mobileModule || "",
    topLayer: document.documentElement.dataset.mobileTopLayer || "none",
    contentGutter: getComputedStyle(document.documentElement)
      .getPropertyValue("--mobile-content-gutter")
      .trim(),
    overflowX:
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1,
    navCount: document.querySelectorAll(
      "#mobileBottomNav [data-mobile-module]:not([hidden])",
    ).length,
    shellCount: document.querySelectorAll("#mobileAppShell").length,
  }));
}

// Phone-shell checks pin the phone form factor so wide and landscape layouts
// of the shell stay covered; tablet checks pass form "auto" and let the
// screen size decide, as on a device.
async function openApp(browser, viewport, options = {}) {
  const { width, height } = viewport;
  const form = options.form || "phone";
  const page = await browser.newPage({
    viewport: { width, height },
    hasTouch: true,
    userAgent:
      form === "phone"
        ? "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36"
        : "Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  });
  await page.addInitScript(
    (value) => {
      try {
        if (value) localStorage.setItem("kotobaflow_form_factor", value);
        else localStorage.removeItem("kotobaflow_form_factor");
      } catch (error) {}
    },
    form === "auto" ? null : form,
  );
  if (options.reducedMotion) {
    await page.emulateMedia({ reducedMotion: options.reducedMotion });
  }
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    // A media element cancels its own loads when its source changes, when
    // metadata is all it preloads, or when the page navigates. Playback
    // checks and error responses still catch audio that does not load.
    if (
      request.resourceType() === "media" &&
      request.failure()?.errorText === "net::ERR_ABORTED"
    )
      return;
    errors.push(
      `requestfailed: ${request.url()} ${request.failure()?.errorText || "unknown"}`,
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
      errors.push(`response: ${response.status()} ${response.url()}`);
    }
  });
  await page.goto(baseUrl, { waitUntil: "commit", timeout: 10000 });
  if (form !== "phone") {
    await page.waitForFunction(
      () => window.appConfig?.status === "ready",
      null,
      { timeout: 20000 },
    );
    await page.waitForTimeout(600);
    return { page, errors };
  }
  await page.waitForSelector("#mobileAppShell", {
    state: "attached",
    timeout: 20000,
  });
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.mobileShell === "ready" &&
      window.appConfig?.status === "ready",
    null,
    { timeout: 20000 },
  );
  await page.evaluate(() => document.fonts.ready);
  return { page, errors };
}

function contentType(filePath) {
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".mp3": "audio/mpeg",
      ".ogg": "audio/ogg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".webmanifest": "application/manifest+json",
    }[path.extname(filePath).toLowerCase()] || "application/octet-stream"
  );
}

async function startLocalServer() {
  if (requestedUrl) return null;
  const webRoot = path.resolve(__dirname, "..", "www");
  const server = http.createServer((request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(request.url, "http://127.0.0.1").pathname,
      );
    } catch {
      response.writeHead(400);
      response.end("Bad request");
      return;
    }
    // Like Capacitor's html5mode: a path whose last segment has no extension
    // (the web's /textbook/ module addresses) is answered with the app page.
    let relativePath = pathname.replace(/^\/+/, "");
    if (!path.posix.basename(relativePath).includes("."))
      relativePath = "index.html";
    const runtimePreview =
      process.env.KOTOBAFLOW_MOBILE_RUNTIME_PREVIEW === "1";
    const runtimeFiles = {
      "js/mobile-shell.js": "runtime/mobile-shell.js",
      "js/mobile-platform.js": "runtime/mobile-platform.js",
      "js/mobile-native.js": "runtime/mobile-native.js",
      "css/mobile-layout.css": "runtime/mobile-layout.css",
    };
    const previewFile = runtimePreview && runtimeFiles[relativePath];
    const filePath = previewFile
      ? path.resolve(__dirname, "..", previewFile)
      : path.resolve(webRoot, relativePath);
    if (
      !previewFile &&
      filePath !== webRoot &&
      !filePath.startsWith(webRoot + path.sep)
    ) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    let size;
    try {
      size = fs.statSync(filePath).size;
    } catch (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      response.end();
      return;
    }
    // Byte ranges as the app delivers them for packaged audio (example clips,
    // classics narration): one range gets 206 with exactly its bytes; past
    // the end the read fails (416 here, a failed request inside WebView);
    // anything else gets the whole file.
    const headers = { "Content-Type": contentType(filePath) };
    let start = 0;
    let end = size - 1;
    let status = 200;
    const range = /^bytes=(\d*)-(\d*)$/.exec(
      String(request.headers.range || "").trim(),
    );
    if (range && (range[1] || range[2])) {
      if (!range[1]) {
        start = Math.max(0, size - Number(range[2]));
      } else {
        start = Number(range[1]);
        if (range[2]) end = Math.min(end, Number(range[2]));
      }
      if (start >= size || (!range[1] && Number(range[2]) === 0)) {
        response.writeHead(416, { "Content-Range": `bytes */${size}` });
        response.end();
        return;
      }
      if (end >= start) {
        status = 206;
        headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
      } else {
        start = 0;
        end = size - 1;
      }
    }
    headers["Accept-Ranges"] = "bytes";
    headers["Content-Length"] = String(size ? end - start + 1 : 0);
    response.writeHead(status, headers);
    if (!size) {
      response.end();
      return;
    }
    const stream = fs.createReadStream(filePath, { start, end });
    stream.on("error", () => response.destroy());
    // Media elements abandon range reads; release the file with them.
    response.on("close", () => stream.destroy());
    stream.pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}/index.html`;
  return server;
}

async function checkTouchTargets(page) {
  return page.evaluate(() => {
    const selectors = [
      "#mobileAppBar button",
      "#mobileBottomNav button",
      "#dashboardMain button",
      "#mobileFilterSheet button",
      "#mobileSettingsSheet button",
      "#mobileLessonSectionNav button",
      "#textbookMain .tb-section-head .tb-tts-btn",
      "#textbookMain .tb-vocab-loop-btn",
      "#mobileLessonMiniPlayer button",
      ".book-footer button",
      ".book-footer select",
      ".page-heading-action",
      "#vocabMain .cc-card-head button",
      "#grammarMain .gm-card-fav",
      "#clReader .cl-audio button",
      "#clReader .cl-audio select",
      "#clReader .cl-audio-seek",
      "dialog[open] button",
      "dialog[open] select",
    ];
    const tooSmall = [];
    document.querySelectorAll(selectors.join(",")).forEach((button) => {
      if (button.hidden || button.closest("[hidden]")) return;
      const style = getComputedStyle(button);
      if (style.display === "none" || style.visibility === "hidden") return;
      const rect = button.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (rect.width < 44 || rect.height < 44) {
        tooSmall.push({
          id: button.id,
          label: button.getAttribute("aria-label"),
          width: rect.width,
          height: rect.height,
        });
      }
    });
    return tooSmall;
  });
}

async function checkAccessibleNames(page) {
  return page.evaluate(() => {
    const isVisible = (node) => {
      if (!node) return false;
      let current = node;
      while (current && current.nodeType === 1) {
        if (current.hidden) return false;
        const style = getComputedStyle(current);
        if (style.display === "none" || style.visibility === "hidden") {
          return false;
        }
        current = current.parentElement;
      }
      return true;
    };
    const labelledByText = (node) =>
      (node.getAttribute("aria-labelledby") || "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    const nameOf = (node) =>
      (
        node.getAttribute("aria-label") ||
        labelledByText(node) ||
        node.getAttribute("title") ||
        node.textContent ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim();
    const missingButtons = [];
    document.querySelectorAll("button, [role='button']").forEach((node) => {
      if (!isVisible(node) || node.closest("[aria-hidden='true']")) return;
      if (!nameOf(node)) {
        missingButtons.push({
          id: node.id,
          className: node.className || "",
          html: node.outerHTML.slice(0, 160),
        });
      }
    });
    const missingFields = [];
    document
      .querySelectorAll("input:not([type='hidden']), select, textarea")
      .forEach((node) => {
        if (!isVisible(node) || node.closest("[aria-hidden='true']")) return;
        const labelled =
          node.getAttribute("aria-label") ||
          labelledByText(node) ||
          (node.id &&
            document.querySelector(`label[for='${CSS.escape(node.id)}']`)) ||
          node.closest("label");
        if (!labelled) {
          missingFields.push({
            id: node.id,
            name: node.getAttribute("name") || "",
            type: node.getAttribute("type") || node.tagName.toLowerCase(),
            html: node.outerHTML.slice(0, 180),
            parent: node.parentElement?.outerHTML.slice(0, 260) || "",
          });
        }
      });
    const currentNav = document.querySelector(
      "#mobileBottomNav [aria-current='page']",
    );
    const vocabTabs = Array.from(
      document.querySelectorAll(
        "#mobileVocabModeButtons [role='tab'][aria-selected='true']",
      ),
    );
    return {
      missingButtons,
      missingFields,
      navSelected:
        !!currentNav &&
        document.querySelectorAll("#mobileBottomNav [aria-current='page']")
          .length === 1,
      vocabTabSelected:
        !document.querySelector("#mobileVocabModeButtons") ||
        vocabTabs.length === 1,
    };
  });
}

async function run() {
  const server = await startLocalServer();
  const browser = await chromium.launch({ headless: true });
  const report = {
    baseUrl,
    runtimePreview:
      !requestedUrl && process.env.KOTOBAFLOW_MOBILE_RUNTIME_PREVIEW === "1",
    viewports: [],
    responsive: [],
    functional: null,
  };
  try {
    const progressApp = await openApp(browser, { width: 412, height: 844 });
    const progressPage = progressApp.page;
    async function savePlan(minutes) {
      await progressPage
        .locator("[data-dashboard-action='open-plan']")
        .first()
        .click();
      await progressPage.locator("#dashboardPlanMinutes").fill(String(minutes));
      await progressPage
        .locator("[data-dashboard-plan-form] button[type='submit']")
        .click();
      await progressPage.evaluate(() => window.ProgressStore.save());
    }
    await savePlan(35);
    await progressPage.evaluate(() => {
      window.restoreProgressStorage = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "kotobaflow_android_progress_v1")
          throw new DOMException("full", "QuotaExceededError");
        return window.restoreProgressStorage.call(this, key, value);
      };
    });
    await savePlan(55);
    const failure = await progressPage.evaluate(() => ({
      confirmed: JSON.parse(
        localStorage.getItem("kotobaflow_android_progress_v1"),
      ).plan.dailyMinutes,
      pending: JSON.parse(
        localStorage.getItem("jp_learning_progress_offline_v1"),
      ).plan.dailyMinutes,
      status: document.getElementById("progressSyncStatus").textContent,
    }));
    if (
      failure.confirmed !== 35 ||
      failure.pending !== 55 ||
      !failure.status.includes("待重试")
    )
      throw new Error(
        "Native failed-save recovery regression: " + JSON.stringify(failure),
      );
    await progressPage.reload();
    await progressPage.waitForFunction(
      () => window.appConfig?.status === "ready",
    );
    await progressPage.evaluate(() => window.ProgressStore.save());
    const restored = await progressPage.evaluate(() => ({
      mode: window.ProgressStore.getStorageMode(),
      plan: window.ProgressStore.getPlan().dailyMinutes,
      saved: JSON.parse(localStorage.getItem("kotobaflow_android_progress_v1"))
        .plan.dailyMinutes,
    }));
    if (
      restored.mode !== "local-api" ||
      restored.plan !== 55 ||
      restored.saved !== 55
    )
      throw new Error(
        "Native reload recovery regression: " + JSON.stringify(restored),
      );
    report.progress = { failure, restored };
    const futureArchive = JSON.stringify({
      version: 3,
      vocabulary: { known: [7] },
      usage: {},
    });
    await progressPage.addInitScript((archive) => {
      if (!sessionStorage.getItem("review_future_archive_seeded")) {
        localStorage.setItem("kotobaflow_android_progress_v1", archive);
        localStorage.removeItem("jp_learning_progress_offline_v1");
        localStorage.removeItem("jp_learning_progress_confirmed_v1");
        sessionStorage.setItem("review_future_archive_seeded", "1");
      }
    }, futureArchive);
    for (let attempt = 0; attempt < 2; attempt++) {
      await progressPage.reload();
      await progressPage.waitForFunction(
        () => window.appConfig?.status === "ready",
      );
      await savePlan(65);
      const rejected = await progressPage.evaluate(() => ({
        saved: localStorage.getItem("kotobaflow_android_progress_v1"),
        status: document.getElementById("progressSyncStatus").textContent,
      }));
      if (
        rejected.saved !== futureArchive ||
        !rejected.status.includes("暂停写入")
      )
        throw new Error(
          "Future native archive was not protected: " +
            JSON.stringify(rejected),
        );
    }
    report.progress.futureArchiveProtectedAfterReload = true;
    await progressPage.close();

    // Tablets (shorter screen side >= 600 dp) run the web layout unchanged:
    // no phone shell, local progress still native, back walks web layers.
    report.tablet = [];
    for (const viewport of [
      { width: 800, height: 1280 },
      { width: 1280, height: 800 },
      { width: 600, height: 960 },
    ]) {
      const tabletApp = await openApp(browser, viewport, { form: "auto" });
      const sample = await tabletApp.page.evaluate(async () => {
        const root = document.documentElement;
        const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const result = {
          form: root.dataset.nativeForm,
          shell: root.dataset.mobileShell || "",
          mobileChrome: !!document.querySelector(
            "#mobileAppShell, #mobileBottomNav, #mobileFilterSheet",
          ),
          storage: window.ProgressStore?.getStorageMode(),
          feedbackEntry: !!document.getElementById("appFeedbackOpen"),
          moduleSwitcher: (() => {
            const rect = document
              .getElementById("moduleSwitcher")
              ?.getBoundingClientRect();
            return !!rect && rect.width > 0 && rect.height > 0;
          })(),
          overflowX: root.scrollWidth > root.clientWidth + 1,
          // DF-14, DF-14b: only a phone drops these; a tablet keeps the
          // web's settings rows and home cards.
          webSettings: [
            ".app-scale-control",
            ".app-theme-control",
            ".app-density-control:not(.app-reading-layout-control)",
            "#dashboardMain .dashboard-start-card",
            "#dashboardMain .dashboard-tasks",
          ].filter((selector) => {
            const element = document.querySelector(selector);
            return !element || getComputedStyle(element).display === "none";
          }),
          themeRow: !!document.getElementById("mobileAppearanceTheme"),
        };
        document.getElementById("appAppearanceOpen").click();
        await pause(300);
        result.appearanceOpen =
          document.getElementById("appearanceDialog").open;
        window.dispatchEvent(new Event("backbutton"));
        await pause(300);
        result.appearanceAfterBack =
          document.getElementById("appearanceDialog").open;
        return result;
      });
      sample.width = viewport.width;
      sample.height = viewport.height;
      sample.errors = tabletApp.errors;
      report.tablet.push(sample);
      if (
        sample.form !== "tablet" ||
        sample.shell !== "off" ||
        sample.mobileChrome ||
        sample.storage !== "local-api" ||
        sample.feedbackEntry ||
        !sample.moduleSwitcher ||
        sample.overflowX ||
        sample.webSettings.length ||
        sample.themeRow ||
        !sample.appearanceOpen ||
        sample.appearanceAfterBack ||
        sample.errors.length
      ) {
        throw new Error(`Tablet web layout failed: ${JSON.stringify(sample)}`);
      }
      if (viewport.width === 800) {
        // Tablets reopen the last study module at the next start, as the
        // phone shell does (mobile-native.js bindTabletResume).
        const tabletPage = tabletApp.page;
        await tabletPage.evaluate(async () => {
          await window.ModuleSwitcher.switchTo("grammar");
          await window.ProgressStore.save();
        });
        await tabletPage.goto(new URL("/", tabletPage.url()).href);
        await tabletPage.waitForFunction(
          () => window.appConfig?.status === "ready",
        );
        const resumed = await tabletPage
          .waitForFunction(
            () => window.ModuleSwitcher.getCurrentModule() === "grammar",
            null,
            { timeout: 10000 },
          )
          .then(
            () => true,
            () => false,
          );
        report.tabletResume = {
          resumed,
          module: await tabletPage.evaluate(() =>
            window.ModuleSwitcher.getCurrentModule(),
          ),
          errors: tabletApp.errors,
        };
        if (!resumed || tabletApp.errors.length)
          throw new Error(
            `Tablet resume failed: ${JSON.stringify(report.tabletResume)}`,
          );
      }
      await tabletApp.page.close();
    }
    // A phone in landscape is wider than 600 but keeps the phone shell.
    const landscapePhone = await openApp(
      browser,
      { width: 844, height: 412 },
      { form: "auto" },
    );
    report.landscapePhoneForm = await landscapePhone.page.evaluate(() => ({
      form: document.documentElement.dataset.nativeForm,
      shell: document.documentElement.dataset.mobileShell,
    }));
    if (
      report.landscapePhoneForm.form !== "phone" ||
      landscapePhone.errors.length
    ) {
      throw new Error(
        `Landscape phone form failed: ${JSON.stringify(report.landscapePhoneForm)}`,
      );
    }
    await landscapePhone.page.close();
    // Native progress failure/recovery checks above remain unchanged. The UI
    // suite uses the current shared book readers and current product controls.
    await require("./mobile-ui-smoke").runCurrentUiSmoke({
      browser,
      openApp,
      report,
      checkTouchTargets,
      checkAccessibleNames,
      viewports,
    });
  } finally {
    await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  }
  console.log(JSON.stringify(report, null, 2));
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
