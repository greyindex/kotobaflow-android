(function () {
  "use strict";

  var NATIVE_PROGRESS_KEY = "kotobaflow_android_progress_v1";
  var MOBILE_WARNING_KEY = "jp_learning_mobile_warning_dismissed";
  var originalFetch = window.fetch.bind(window);

  var FORM_FACTOR_KEY = "kotobaflow_form_factor";

  window.__KOTOBAFLOW_NATIVE__ = true;
  window.JPLearnStorageConfig = Object.freeze({ mode: "local-api" });
  document.documentElement.setAttribute("data-native-app", "android");

  // Tablets run the web layout unchanged; phones get the mobile shell. A
  // tablet is a screen whose shorter side is at least 600 dp, the line
  // Android itself draws with sw600dp. Decided once per launch so rotating,
  // folding or split screen never swaps the layout mid-session. The stored
  // override ("phone" or "tablet") exists for testing and diagnosis.
  function detectFormFactor() {
    try {
      var forced = localStorage.getItem(FORM_FACTOR_KEY);
      if (forced === "phone" || forced === "tablet") return forced;
    } catch (error) {}
    var screen = window.screen || {};
    var shortest = Math.min(screen.width || 0, screen.height || 0);
    return shortest >= 600 ? "tablet" : "phone";
  }

  window.__KOTOBAFLOW_FORM_FACTOR__ = detectFormFactor();
  document.documentElement.setAttribute(
    "data-native-form",
    window.__KOTOBAFLOW_FORM_FACTOR__,
  );

  // DF-16: until the first screen is drawn a launch cover (mobile-layout.css)
  // continues the Android splash: its colours follow the system's night mode,
  // as the splash does. mobile-native.js plays its loading bar and lifts it.
  // Android's "remove animations" setting, which WebView 83 does not report
  // as prefers-reduced-motion, marks the root for every runtime animation.
  (function () {
    var root = document.documentElement;
    var dark = false;
    var reduced = false;
    try {
      dark = !!window.KotobaFlowNativeTheme.isDark();
    } catch (error) {}
    try {
      reduced = !!window.KotobaFlowNative.reducedMotion();
    } catch (error) {}
    if (!reduced && window.matchMedia)
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.setAttribute("data-mobile-launch", dark ? "dark" : "light");
    if (reduced) root.setAttribute("data-mobile-motion", "reduce");
  })();

  // The classics keep their reading place outside the study record, and the
  // web reopens them from its #classics address, not from saved navigation.
  // The app always starts at its root, so mobile-native.js notes when the
  // learner was last in the classics and the address is restored here,
  // before site-pages.js reads it.
  try {
    if (
      localStorage.getItem("kotobaflow_mobile_last_view") === "classics" &&
      !window.location.hash
    )
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname + window.location.search + "#classics",
      );
  } catch (error) {}

  // WebView 83 supports AbortController but not AbortSignal.timeout. Archive
  // restore uses a bounded request; preserve cancellation rather than omit it.
  if (
    window.AbortSignal &&
    window.AbortController &&
    typeof window.AbortSignal.timeout !== "function"
  ) {
    window.AbortSignal.timeout = function (milliseconds) {
      if (!Number.isSafeInteger(milliseconds) || milliseconds < 0)
        throw new RangeError("Timeout must be a non-negative safe integer");
      var controller = new window.AbortController();
      var reason;
      if (!("reason" in controller.signal)) {
        Object.defineProperty(controller.signal, "reason", {
          get: function () {
            return reason;
          },
        });
      }
      function schedule(remaining) {
        var delay = Math.min(remaining, 2147483647);
        setTimeout(function () {
          if (remaining > delay) return schedule(remaining - delay);
          reason = new DOMException("The operation timed out", "TimeoutError");
          controller.abort(reason);
        }, delay);
      }
      schedule(milliseconds);
      return controller.signal;
    };
  }

  // WebView 83 animates with Element.animate() but has no Animation.finished
  // promise (Chrome 84). The page-turn curl waits on it to remove its overlay;
  // without it the frozen copy of the turned page would stay over the book.
  if (window.Animation && !("finished" in window.Animation.prototype)) {
    var finishedPromises = new WeakMap();
    Object.defineProperty(window.Animation.prototype, "finished", {
      configurable: true,
      get: function () {
        var animation = this;
        var promise = finishedPromises.get(animation);
        if (promise) return promise;
        promise = new Promise(function (resolve, reject) {
          if (animation.playState === "finished") {
            resolve(animation);
            return;
          }
          animation.addEventListener("finish", function () {
            resolve(animation);
          });
          animation.addEventListener("cancel", function () {
            reject(new DOMException("The animation was aborted", "AbortError"));
          });
        });
        finishedPromises.set(animation, promise);
        return promise;
      },
    });
  }

  // Install before theme.js: its cached MediaQueryList must use Android's
  // current UI mode, including devices whose WebView always reports light.
  if (window.matchMedia && window.KotobaFlowNativeTheme) {
    var nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = function (query) {
      var media = nativeMatchMedia(query);
      if (query !== "(prefers-color-scheme: dark)") return media;
      return new Proxy(media, {
        get: function (target, name) {
          if (name === "matches") {
            try {
              return !!window.KotobaFlowNativeTheme.isDark();
            } catch (error) {
              return target.matches;
            }
          }
          var value = Reflect.get(target, name, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    };
  }
  function applyNativeAutoTheme() {
    if (window.AppTheme && typeof window.AppTheme.refresh === "function") {
      window.AppTheme.refresh();
    }
  }
  window.__KOTOBAFLOW_APPLY_NATIVE_THEME__ = applyNativeAutoTheme;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyNativeAutoTheme);
  } else {
    applyNativeAutoTheme();
  }
  try {
    sessionStorage.setItem(MOBILE_WARNING_KEY, "1");
  } catch (error) {}

  function localURL(input) {
    var value = input instanceof Request ? input.url : String(input || "");
    try {
      var url = new URL(String(value || ""), window.location.href);
      return url.origin === new URL(window.location.href).origin ? url : null;
    } catch (error) {
      return null;
    }
  }

  function jsonResponse(body, status) {
    return new Response(body || "{}", {
      status: status || 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function isProgressDocument(value) {
    if (!(
      isRecord(value) &&
      (value.version === 1 || value.version === 2) &&
      isRecord(value.vocabulary) &&
      isRecord(value.usage)
    ))
      return false;
    // Missing fields are valid old snapshots. A present malformed field must
    // fail closed rather than becoming an empty value on the next save.
    function optional(record, keys, validate) {
      return keys.every(function (key) {
        return (
          !Object.prototype.hasOwnProperty.call(record, key) ||
          validate(record[key])
        );
      });
    }
    function text(value) {
      return typeof value === "string";
    }
    function number(value) {
      return Number.isFinite(value) && value >= 0;
    }
    if (
      !optional(
        value.vocabulary,
        [
          "known",
          "fuzzy",
          "unknown",
          "favorite",
          "grammarFavorite",
          "history",
          "srs",
        ],
        Array.isArray,
      ) ||
      !optional(value.vocabulary, ["srsVersion"], function (version) {
        return version === 1;
      }) ||
      !optional(value, ["plan", "navigation"], isRecord) ||
      !optional(value, ["updatedAt"], text)
    )
      return false;
    if (
      value.plan &&
      (!optional(value.plan, ["dailyMinutes", "dailyNewWords"], number) ||
        !optional(
          value.plan,
          ["bookId", "lessonId", "jlptTarget", "updatedAt"],
          text,
        ))
    )
      return false;
    if (
      value.navigation &&
      (!optional(
        value.navigation,
        ["vocab", "grammar", "textbook"],
        isRecord,
      ) ||
        !optional(value.navigation, ["version"], function (version) {
          return version === 1;
        }) ||
        !optional(value.navigation, ["lastModule"], text))
    )
      return false;
    return Object.keys(value.usage).every(function (date) {
      var day = value.usage[date];
      return (
        isRecord(day) &&
        optional(day, ["focusedMs", "checkins"], number) &&
        optional(day, ["checkedIn"], function (value) {
          return typeof value === "boolean";
        }) &&
        optional(day, ["firstSeenAt", "lastSeenAt"], text)
      );
    });
  }

  function completeProgressResponse(value, revision) {
    // Mirror the local API's complete response shape. ProgressStore normalizes
    // its initial load internally, but archive previews also read the API raw.
    // This only fills absent fields; GET never rewrites the saved bytes.
    var textbooks = window.JPLearn && window.JPLearn.textbooks;
    var vocabulary = Object.assign(
      {
        known: [],
        fuzzy: [],
        unknown: [],
        favorite: [],
        grammarFavorite: [],
        history: [],
        srsVersion: 1,
        srs: [],
      },
      value.vocabulary,
    );
    var plan = Object.assign(
      {
        dailyMinutes: 10,
        dailyNewWords: 20,
        bookId: textbooks ? textbooks.defaultBookId() : "XinBian1",
        lessonId: "lesson_02",
        jlptTarget: "N5",
        updatedAt: "",
      },
      value.plan,
    );
    var navigation = Object.assign(
      {
        version: 1,
        lastModule: "",
        vocab: {},
        grammar: {},
        textbook: {},
      },
      value.navigation,
    );
    return Object.assign({ updatedAt: "" }, value, {
      version: 2,
      revision: revision,
      vocabulary: vocabulary,
      plan: plan,
      navigation: navigation,
    });
  }

  window.fetch = async function (input, init) {
    var url = localURL(input);
    if (!url) throw new TypeError("Android 离线版不能访问网络地址");
    if (url.pathname !== "/api/progress") {
      if (url.pathname.startsWith("/api/"))
        return jsonResponse('{"error":"offline_only"}', 503);
      return originalFetch(input, init);
    }

    try {
      var request = new Request(
        url.href,
        input instanceof Request ? input : undefined,
      );
      request = new Request(request, init);
      if (request.method !== "GET" && request.method !== "POST") {
        return jsonResponse('{"error":"method_not_allowed"}', 405);
      }
      // Read the request body before the synchronous read/compare/write section.
      var body = request.method === "POST" ? await request.text() : null;
      if (request.signal.aborted) {
        var sourceSignal =
          (init && init.signal) || (input instanceof Request && input.signal);
        var abortReason = sourceSignal ? sourceSignal.reason : undefined;
        if (abortReason === undefined) abortReason = request.signal.reason;
        throw abortReason === undefined
          ? new DOMException("Aborted", "AbortError")
          : abortReason;
      }
      var saved = localStorage.getItem(NATIVE_PROGRESS_KEY);
      var current =
        saved === null
          ? { version: 2, revision: 0, vocabulary: {}, usage: {} }
          : JSON.parse(saved);
      if (!isProgressDocument(current)) {
        return jsonResponse('{"error":"invalid_stored_progress"}', 503);
      }
      var revision = current.revision === undefined ? 0 : current.revision;
      if (!Number.isSafeInteger(revision) || revision < 0) {
        return jsonResponse('{"error":"invalid_stored_revision"}', 503);
      }
      if (request.method === "GET")
        return jsonResponse(
          JSON.stringify(completeProgressResponse(current, revision)),
        );
      var expected = request.headers.get("If-Match");
      if (expected === null)
        return jsonResponse('{"error":"revision_required"}', 428);
      if (expected !== String(revision))
        return jsonResponse('{"error":"revision_conflict"}', 409);
      var next;
      try {
        next = JSON.parse(body);
      } catch (error) {
        return jsonResponse('{"error":"invalid_progress"}', 400);
      }
      if (
        !isProgressDocument(next) ||
        next.version !== 2 ||
        revision === Number.MAX_SAFE_INTEGER
      ) {
        return jsonResponse('{"error":"invalid_progress"}', 400);
      }
      next.revision = revision + 1;
      delete next.pending;
      var serialized = JSON.stringify(next);
      localStorage.setItem(NATIVE_PROGRESS_KEY, serialized);
      if (localStorage.getItem(NATIVE_PROGRESS_KEY) !== serialized) {
        return jsonResponse('{"error":"storage_verification_failed"}', 503);
      }
      return jsonResponse(serialized);
    } catch (error) {
      if (
        (request && request.signal.aborted) ||
        error.name === "AbortError" ||
        error.name === "TimeoutError"
      )
        throw error;
      return jsonResponse('{"error":"storage_unavailable"}', 503);
    }
  };

  if (navigator.sendBeacon) {
    navigator.sendBeacon = function (url, data) {
      return false;
    };
  }

  // The Android request interceptor is the final boundary; these guards also
  // keep accidental external links from launching the user's browser.
  if (window.open) {
    var originalOpen = window.open.bind(window);
    window.open = function (url, target, features) {
      if (!localURL(url)) return null;
      return originalOpen(url, target, features);
    };
  }
  document.addEventListener(
    "click",
    function (event) {
      var anchor = event.target.closest && event.target.closest("a[href]");
      if (anchor && !localURL(anchor.href)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  function makeExternalSourcesPlain(root) {
    var anchors = [];
    if (root.matches && root.matches("a[href]")) anchors.push(root);
    if (root.querySelectorAll)
      anchors = anchors.concat(Array.from(root.querySelectorAll("a[href]")));
    anchors.forEach(function (anchor) {
      if (localURL(anchor.href)) return;
      var source = document.createElement("span");
      source.className = anchor.className;
      source.textContent = anchor.textContent + "（离线来源）";
      source.title = anchor.href;
      anchor.replaceWith(source);
    });
  }
  if (window.MutationObserver) {
    new window.MutationObserver(function (records) {
      records.forEach(function (record) {
        record.addedNodes.forEach(makeExternalSourcesPlain);
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  var archivePlugin;
  function getArchivePlugin() {
    if (!archivePlugin) {
      if (
        !window.Capacitor ||
        !window.Capacitor.isNativePlatform ||
        !window.Capacitor.isNativePlatform()
      ) {
        throw new Error("本机文件选择器不可用，请在 Android 应用内操作");
      }
      // This no-bundler app uses JSExport's native-injected plugin wrappers.
      // registerPlugin belongs to @capacitor/core's bundled JavaScript API.
      var plugins = window.Capacitor.Plugins;
      var candidate = plugins && plugins.OfflineArchive;
      if (
        !candidate ||
        typeof candidate.saveArchive !== "function" ||
        typeof candidate.pickArchive !== "function"
      ) {
        throw new Error("本机存档组件不可用，请重新打开完整的 Android 应用");
      }
      archivePlugin = candidate;
    }
    return archivePlugin;
  }
  // How the last backup left the app: "saved" through the file picker, or
  // "shared" to another app, whose own save Android does not report.
  var lastArchiveOutcome = "";
  window.JPLearnMobileFiles = Object.freeze({
    saveArchive: async function (text, name) {
      lastArchiveOutcome = "";
      var shell = window.KotobaFlowNativeShell;
      var choice = "save";
      if (shell && typeof shell.chooseExport === "function") {
        choice = await shell.chooseExport({
          name: name,
          type: "application/json",
          text: text,
          size: new Blob([text]).size,
        });
      }
      if (!choice) throw new Error("已取消保存，现有学习记录未改变");
      if (choice === "share") {
        if (
          !shell.shareExport({
            name: name,
            type: "application/json",
            text: text,
          })
        )
          throw new Error("无法打开系统分享面板，请改用“保存到手机”");
        lastArchiveOutcome = "shared";
        return lastArchiveOutcome;
      }
      var result = await getArchivePlugin().saveArchive({
        text: text,
        name: name,
      });
      if (result.cancelled) throw new Error("已取消保存，现有学习记录未改变");
      if (!result.saved) throw new Error("备份未能保存，请重试");
      lastArchiveOutcome = "saved";
      return lastArchiveOutcome;
    },
    // Status text after a backup: the saved wording, unless it went to the
    // share sheet, which reports neither the app chosen nor a cancel.
    resultText: function (savedText) {
      return lastArchiveOutcome === "shared"
        ? "已打开系统分享面板。备份要在所选应用中确认保存后才算保存。"
        : savedText;
    },
  });

  function bindArchivePicker() {
    var input = document.getElementById("archiveFile");
    if (!input) return;
    var choose = document.getElementById("archiveChooseFile");
    var selected = document.getElementById("archiveChosenFile");
    var open = document.getElementById("appArchiveOpen");
    var picking = false;
    if (choose)
      choose.addEventListener("click", function () {
        if (!input.disabled && !picking) input.click();
      });
    if (open && selected)
      open.addEventListener("click", function () {
        selected.textContent = "尚未选择备份文件";
      });
    input.addEventListener("click", async function (event) {
      event.preventDefault();
      if (picking || input.disabled) return;
      picking = true;
      if (choose) choose.disabled = true;
      var status = document.getElementById("archiveStatus");
      try {
        var result = await getArchivePlugin().pickArchive();
        if (result.cancelled) return;
        // Route through upstream archive validation without assigning input.files:
        // older Android WebViews have incomplete DataTransfer/FileList support.
        var text = result.text;
        if (typeof text !== "string")
          throw new Error("文件内容读取失败，请重试");
        var nativeFile = Object.freeze({
          name: result.name || "progress.json",
          size: new Blob([text]).size,
          text: function () {
            return Promise.resolve(text);
          },
        });
        if (selected) selected.textContent = "已选择：" + nativeFile.name;
        input.dispatchEvent(
          new CustomEvent("change", {
            bubbles: true,
            detail: { nativeFile: nativeFile },
          }),
        );
      } catch (error) {
        if (status)
          status.textContent =
            error.message || "文件无法读取，现有学习记录未改变";
      } finally {
        picking = false;
        if (choose) choose.disabled = input.disabled;
      }
    });
  }

  function renderNativeStatus() {
    var root = document.getElementById("appPwaStatus");
    var text = document.getElementById("appPwaStatusText");
    var install = document.getElementById("appPwaInstallBtn");
    if (root) root.dataset.pwaState = "installed";
    if (text) text.textContent = "Android 应用已安装，内容与学习进度保存在本机";
    if (install) {
      install.hidden = true;
      install.disabled = true;
    }
  }

  window.AppPWA = {
    getState: function () {
      return {
        supported: false,
        registered: false,
        ready: true,
        online: false,
        canInstall: false,
        installed: true,
        error: false,
      };
    },
    requestInstall: function () {
      return Promise.resolve(false);
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderNativeStatus);
    document.addEventListener("DOMContentLoaded", bindArchivePicker);
  } else {
    renderNativeStatus();
    bindArchivePicker();
  }
})();
