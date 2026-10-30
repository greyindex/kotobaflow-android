/* Phone integrations that need the Android shell: system bar colours that
   follow the page, haptic feedback, keeping the screen on while audio plays,
   saving or sharing exported files that a WebView cannot download, and an
   offline About dialog in place of the website's about page.
   Everything degrades to the plain web behaviour without the native bridge. */
(function () {
  "use strict";

  if (!window.__KOTOBAFLOW_NATIVE__ || window.KotobaFlowNativeShell) return;

  var root = document.documentElement;
  var bridge = window.KotobaFlowNative;
  var KEEP_AWAKE_RELEASE_MS = 4000;
  var LAST_VIEW_KEY = "kotobaflow_mobile_last_view";
  var PLAN_FOCUS_GESTURE_MS = 800;

  function callBridge(method, args) {
    if (!bridge || typeof bridge[method] !== "function") return undefined;
    try {
      return bridge[method].apply(bridge, args || []);
    } catch (error) {
      return undefined;
    }
  }

  function haptic(kind) {
    callBridge("haptic", [kind || "tick"]);
  }

  /* ─── System bars ─────────────────────────────────────────────────────── */

  // Computed colours arrive as rgb(r, g, b) or rgba(r, g, b, a).
  function parseColor(value) {
    var match = /rgba?\(([^)]+)\)/.exec(value || "");
    if (!match) return null;
    var parts = match[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(parseFloat);
    if (parts.length < 3 || parts.slice(0, 3).some(isNaN)) return null;
    var alpha = parts.length > 3 && !isNaN(parts[3]) ? parts[3] : 1;
    return { r: parts[0], g: parts[1], b: parts[2], a: alpha };
  }

  function blend(top, bottom) {
    var alpha = top.a;
    return {
      r: top.r * alpha + bottom.r * (1 - alpha),
      g: top.g * alpha + bottom.g * (1 - alpha),
      b: top.b * alpha + bottom.b * (1 - alpha),
      a: 1,
    };
  }

  function toHex(color) {
    return (
      "#" +
      [color.r, color.g, color.b]
        .map(function (channel) {
          var value = Math.max(0, Math.min(255, Math.round(channel)));
          return (value < 16 ? "0" : "") + value.toString(16);
        })
        .join("")
    );
  }

  // The colour a viewer sees at one point: each translucent layer from the
  // hit element outwards is composited over what lies beneath it.
  function visibleColorAt(x, y) {
    var layers = [];
    var element = document.elementFromPoint(x, y);
    while (element && element.nodeType === 1) {
      var style = window.getComputedStyle(element);
      var color = parseColor(style.backgroundColor);
      if (color && color.a > 0 && style.visibility !== "hidden") {
        color.a *= Number(style.opacity) || 0;
        if (color.a > 0) layers.push(color);
        if (color.a >= 0.995) break;
      }
      element = element.parentElement;
    }
    var base =
      root.getAttribute("data-theme") === "dark"
        ? { r: 0, g: 0, b: 0, a: 1 }
        : { r: 255, g: 255, b: 255, a: 1 };
    for (var index = layers.length - 1; index >= 0; index--) {
      base = blend(layers[index], base);
    }
    return toHex(base);
  }

  var lastBars = "";
  var barsFrame = 0;
  var barsTimer = 0;
  function syncSystemBars() {
    barsFrame = 0;
    if (!bridge || document.visibilityState === "hidden") return;
    var width = window.innerWidth;
    var height = window.innerHeight;
    if (!width || !height) return;
    var status = visibleColorAt(width / 2, 1);
    var navigation = visibleColorAt(width / 2, height - 1);
    var key = status + navigation;
    if (key === lastBars) return;
    lastBars = key;
    callBridge("setSystemBars", [status, navigation]);
  }

  function scheduleSystemBars() {
    if (!barsFrame) barsFrame = window.requestAnimationFrame(syncSystemBars);
    // Sheets and backdrops fade in; sample again once they settle.
    window.clearTimeout(barsTimer);
    barsTimer = window.setTimeout(syncSystemBars, 320);
  }

  function bindSystemBars() {
    if (!bridge) return;
    var observer = new MutationObserver(scheduleSystemBars);
    observer.observe(root, {
      attributes: true,
      attributeFilter: [
        "data-theme",
        "data-mobile-shell",
        "data-mobile-chrome",
        "class",
      ],
    });
    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }
    window.addEventListener("app:theme-change", scheduleSystemBars);
    window.addEventListener("resize", scheduleSystemBars, { passive: true });
    document.addEventListener("visibilitychange", function () {
      lastBars = "";
      scheduleSystemBars();
    });
    // Dialogs open in the top layer without touching body classes.
    document.addEventListener("toggle", scheduleSystemBars, true);
    document.addEventListener("close", scheduleSystemBars, true);
    document.addEventListener("click", scheduleSystemBars, true);
    scheduleSystemBars();
  }

  /* ─── Haptics ─────────────────────────────────────────────────────────── */

  function bindHaptics() {
    if (!bridge) return;
    document.addEventListener(
      "click",
      function (event) {
        var target = event.target;
        if (!target || !target.closest) return;
        var tab = target.closest(
          "#mobileBottomNav [data-mobile-module], [data-mobile-lesson-section-target]",
        );
        if (tab && tab.getAttribute("aria-current") === null) {
          haptic("tick");
          return;
        }
        if (
          target.closest(
            '[data-practice-action="favorite"], .study-favorite-action',
          )
        ) {
          haptic("tick");
        }
      },
      true,
    );

    var StudyMode = window.StudyMode;
    var proto = StudyMode && StudyMode.prototype;
    if (!proto || typeof proto._handlePracticeAnswer !== "function") return;
    var original = proto._handlePracticeAnswer;
    proto._handlePracticeAnswer = function () {
      var before = this.exerciseFeedback;
      var result = original.apply(this, arguments);
      var after = this.exerciseFeedback;
      if (!before && after && typeof after.correct === "boolean") {
        haptic(after.correct ? "confirm" : "reject");
      }
      return result;
    };
  }

  /* ─── Keep the screen on while audio plays ────────────────────────────── */

  function bindKeepAwake() {
    if (!bridge || !window.HTMLMediaElement) return;
    var playing = [];
    var awake = false;
    var releaseTimer = 0;

    function setAwake(next) {
      if (next === awake) return;
      awake = next;
      callBridge("keepScreenOn", [next]);
    }

    function update() {
      playing = playing.filter(function (media) {
        return !media.paused && !media.ended;
      });
      window.clearTimeout(releaseTimer);
      if (playing.length) {
        setAwake(true);
        return;
      }
      // Sequential reading starts the next clip shortly after one ends.
      releaseTimer = window.setTimeout(function () {
        if (!playing.length) setAwake(false);
      }, KEEP_AWAKE_RELEASE_MS);
    }

    function onMediaEvent(event) {
      var media = event.target;
      if (event.type === "playing") {
        if (playing.indexOf(media) < 0) playing.push(media);
      } else {
        playing = playing.filter(function (item) {
          return item !== media;
        });
      }
      update();
    }

    function track(media) {
      if (media.__kotobaflowKeepAwake) return;
      media.__kotobaflowKeepAwake = true;
      ["playing", "pause", "ended", "emptied", "abort", "error"].forEach(
        function (type) {
          media.addEventListener(type, onMediaEvent);
        },
      );
    }

    // Most players create detached Audio objects whose events never reach
    // the document, so follow each element from its first play().
    var originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      track(this);
      return originalPlay.apply(this, arguments);
    };
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") update();
    });
  }

  /* ─── Exports: save to the phone or send to another app ───────────────── */

  // The backup dialog hands its JSON to JPLearnMobileFiles (mobile-platform.js),
  // which asks here where it should go. Saving uses the system file picker
  // through the OfflineArchive plugin, so success means the file was written;
  // sending hands a copy to the share sheet, whose outcome Android does not
  // report back.
  var exportState = {
    dialog: null,
    file: null,
    returnFocus: null,
    resolve: null,
  };

  var exportIcons = {
    save: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 19h14"/>',
    share:
      '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/>',
  };

  function icon(name) {
    return (
      '<span class="mobile-export-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" focusable="false">' +
      exportIcons[name] +
      "</svg></span>"
    );
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024)
      return Math.max(1, Math.round(bytes / 1024)) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  }

  function toast(message) {
    var node = document.getElementById("mobileNativeToast");
    if (!node) {
      node = document.createElement("div");
      node.id = "mobileNativeToast";
      node.className = "mobile-native-toast";
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      document.body.appendChild(node);
    }
    // Content outside an open modal dialog is covered by it, so the toast
    // joins the topmost one.
    var open = document.querySelectorAll("dialog[open]");
    var host = open.length ? open[open.length - 1] : document.body;
    if (node.parentNode !== host) host.appendChild(node);
    node.textContent = message;
    node.classList.add("is-visible");
    window.clearTimeout(node.__hideTimer);
    node.__hideTimer = window.setTimeout(function () {
      node.classList.remove("is-visible");
    }, 2600);
  }

  function ensureExportDialog() {
    if (exportState.dialog && exportState.dialog.isConnected)
      return exportState.dialog;
    var dialog = document.createElement("dialog");
    dialog.id = "mobileExportDialog";
    dialog.className = "mobile-export-dialog";
    dialog.setAttribute("aria-labelledby", "mobileExportTitle");
    dialog.innerHTML =
      // The sheet itself takes focus so a touch user sees no ring on an
      // option they did not choose; screen readers start at the title.
      '<div class="mobile-export-sheet" tabindex="-1">' +
      '<h2 class="mobile-export-title" id="mobileExportTitle">导出文件</h2>' +
      '<p class="mobile-export-file" id="mobileExportFile"></p>' +
      '<div class="mobile-export-actions">' +
      '<button type="button" class="mobile-export-action" data-mobile-export="save">' +
      icon("save") +
      "<span><strong>保存到手机</strong><small>选择位置，如“下载”文件夹或云盘</small></span></button>" +
      '<button type="button" class="mobile-export-action" data-mobile-export="share">' +
      icon("share") +
      "<span><strong>发送到其他应用</strong><small>邮件、聊天或网盘</small></span></button>" +
      "</div>" +
      '<button type="button" class="mobile-export-cancel" data-mobile-export="cancel">取消</button>' +
      "</div>";
    dialog.addEventListener("click", function (event) {
      // A tap on the dimmed area outside the sheet lands on the dialog itself.
      if (event.target === dialog) {
        closeExportDialog(null);
        return;
      }
      var button =
        event.target.closest && event.target.closest("[data-mobile-export]");
      if (!button) return;
      var action = button.getAttribute("data-mobile-export");
      closeExportDialog(action === "cancel" ? null : action);
    });
    dialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      closeExportDialog(null);
    });
    document.body.appendChild(dialog);
    exportState.dialog = dialog;
    return dialog;
  }

  function closeExportDialog(choice) {
    var dialog = exportState.dialog;
    if (!dialog || !dialog.open) return false;
    dialog.close();
    var resolve = exportState.resolve;
    exportState.resolve = null;
    exportState.file = null;
    returnFocus(exportState.returnFocus);
    exportState.returnFocus = null;
    if (resolve) resolve(choice || null);
    return true;
  }

  // While a dialog covers the phone settings sheet, the shell keeps the sheet
  // inert, and it releases it only once it sees the dialog close, after this
  // task. Focus goes back when the row it came from can take it again.
  function returnFocus(node) {
    if (!node || typeof node.focus !== "function") return;
    window.setTimeout(function () {
      if (node.isConnected) node.focus({ preventScroll: true });
    }, 0);
  }

  // Resolves "save", "share" or null when the learner backs out.
  function chooseExport(file) {
    if (exportState.resolve) closeExportDialog(null);
    var dialog = ensureExportDialog();
    exportState.file = file;
    var focus = document.activeElement;
    exportState.returnFocus = focus && focus !== document.body ? focus : null;
    dialog.querySelector("#mobileExportFile").textContent =
      file.name + " · " + formatSize(file.size);
    return new Promise(function (resolve) {
      exportState.resolve = resolve;
      // A modal dialog joins the top layer above any dialog already open,
      // such as the backup dialog that started the export.
      if (!dialog.open) dialog.showModal();
      var sheet = dialog.querySelector(".mobile-export-sheet");
      if (sheet) sheet.focus({ preventScroll: true });
    });
  }

  // Hands a copy to the share sheet; false when Android could not prepare it.
  function shareExport(file) {
    return !!callBridge("shareText", [file.name, file.type, file.text]);
  }

  window.__KOTOBAFLOW_NATIVE_FILE_RESULT__ = function (result) {
    if (result === "unavailable") toast("此设备没有可用的分享应用");
  };

  /* ─── About ───────────────────────────────────────────────────────────── */

  // The web's about page describes the public website (hosting, outside
  // links). In the app the settings row opens this account of the app.
  var aboutState = { dialog: null, returnFocus: null };

  function ensureAboutDialog() {
    if (aboutState.dialog && aboutState.dialog.isConnected)
      return aboutState.dialog;
    var dialog = document.createElement("dialog");
    dialog.id = "mobileAboutDialog";
    dialog.className = "mobile-export-dialog mobile-about-dialog";
    dialog.setAttribute("aria-labelledby", "mobileAboutTitle");
    dialog.innerHTML =
      '<div class="mobile-export-sheet mobile-about-sheet" tabindex="-1">' +
      '<h2 class="mobile-export-title" id="mobileAboutTitle">关于词基流动</h2>' +
      '<p class="mobile-export-file" id="mobileAboutVersion">Android 离线版</p>' +
      '<div class="mobile-about-body">' +
      "<h3>学习记录</h3>" +
      "<p>词汇状态、复习安排、收藏、学习计划和阅读位置只保存在这台设备的应用数据中。应用不联网，没有账号，不会上传学习记录。</p>" +
      "<p>卸载应用或清除应用数据会删除这些记录。请在设置的“数据管理”中定期保存完整备份，需要时从备份文件恢复。</p>" +
      "<h3>内容说明</h3>" +
      "<p>部分内容（课首插图、朗读与例句音频及部分课文与词汇说明）由 AI 生成或辅助整理，可能有误，请以权威资料为准。</p>" +
      "<h3>联系</h3>" +
      "<p>问题、内容纠错与建议请通过 GitHub（greyindex）联系维护者：github.com/greyindex</p>" +
      "</div>" +
      '<button type="button" class="mobile-export-cancel" data-mobile-about-close>关闭</button>' +
      "</div>";
    dialog.addEventListener("click", function (event) {
      if (
        event.target === dialog ||
        (event.target.closest &&
          event.target.closest("[data-mobile-about-close]"))
      )
        closeAboutDialog();
    });
    dialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      closeAboutDialog();
    });
    document.body.appendChild(dialog);
    aboutState.dialog = dialog;
    showAppVersion(dialog.querySelector("#mobileAboutVersion"));
    return dialog;
  }

  function showAppVersion(node) {
    var capacitor = window.Capacitor;
    var app = capacitor && capacitor.Plugins && capacitor.Plugins.App;
    if (!node || !app || typeof app.getInfo !== "function") return;
    Promise.resolve(app.getInfo())
      .then(function (info) {
        // Both editions are offline apps: 0.4.2-offline (local eight books)
        // and 0.4.2-public (the four KotobaFlow books) read the same here.
        if (info && info.version)
          node.textContent =
            "Android 离线版 " +
            String(info.version).replace(/-(?:offline|public)$/, "");
      })
      .catch(function () {});
  }

  function openAboutDialog() {
    var dialog = ensureAboutDialog();
    var focus = document.activeElement;
    aboutState.returnFocus = focus && focus !== document.body ? focus : null;
    if (!dialog.open) dialog.showModal();
    var sheet = dialog.querySelector(".mobile-about-sheet");
    if (sheet) {
      sheet.scrollTop = 0;
      sheet.focus({ preventScroll: true });
    }
  }

  function closeAboutDialog() {
    var dialog = aboutState.dialog;
    if (!dialog || !dialog.open) return false;
    dialog.close();
    returnFocus(aboutState.returnFocus);
    aboutState.returnFocus = null;
    return true;
  }

  function bindAbout() {
    // Capture: the phone settings sheet stops clicks from bubbling out.
    document.addEventListener(
      "click",
      function (event) {
        var trigger =
          event.target.closest && event.target.closest("button#appAboutLink");
        if (!trigger) return;
        event.preventDefault();
        openAboutDialog();
      },
      true,
    );
  }

  /* ─── Back button ─────────────────────────────────────────────────────── */

  // Modal dialogs (配色与字体, backup, export, about) sit above every
  // other layer. Back cancels the topmost one through its own cancel handler,
  // so a busy backup that refuses to close keeps refusing.
  function closeTopDialog() {
    var open = document.querySelectorAll("dialog[open]");
    if (!open.length) return false;
    var dialog = open[open.length - 1];
    if (dialog.dispatchEvent(new Event("cancel", { cancelable: true }))) {
      dialog.close();
    }
    return true;
  }

  // Tablets run the web layout without the phone shell, so back walks the
  // web's own layers: dialogs, then popovers and drawers registered with the
  // top layer, the narrow navigation drawer, reading focus and the grammar
  // reader. Anything else leaves the app, as on a phone.
  function handleTabletBack() {
    if (closeTopDialog()) return true;
    var topLayer = window.JPLearn && window.JPLearn.topLayer;
    var current =
      topLayer && typeof topLayer.getCurrent === "function"
        ? topLayer.getCurrent()
        : "";
    if (current) {
      topLayer.close(current);
      return true;
    }
    var layout = window.PanelLayout;
    if (layout && layout.isNarrowGlobalOpen && layout.isNarrowGlobalOpen()) {
      layout.setNarrowGlobalOpen(false, true);
      return true;
    }
    if (layout && layout.isReadingFocus && layout.isReadingFocus()) {
      layout.setReadingFocus(false);
      return true;
    }
    var grammar = window.grammarModule;
    var grammarMain = document.getElementById("grammarMain");
    if (
      grammar &&
      grammar.currentView === "lesson-reader" &&
      grammarMain &&
      grammarMain.offsetParent
    ) {
      var reader = grammar.lessonReader;
      if (reader && typeof reader.onBack === "function") reader.onBack();
      else if (typeof grammar._switchSubView === "function")
        grammar._switchSubView("lesson-list");
      return true;
    }
    return false;
  }

  function bindBack() {
    var shell = window.KotobaFlowMobileShell;
    if (shell && typeof shell.addBackHandler === "function") {
      shell.addBackHandler(closeTopDialog);
      return;
    }
    if (window.__KOTOBAFLOW_FORM_FACTOR__ !== "tablet") return;
    var capacitor = window.Capacitor;
    var app = capacitor && capacitor.Plugins && capacitor.Plugins.App;
    if (app && typeof app.addListener === "function") {
      app.addListener("backButton", function () {
        if (!handleTabletBack() && typeof app.exitApp === "function")
          app.exitApp();
      });
    }
    // The same event the phone shell listens to, for browser-level tests.
    window.addEventListener("backbutton", function (event) {
      if (handleTabletBack() && event) event.preventDefault();
    });
  }

  /* ─── Last view ───────────────────────────────────────────────────────── */

  // Note whether the learner was last in the classics, which reopen from
  // their address at the next start (mobile-platform.js). Study modules
  // resume from saved navigation, so choosing one clears the note.
  function bindLastView() {
    var pages = window.JPLearn && window.JPLearn.sitePages;
    if (!pages || typeof pages.activate !== "function") return;
    var activate = pages.activate;
    pages.activate = function (key) {
      try {
        if (key === "classics") localStorage.setItem(LAST_VIEW_KEY, "classics");
        else if (key === "vocab" || key === "grammar" || key === "lesson")
          localStorage.removeItem(LAST_VIEW_KEY);
      } catch (error) {}
      return activate.apply(this, arguments);
    };
  }

  /* ─── Tablet resume ───────────────────────────────────────────────────── */

  // The phone shell reopens the last lesson, grammar or vocabulary view once
  // the app is ready. Tablets run without that shell, so the same resume
  // happens here, unless the learner has already chosen a module.
  function bindTabletResume() {
    if (window.__KOTOBAFLOW_FORM_FACTOR__ !== "tablet") return;
    var attempted = false;
    var userMoved = false;
    // site-pages.js reopens the module named by the address the page loaded
    // at (a reload at /textbook/, or the classics hash) on the same app:ready.
    var loadedAtModule =
      window.location.hash === "#classics" ||
      /^\/(vocabulary|grammar|textbook)(\/(index\.html)?)?$/.test(
        window.location.pathname,
      );
    var switcherNav = document.getElementById("moduleSwitcher");
    if (switcherNav) {
      switcherNav.addEventListener(
        "click",
        function () {
          userMoved = true;
        },
        true,
      );
    }
    function resume() {
      if (attempted) return;
      attempted = true;
      if (loadedAtModule) return;
      var switcher = window.ModuleSwitcher;
      var store = window.ProgressStore;
      if (
        userMoved ||
        !switcher ||
        typeof switcher.resume !== "function" ||
        !store ||
        typeof store.getNavigation !== "function"
      )
        return;
      if (
        typeof switcher.getCurrentModule === "function" &&
        switcher.getCurrentModule() !== "dashboard"
      )
        return;
      var saved;
      try {
        saved = store.getNavigation();
      } catch (error) {
        console.warn("[KotobaFlowNative] 无法读取上次的学习位置", error);
        return;
      }
      Promise.resolve(switcher.resume(saved)).catch(function (error) {
        console.warn("[KotobaFlowNative] 恢复上次的学习位置失败", error);
      });
    }
    var events = window.JPLearn && window.JPLearn.events;
    if (events && typeof events.on === "function")
      events.on("app:ready", resume);
    if (window.appConfig && window.appConfig.status === "ready")
      window.setTimeout(resume, 0);
  }

  /* ─── Launch cover ────────────────────────────────────────────────────── */

  // DF-16: MainActivity keeps its copy of the splash over the page until the
  // first screen is drawn: the app is ready (or has shown its error), the
  // web's loading overlay is gone, the phone shell is up, and a frame has
  // passed. The native splash then fades onto the page's launch cover, whose
  // loading bar runs until about two seconds after launch (and at least a
  // moment), before the cover fades into the page. Without the bridge (a
  // browser) the cover leaves as soon as the page is drawn.
  var LAUNCH_TOTAL_MS = 2000;
  var LAUNCH_BAR_MS = 600;
  var LAUNCH_FADE_MS = 250;
  // What the last launch did, for device acceptance: milliseconds from
  // launch to the first screen (native clock) and how long the bar then ran.
  var launchTiming = { drawn: null, hold: null, lifted: false };

  function bindLaunchCover() {
    if (!root.hasAttribute("data-mobile-launch")) return;
    var events = window.JPLearn && window.JPLearn.events;
    var settled = false;
    function firstScreenDrawn() {
      var loading = document.getElementById("loading");
      var shell = root.dataset.mobileShell;
      return (
        (!loading || loading.classList.contains("hidden")) &&
        shell !== undefined &&
        shell !== "initializing"
      );
    }
    function lift() {
      root.setAttribute("data-mobile-launch-leaving", "");
      var reduced = root.getAttribute("data-mobile-motion") === "reduce";
      window.setTimeout(
        function () {
          root.removeAttribute("data-mobile-launch");
          root.removeAttribute("data-mobile-launch-leaving");
          launchTiming.lifted = true;
        },
        reduced ? 0 : LAUNCH_FADE_MS,
      );
    }
    function settle() {
      if (settled) return;
      settled = true;
      (function wait() {
        if (!firstScreenDrawn()) return window.requestAnimationFrame(wait);
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () {
            var elapsed = callBridge("launchReady");
            var hold =
              typeof elapsed === "number"
                ? Math.max(LAUNCH_TOTAL_MS - elapsed, LAUNCH_BAR_MS)
                : 0;
            launchTiming.drawn = typeof elapsed === "number" ? elapsed : null;
            launchTiming.hold = hold;
            window.setTimeout(lift, hold);
          });
        });
      })();
    }
    if (events && typeof events.on === "function") {
      events.on("app:ready", settle);
      events.on("app:error", settle);
    }
    var status = window.appConfig && window.appConfig.status;
    if (status === "ready" || status === "error") settle();
  }

  /* ─── Keyboard etiquette ──────────────────────────────────────────────── */

  // The plan dialog focuses its first number field on open, which raises the
  // keyboard over half of a dialog the learner usually only reads. Keep focus
  // inside the dialog without the keyboard until the field itself is tapped.
  function bindPlanFocus() {
    var lastPointerTarget = null;
    var lastPointerTime = 0;
    document.addEventListener(
      "pointerdown",
      function (event) {
        lastPointerTarget = event.target;
        lastPointerTime = Date.now();
      },
      true,
    );
    document.addEventListener(
      "focusin",
      function (event) {
        var input = event.target;
        if (!input || input.id !== "dashboardPlanMinutes") return;
        if (
          lastPointerTarget === input &&
          Date.now() - lastPointerTime < PLAN_FOCUS_GESTURE_MS
        ) {
          return;
        }
        var dialog = input.closest(".dashboard-plan-dialog");
        if (!dialog) return;
        if (!dialog.hasAttribute("tabindex"))
          dialog.setAttribute("tabindex", "-1");
        input.blur();
        dialog.focus({ preventScroll: true });
      },
      true,
    );
  }

  function init() {
    bindSystemBars();
    bindHaptics();
    bindKeepAwake();
    bindBack();
    bindAbout();
    bindLastView();
    bindTabletResume();
    bindPlanFocus();
    bindLaunchCover();
    root.setAttribute("data-native-bridge", bridge ? "ready" : "missing");
  }

  window.KotobaFlowNativeShell = {
    haptic: haptic,
    launch: launchTiming,
    syncSystemBars: function () {
      lastBars = "";
      syncSystemBars();
    },
    chooseExport: bridge ? chooseExport : null,
    shareExport: shareExport,
    closeExportDialog: function () {
      return closeExportDialog(null);
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
