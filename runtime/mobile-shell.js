/* global uiIcon */
(function () {
  "use strict";

  // Tablets keep the web layout as it is; see mobile-platform.js.
  if (window.__KOTOBAFLOW_FORM_FACTOR__ === "tablet") {
    document.documentElement.dataset.mobileShell = "off";
    return;
  }

  if (
    window.KotobaFlowMobileShell &&
    typeof window.KotobaFlowMobileShell.getState === "function" &&
    window.KotobaFlowMobileShell.getState().initialized
  ) {
    return;
  }

  var root = document.documentElement;
  // Layers owned by other runtime scripts close before the shell's own;
  // kept outside state so they survive destroy() and init().
  var externalBackHandlers = [];
  var state = {
    activeModule: "dashboard",
    filterModule: null,
    filterSidebar: null,
    filterCollapseObserver: null,
    lessonSectionPin: -1,
    lessonSectionPinTimer: 0,
    settingsLayerHeld: false,
    chromeHidden: false,
    chromeTravel: 0,
    chromeSettleUntil: 0,
    chromeModule: "",
    previousFocus: null,
    initialized: false,
    degraded: false,
    cleanup: [],
    observers: [],
    nativeBackListener: null,
    settingsOriginalParent: null,
    settingsOriginalNextSibling: null,
    settingsDangerOriginalParent: null,
    settingsDangerOriginalNextSibling: null,
    settingsDangerOriginalOpen: false,
    settingsDataFocus: null,
    lessonObserverTimer: 0,
    lessonObserverRefresh: false,
    lessonAudioModule: null,
    lessonAudioOriginalSync: null,
    lessonAudioWrappedSync: null,
    lessonAudioMoved: [],
    lessonAudioElement: null,
    lessonAudioElementCleanup: null,
    lessonSectionNavScroller: null,
    lessonSectionNavHandler: null,
    vocabAudioSyncTimer: 0,
    lessonChunkModule: null,
    lessonChunkOriginalSchedule: null,
    lessonChunkWrappedSchedule: null,
    grammarNavigationModule: null,
    grammarOriginalNavigateToLesson: null,
    grammarWrappedNavigateToLesson: null,
    filterOriginalParent: null,
    filterOriginalNextSibling: null,
    filterContext: null,
    filterSubpage: null,
    detailContext: null,
    searchReturnContext: null,
    searchReturnTimer: 0,
    searchResultFallbackTimer: 0,
    imageViewerContext: null,
    a11yOriginal: [],
    accessibleNameOriginal: [],
    navigationRestoreAttempted: false,
    userSelectedModule: false,
    panelOriginalOpenTools: null,
    panelWrappedOpenTools: null,
    bookOriginalMount: null,
    bookWrappedMount: null,
    headObserver: null,
    headWatched: null,
    runningHeadTimer: 0,
    grammarTabFrame: 0,
    sheetObserver: null,
    sheetRefreshTimer: 0,
  };

  var moduleMeta = {
    dashboard: { label: "今日学习", shortLabel: "今日", icon: "target" },
    lesson: { label: "课文阅读", shortLabel: "课文", icon: "book" },
    grammar: { label: "语法学习", shortLabel: "语法", icon: "grammar" },
    vocab: { label: "词汇学习", shortLabel: "词汇", icon: "tag" },
    // Offered only when the web finds the local classics library.
    // DF-15: shown as 拓展阅读, as it may hold more than classics; internal
    // names (classics, classics_v1) stay.
    classics: { label: "拓展阅读", shortLabel: "拓展阅读", icon: "scroll" },
  };

  var requiredAnchors = [
    ".app-container",
    "#unifiedSidebar",
    "#unifiedModuleSidebarHost",
    "#moduleSwitcher",
    "#dashboardMain",
    "#vocabMain",
    "#grammarMain",
    "#textbookMain",
    "#globalSearchOverlay",
  ];

  function getElement(id) {
    return document.getElementById(id);
  }

  function addListener(target, eventName, handler, options) {
    if (!target || !target.addEventListener) return;
    target.addEventListener(eventName, handler, options);
    state.cleanup.push(function () {
      target.removeEventListener(eventName, handler, options);
    });
  }

  function addObserver(observer) {
    if (!observer) return;
    state.observers.push(observer);
  }

  function iconMarkup(name) {
    if (typeof window.uiIcon === "function") {
      return window.uiIcon(name);
    }
    return '<ui-icon name="' + name + '" aria-hidden="true"></ui-icon>';
  }

  function setButtonContent(button, iconName, label) {
    if (!button) return;
    button.innerHTML =
      iconMarkup(iconName) + '<span class="sr-only">' + label + "</span>";
    button.setAttribute("aria-label", label);
    button.dataset.mobileIcon = iconName;
  }

  var accessibleIconLabels = {
    "arrow-left": "返回",
    book: "课文",
    brain: "记忆补充",
    check: "完成",
    "chevron-down": "展开或收起",
    "chevron-left": "上一项",
    "chevron-right": "打开",
    clipboard: "摘要",
    close: "关闭",
    filter: "筛选",
    grammar: "语法",
    info: "信息",
    library: "词库",
    link: "接续",
    more: "更多",
    pencil: "练习",
    play: "播放",
    refresh: "刷新",
    repeat: "重复播放",
    search: "搜索",
    settings: "设置",
    star: "收藏",
    tag: "词汇",
    target: "今日学习",
    trash: "清空数据",
    volume: "播放此句",
    x: "关闭",
    "x-circle": "注意",
  };

  var accessibleFieldLabels = {
    debugModeToggle: "调试模式",
    gmFuncGroup: "语法功能组",
    gmHasAnti: "筛选有误用语法",
    gmHasConf: "筛选有辨析语法",
    gmHasLesson: "筛选有关联课文语法",
    gmSearch: "搜索语法",
    tbBookSelect: "选择教材",
    tbLessonSelect: "选择课次",
  };

  function restoreAccessibleNames() {
    state.accessibleNameOriginal.forEach(function (entry) {
      if (!entry || !entry.node || !entry.node.isConnected) return;
      if (entry.original === null) entry.node.removeAttribute("aria-label");
      else entry.node.setAttribute("aria-label", entry.original);
    });
    state.accessibleNameOriginal = [];
  }

  function rememberAccessibleName(node) {
    if (
      !node ||
      state.accessibleNameOriginal.some(function (entry) {
        return entry.node === node;
      })
    )
      return;
    state.accessibleNameOriginal.push({
      node: node,
      original: node.getAttribute("aria-label"),
    });
  }

  function accessibleText(node) {
    if (!node) return "";
    var aria = node.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();
    var labelledBy = node.getAttribute("aria-labelledby");
    if (labelledBy && labelledBy.trim()) return labelledBy.trim();
    var title = node.getAttribute("title");
    if (title && title.trim()) return title.trim();
    return String(node.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeAccessibleNames() {
    document
      .querySelectorAll("button, [role='button']")
      .forEach(function (node) {
        if (node.hidden || node.closest("[hidden]")) return;
        var style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return;
        if (accessibleText(node)) return;
        var icon = node.querySelector("ui-icon[name]");
        var iconName = icon ? icon.getAttribute("name") || "" : "";
        var label = accessibleIconLabels[iconName] || "操作按钮";
        rememberAccessibleName(node);
        node.setAttribute("aria-label", label);
      });

    document
      .querySelectorAll("input:not([type='hidden']), select, textarea")
      .forEach(function (node) {
        if (
          node.getAttribute("aria-label") ||
          node.getAttribute("aria-labelledby") ||
          (node.labels && node.labels.length)
        )
          return;
        var label = accessibleFieldLabels[node.id] || "";
        if (!label && node.classList.contains("row-check")) {
          label = "选择词条";
          var index = node.getAttribute("data-index");
          if (index) label += " " + index;
        }
        if (!label && node.getAttribute("placeholder")) {
          label = node.getAttribute("placeholder");
        }
        if (!label) label = "表单控件";
        rememberAccessibleName(node);
        node.setAttribute("aria-label", label);
      });
  }

  function layoutMetrics() {
    var api = window.AppDisplayScale;
    var width =
      api && typeof api.getEffectiveWidth === "function"
        ? api.getEffectiveWidth()
        : Math.max(
            document.documentElement.clientWidth || 0,
            window.innerWidth || 0,
          );
    var height =
      api && typeof api.getEffectiveHeight === "function"
        ? api.getEffectiveHeight()
        : Math.max(
            document.documentElement.clientHeight || 0,
            window.innerHeight || 0,
          );
    var viewport =
      width <= 600 ? "phone" : width <= 1024 ? "tablet" : "desktop";
    return {
      width: Math.max(1, Math.round(width || 1)),
      height: Math.max(1, Math.round(height || 1)),
      viewport: viewport,
      orientation: width >= height ? "landscape" : "portrait",
    };
  }

  function updateViewportMarkers() {
    var metrics = layoutMetrics();
    root.dataset.mobileViewport = metrics.viewport;
    root.dataset.mobileOrientation = metrics.orientation;
    if (metrics.viewport === "phone") root.dataset.mobileReader = "page";
    else delete root.dataset.mobileReader;
    root.style.setProperty("--mobile-effective-width", metrics.width + "px");
    root.style.setProperty("--mobile-effective-height", metrics.height + "px");
    window.dispatchEvent(
      new CustomEvent("mobile:viewport-change", { detail: metrics }),
    );
    return metrics;
  }

  function currentModule() {
    var switcher = window.ModuleSwitcher;
    if (switcher && typeof switcher.getCurrentModule === "function") {
      var selected = switcher.getCurrentModule();
      if (moduleMeta[selected]) return selected;
    }
    var activeButton = document.querySelector(
      "#moduleSwitcher .mod-btn[aria-current='page']",
    );
    var buttonModule = activeButton && activeButton.dataset.module;
    return moduleMeta[buttonModule] ? buttonModule : "dashboard";
  }

  function activeSidebar(moduleName) {
    var ids = {
      vocab: "sidebar",
      grammar: "grammarSidebar",
      lesson: "textbookSidebar",
      classics: "classicsSidebar",
    };
    return ids[moduleName] ? getElement(ids[moduleName]) : null;
  }

  function moduleMain(moduleName) {
    var ids = {
      dashboard: "dashboardMain",
      vocab: "vocabMain",
      grammar: "grammarMain",
      lesson: "textbookMain",
      classics: "classicsMain",
    };
    return ids[moduleName] ? getElement(ids[moduleName]) : null;
  }

  function scrollNodesFor(moduleName) {
    var main = moduleMain(moduleName);
    if (!main) return [];
    var nodes = [main];
    main
      .querySelectorAll(
        ".card-container, .list-container, .study-container, .gm-subview-pane, .tb-reader, .book-body",
      )
      .forEach(function (node) {
        if (nodes.indexOf(node) === -1) nodes.push(node);
      });
    return nodes;
  }

  function captureScrollState(moduleName) {
    return scrollNodesFor(moduleName).map(function (node) {
      return {
        node: node,
        top: Number(node.scrollTop) || 0,
        left: Number(node.scrollLeft) || 0,
      };
    });
  }

  function restoreScrollState(scrollState) {
    if (!Array.isArray(scrollState)) return;
    scrollState.forEach(function (entry) {
      if (!entry || !entry.node || !entry.node.isConnected) return;
      if (typeof entry.node.scrollTo === "function") {
        entry.node.scrollTo({
          top: entry.top,
          left: entry.left,
          behavior: "auto",
        });
      } else {
        entry.node.scrollTop = entry.top;
        entry.node.scrollLeft = entry.left;
      }
    });
  }

  function captureControlState(container) {
    if (!container) return [];
    return Array.from(
      container.querySelectorAll("input, select, textarea"),
    ).map(function (control) {
      return {
        control: control,
        value: control.value,
        checked: !!control.checked,
        indeterminate: !!control.indeterminate,
      };
    });
  }

  function restoreControlState(controlState) {
    if (!Array.isArray(controlState)) return;
    controlState.forEach(function (entry) {
      var control = entry && entry.control;
      if (!control || !control.isConnected) return;
      if ("value" in entry) control.value = entry.value;
      if ("checked" in entry) control.checked = entry.checked;
      if ("indeterminate" in entry) control.indeterminate = entry.indeterminate;
    });
  }

  function captureGrammarFilterState() {
    var list = window.grammarModule && window.grammarModule.grammarList;
    if (!list) return null;
    return {
      searchQuery: list.searchQuery || "",
      levelFilter: list.levelFilter || "all",
      funcGroupFilter: list.funcGroupFilter || "",
      filterHasConfusable: !!list.filterHasConfusable,
      filterHasAnti: !!list.filterHasAnti,
      filterHasLesson: !!list.filterHasLesson,
      filterFavorites: !!list.filterFavorites,
      currentPage: Number(list.currentPage) || 1,
    };
  }

  function restoreGrammarFilterState(snapshot) {
    var list = window.grammarModule && window.grammarModule.grammarList;
    if (!list || !snapshot) return;
    list.searchQuery = snapshot.searchQuery;
    list.levelFilter = snapshot.levelFilter;
    list.funcGroupFilter = snapshot.funcGroupFilter;
    list.filterHasConfusable = snapshot.filterHasConfusable;
    list.filterHasAnti = snapshot.filterHasAnti;
    list.filterHasLesson = snapshot.filterHasLesson;
    list.filterFavorites = snapshot.filterFavorites;
    list.currentPage = Math.max(1, snapshot.currentPage || 1);
    if (typeof list._applyFilters === "function") list._applyFilters();
    if (typeof list._render === "function") list._render();
  }

  function captureModuleNavigation() {
    if (
      window.ModuleSwitcher &&
      typeof window.ModuleSwitcher.exportNavigation === "function"
    ) {
      try {
        return window.ModuleSwitcher.exportNavigation();
      } catch (error) {
        console.warn("[KotobaFlowMobile] navigation snapshot failed", error);
      }
    }
    return null;
  }

  function restoreFilterContext(context) {
    if (!context) return;
    restoreControlState(context.controls);
    if (context.module === "vocab") {
      var vocabState = context.navigation && context.navigation.vocab;
      if (
        vocabState &&
        window.appConfig &&
        typeof window.appConfig.restoreNavigation === "function"
      ) {
        Promise.resolve(window.appConfig.restoreNavigation(vocabState)).catch(
          function (error) {
            console.warn(
              "[KotobaFlowMobile] vocabulary filter restore failed",
              error,
            );
          },
        );
      }
    } else if (context.module === "grammar") {
      restoreGrammarFilterState(context.grammarList);
    } else if (
      context.module === "lesson" &&
      context.navigation &&
      context.navigation.textbook &&
      window.ModuleSwitcher &&
      typeof window.ModuleSwitcher.getTextbookModule === "function"
    ) {
      var textbook = window.ModuleSwitcher.getTextbookModule();
      var textbookState = context.navigation.textbook;
      if (
        textbook &&
        typeof textbook.restoreNavigation === "function" &&
        (textbook.currentBookId !== textbookState.bookId ||
          textbook.currentLessonId !== textbookState.lessonId)
      ) {
        Promise.resolve(textbook.restoreNavigation(textbookState)).catch(
          function (error) {
            console.warn(
              "[KotobaFlowMobile] textbook filter restore failed",
              error,
            );
          },
        );
      }
    }
    restoreScrollState(context.scroll);
  }

  function textFrom(ids, fallback) {
    for (var i = 0; i < ids.length; i += 1) {
      var node = getElement(ids[i]);
      if (node && node.textContent.trim()) return node.textContent.trim();
    }
    return fallback;
  }

  function contextSummary(moduleName) {
    if (moduleName === "classics") {
      var work = textFrom(["statusClassicsBook"], "-");
      var part = textFrom(["statusClassicsPart"], "-");
      if (work === "-") return "日本古典作品";
      return part === "-" ? work : work + " · " + part;
    }
    if (moduleName === "vocab") {
      return textFrom(["matchInfo", "vocabMatchInfo"], "词汇筛选与学习");
    }
    if (moduleName === "grammar") {
      return textFrom(["grammarTotalBadge", "grammarMatchInfo"], "语法条目");
    }
    if (moduleName === "lesson") {
      var textbook = getTextbookModule();
      if (textbook) {
        var book =
          typeof textbook._getCurrentBookMeta === "function"
            ? textbook._getCurrentBookMeta() || {}
            : {};
        var meta =
          (textbook.currentLesson && textbook.currentLesson.meta) ||
          (textbook.currentLesson && textbook.currentLesson.lesson) ||
          {};
        var bookLabel = String(
          book.title ||
            book.label ||
            book.id ||
            textbook.currentBookId ||
            "教材",
        ).trim();
        var lessonLabel =
          typeof textbook._buildLessonLabel === "function"
            ? textbook._buildLessonLabel(meta)
            : textbook.currentLessonId || "当前课文";
        var vocabCount = Array.isArray(textbook.currentVocab)
          ? textbook.currentVocab.length
          : 0;
        var grammarCount = Number(
          textbook.currentInlineGrammarCount ||
            (Array.isArray(textbook.currentGrammar)
              ? textbook.currentGrammar.length
              : 0),
        );
        var courseProgress = null;
        if (typeof textbook._courseProgress === "function") {
          courseProgress = textbook._courseProgress(textbook.coursePath);
        } else if (textbook.coursePath && textbook.coursePath.steps) {
          var courseKeys = ["vocab", "reading", "grammar", "review"];
          var courseComplete = courseKeys.filter(function (key) {
            return ["done", "skipped"].includes(textbook.coursePath.steps[key]);
          }).length;
          courseProgress = {
            complete: courseComplete,
            total: courseKeys.length,
          };
        }
        var progressLabel =
          courseProgress && courseProgress.total
            ? " · " +
              courseProgress.complete +
              "/" +
              courseProgress.total +
              " 步"
            : "";
        if (textbook.currentLessonId || textbook.currentLesson) {
          return (
            bookLabel +
            " · " +
            (lessonLabel || textbook.currentLessonId || "当前课文") +
            progressLabel +
            " · " +
            vocabCount +
            " 词 / " +
            grammarCount +
            " 语法"
          );
        }
      }
      return textFrom(["textbookProgress", "textbookMatchInfo"], "课文与阅读");
    }
    // DF-14a: no line under 今日学习; the page heading below carries the
    // date. Interface slogans are added only when the user names one.
    return "";
  }

  function getTextbookModule() {
    var switcher = window.ModuleSwitcher;
    if (switcher && typeof switcher.getTextbookModule === "function") {
      return switcher.getTextbookModule();
    }
    return null;
  }

  function planIsOpen() {
    return !!document.querySelector(
      ".dashboard-plan-overlay .dashboard-plan-dialog",
    );
  }

  function chunkDetailIsOpen() {
    var panel = getElement("tbChunkDetail");
    return !!(panel && !panel.hidden);
  }

  function ensureVocabToolbar() {
    var main = getElement("vocabMain");
    if (!main) return;
    var toolbar = getElement("mobileVocabToolbar");
    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.id = "mobileVocabToolbar";
      toolbar.className = "mobile-module-toolbar";
      toolbar.setAttribute("aria-label", "词汇视图工具");
      toolbar.innerHTML =
        '<span id="mobileVocabResultSummary" class="mobile-vocab-result-summary"></span>' +
        '<button id="mobileVocabReadPage" class="mobile-vocab-read-page" type="button" aria-pressed="false">' +
        iconMarkup("play") +
        "<span>顺序朗读本页</span></button>";
      main.insertBefore(toolbar, main.firstChild);
    }
    var filterSection = document.querySelector("#sidebar .filter-section");
    var modeGroup = getElement("mobileVocabModeFilter");
    if (filterSection && !modeGroup) {
      modeGroup = document.createElement("div");
      modeGroup.id = "mobileVocabModeFilter";
      modeGroup.className = "filter-group mobile-vocab-mode-filter";
      modeGroup.innerHTML =
        '<span class="filter-label">浏览方式</span>' +
        '<div id="mobileVocabModeButtons" class="mobile-vocab-mode-buttons" role="tablist" aria-label="词汇浏览方式">' +
        '<button type="button" class="mobile-vocab-mode-button" data-mobile-vocab-mode="cards" role="tab">词卡</button>' +
        '<button type="button" class="mobile-vocab-mode-button" data-mobile-vocab-mode="list" role="tab">列表</button>' +
        '<button type="button" class="mobile-vocab-mode-button" data-mobile-vocab-mode="study" role="tab">学习</button></div>';
      filterSection.insertBefore(modeGroup, filterSection.firstChild);
    }
    var viewSelect = getElement("viewModeSelect");
    var viewGroup = viewSelect && viewSelect.closest(".filter-group");
    if (viewGroup) viewGroup.classList.add("mobile-filter-secondary");
  }

  function ensureScaffold() {
    var shell = getElement("mobileAppShell");
    if (!shell) {
      shell = document.createElement("div");
      shell.id = "mobileAppShell";
      shell.className = "mobile-app-shell";
      shell.innerHTML =
        '<header id="mobileAppBar" class="mobile-app-bar" aria-label="移动端应用栏">' +
        '<div class="mobile-app-bar-leading">' +
        '<button id="mobileAppBarBack" class="mobile-app-bar-button" type="button" hidden>' +
        iconMarkup("arrow-left") +
        '<span class="sr-only">返回</span></button>' +
        '<span id="mobileAppBrand" class="mobile-app-brand" aria-hidden="true">' +
        '<img src="./pwa-icon.svg" alt="" width="30" height="30" decoding="async">' +
        "</span></div>" +
        '<div class="mobile-app-bar-copy">' +
        '<span id="mobileAppBarKicker" class="mobile-app-bar-kicker">词基流动</span>' +
        '<strong id="mobileAppBarTitle" class="mobile-app-bar-title">今日学习</strong>' +
        '<span id="mobileAppBarSubtitle" class="mobile-app-bar-subtitle"></span>' +
        // Phone reading modules show a running head instead; the title and
        // subtitle stay for assistive technology.
        '<span id="mobileRunningHead" class="mobile-running-head" aria-hidden="true">' +
        '<span id="mobileRunningTitle" class="mobile-running-title"></span>' +
        '<span id="mobileRunningAside" class="mobile-running-aside"></span></span></div>' +
        '<div class="mobile-app-bar-actions">' +
        // ART-10: 收藏 of an open word entry, proxying the page's own button.
        '<button id="mobileDetailFavorite" class="mobile-app-bar-button mobile-detail-favorite" data-detail-companion type="button" aria-pressed="false" hidden>' +
        iconMarkup("star") +
        '<span class="sr-only">收藏</span></button>' +
        '<button id="mobileAppSearchButton" class="mobile-app-bar-button" type="button">' +
        iconMarkup("search") +
        '<span class="sr-only">搜索</span></button>' +
        '<button id="mobileAppContextButton" class="mobile-app-bar-button" type="button">' +
        iconMarkup("settings") +
        '<span class="sr-only">设置</span></button></div></header>' +
        '<nav id="mobileBottomNav" class="mobile-bottom-nav" aria-label="主要模块">' +
        '<button class="mobile-bottom-nav-button" type="button" data-mobile-module="dashboard" aria-current="page">' +
        iconMarkup("target") +
        "<span>今日</span></button>" +
        '<button class="mobile-bottom-nav-button" type="button" data-mobile-module="lesson">' +
        iconMarkup("book") +
        "<span>课文</span></button>" +
        '<button class="mobile-bottom-nav-button" type="button" data-mobile-module="grammar">' +
        iconMarkup("grammar") +
        "<span>语法</span></button>" +
        '<button class="mobile-bottom-nav-button" type="button" data-mobile-module="vocab">' +
        iconMarkup("tag") +
        "<span>词汇</span></button>" +
        '<button class="mobile-bottom-nav-button" type="button" data-mobile-module="classics" hidden>' +
        iconMarkup("scroll") +
        "<span>拓展阅读</span></button></nav>";
      document.body.appendChild(shell);
    }

    if (!getElement("mobileFilterBackdrop")) {
      var backdrop = document.createElement("div");
      backdrop.id = "mobileFilterBackdrop";
      backdrop.className = "mobile-layer-backdrop";
      backdrop.hidden = true;
      backdrop.setAttribute("aria-hidden", "true");
      document.body.appendChild(backdrop);
    }

    if (!getElement("mobileChunkBackdrop")) {
      var chunkBackdrop = document.createElement("div");
      chunkBackdrop.id = "mobileChunkBackdrop";
      chunkBackdrop.className = "mobile-layer-backdrop";
      chunkBackdrop.hidden = true;
      chunkBackdrop.setAttribute("aria-hidden", "true");
      document.body.appendChild(chunkBackdrop);
    }

    if (!getElement("mobileFilterSheet")) {
      var filterSheet = document.createElement("section");
      filterSheet.id = "mobileFilterSheet";
      filterSheet.className = "mobile-filter-sheet";
      filterSheet.hidden = true;
      filterSheet.setAttribute("role", "dialog");
      filterSheet.setAttribute("aria-modal", "true");
      filterSheet.setAttribute("aria-labelledby", "mobileFilterTitle");
      filterSheet.innerHTML =
        '<header class="mobile-sheet-header"><div class="mobile-sheet-heading">' +
        '<strong id="mobileFilterTitle" class="mobile-sheet-title">筛选</strong>' +
        '<span id="mobileFilterSummary" class="mobile-sheet-summary"></span></div>' +
        '<button id="mobileFilterClose" class="mobile-sheet-close" type="button">' +
        iconMarkup("x") +
        '<span class="sr-only">关闭筛选</span></button></header>' +
        '<div id="mobileFilterContent" class="mobile-filter-content">' +
        '<section id="mobileSheetCurrent" class="mobile-sheet-current" aria-labelledby="mobileSheetCurrentTitle" hidden></section></div>';
      document.body.appendChild(filterSheet);
    }

    if (!getElement("mobileFilterSubpage")) {
      var filterSubpage = document.createElement("div");
      filterSubpage.id = "mobileFilterSubpage";
      filterSubpage.className = "mobile-filter-subpage";
      filterSubpage.hidden = true;
      filterSubpage.setAttribute("aria-labelledby", "mobileFilterSubpageTitle");
      filterSubpage.innerHTML =
        '<header class="mobile-sheet-header mobile-subpage-header">' +
        '<button id="mobileFilterSubpageBack" class="mobile-sheet-close mobile-subpage-back" type="button">' +
        iconMarkup("arrow-left") +
        '<span class="sr-only">返回筛选</span></button>' +
        '<div class="mobile-sheet-heading"><strong id="mobileFilterSubpageTitle" class="mobile-sheet-title">更多筛选</strong>' +
        '<span id="mobileFilterSubpageSummary" class="mobile-sheet-summary">在当前面板内选择</span></div>' +
        '<span class="mobile-subpage-spacer" aria-hidden="true"></span></header>' +
        '<div id="mobileFilterSubpageContent" class="mobile-filter-subpage-content"></div>';
      var filterSheetRoot = getElement("mobileFilterSheet");
      if (filterSheetRoot) filterSheetRoot.appendChild(filterSubpage);
      else document.body.appendChild(filterSubpage);
    }

    if (!getElement("mobileSettingsSheet")) {
      var settingsSheet = document.createElement("section");
      settingsSheet.id = "mobileSettingsSheet";
      settingsSheet.className = "mobile-settings-sheet";
      settingsSheet.hidden = true;
      settingsSheet.setAttribute("role", "dialog");
      settingsSheet.setAttribute("aria-modal", "true");
      settingsSheet.setAttribute("aria-labelledby", "mobileSettingsTitle");
      settingsSheet.innerHTML =
        '<header class="mobile-sheet-header"><div class="mobile-sheet-heading">' +
        '<strong id="mobileSettingsTitle" class="mobile-sheet-title">设置</strong>' +
        '<span class="mobile-sheet-summary">显示、主题与本地数据</span></div>' +
        '<button id="mobileSettingsClose" class="mobile-sheet-close" type="button">' +
        iconMarkup("x") +
        '<span class="sr-only">关闭设置</span></button></header>' +
        '<div id="mobileSettingsContent" class="mobile-settings-content"></div>';
      document.body.appendChild(settingsSheet);
    }

    if (!getElement("mobileImageViewer")) {
      var imageViewer = document.createElement("section");
      imageViewer.id = "mobileImageViewer";
      imageViewer.className = "mobile-image-viewer";
      imageViewer.hidden = true;
      imageViewer.setAttribute("role", "dialog");
      imageViewer.setAttribute("aria-modal", "true");
      imageViewer.setAttribute("aria-labelledby", "mobileImageViewerTitle");
      imageViewer.innerHTML =
        '<div id="mobileImageViewerBackdrop" class="mobile-image-viewer-backdrop" aria-hidden="true"></div>' +
        '<div class="mobile-image-viewer-dialog">' +
        '<header class="mobile-sheet-header"><div class="mobile-sheet-heading">' +
        '<strong id="mobileImageViewerTitle" class="mobile-sheet-title">课文插图</strong>' +
        '<span class="mobile-sheet-summary">点按返回继续阅读</span></div>' +
        '<button id="mobileImageViewerClose" class="mobile-sheet-close" type="button">' +
        iconMarkup("x") +
        '<span class="sr-only">关闭图片</span></button></header>' +
        '<div class="mobile-image-viewer-content"><img id="mobileImageViewerImage" alt=""></div></div>';
      document.body.appendChild(imageViewer);
    }

    var settingsPanel = getElement("appSettingsPanel");
    var settingsContent = getElement("mobileSettingsContent");
    if (
      settingsPanel &&
      settingsContent &&
      settingsPanel.parentElement !== settingsContent
    ) {
      state.settingsOriginalParent = settingsPanel.parentElement;
      state.settingsOriginalNextSibling = settingsPanel.nextSibling;
      settingsContent.appendChild(settingsPanel);
    }

    var settingsDanger =
      settingsPanel && settingsPanel.querySelector(".app-settings-danger");
    if (settingsPanel && settingsDanger && settingsContent) {
      var settingsDataPage = getElement("mobileSettingsDataPage");
      if (!settingsDataPage) {
        settingsDataPage = document.createElement("section");
        settingsDataPage.id = "mobileSettingsDataPage";
        settingsDataPage.className = "mobile-settings-data-page";
        settingsDataPage.hidden = true;
        settingsDataPage.setAttribute(
          "aria-labelledby",
          "mobileSettingsDataTitle",
        );
        settingsDataPage.innerHTML =
          '<header class="mobile-sheet-header mobile-subpage-header">' +
          '<button id="mobileSettingsDataBack" class="mobile-sheet-close mobile-subpage-back" type="button">' +
          iconMarkup("arrow-left") +
          '<span class="sr-only">返回设置</span></button>' +
          '<div class="mobile-sheet-heading"><strong id="mobileSettingsDataTitle" class="mobile-sheet-title">数据管理</strong>' +
          '<span class="mobile-sheet-summary">备份、恢复或清除本机学习数据</span></div>' +
          '<span class="mobile-subpage-spacer" aria-hidden="true"></span></header>' +
          '<div id="mobileSettingsDataContent" class="mobile-settings-data-content"></div>';
        var settingsSheetRoot = getElement("mobileSettingsSheet");
        if (settingsSheetRoot) settingsSheetRoot.appendChild(settingsDataPage);
      }

      var settingsDataContent = getElement("mobileSettingsDataContent");
      if (
        settingsDataContent &&
        settingsDanger.parentElement !== settingsDataContent
      ) {
        state.settingsDangerOriginalParent = settingsDanger.parentElement;
        state.settingsDangerOriginalNextSibling = settingsDanger.nextSibling;
        state.settingsDangerOriginalOpen = settingsDanger.open;
        settingsDataContent.appendChild(settingsDanger);
        settingsDanger.open = true;
      }

      if (!getElement("mobileSettingsDataButton")) {
        var settingsDataButton = document.createElement("button");
        settingsDataButton.id = "mobileSettingsDataButton";
        settingsDataButton.className = "mobile-settings-data-trigger";
        settingsDataButton.type = "button";
        settingsDataButton.innerHTML =
          '<span class="mobile-settings-data-trigger-copy"><strong>数据管理</strong><small>查看或清除本机学习数据</small></span>' +
          iconMarkup("chevron-right");
        settingsDataButton.setAttribute("aria-label", "打开数据管理");
        var settingsTriggerParent =
          state.settingsDangerOriginalParent || settingsDanger.parentElement;
        var settingsTriggerReference =
          state.settingsDangerOriginalNextSibling &&
          state.settingsDangerOriginalNextSibling.parentElement ===
            settingsTriggerParent
            ? state.settingsDangerOriginalNextSibling
            : null;
        settingsTriggerParent.insertBefore(
          settingsDataButton,
          settingsTriggerReference,
        );
      }
    }

    ensureAppearanceTheme();
    ensureVocabToolbar();

    return shell;
  }

  // DF-14: the phone settings sheet no longer shows 配色主题 (mobile-layout.css
  // hides it with 页面缩放 and 布局密度). The page theme moves into 配色与字体
  // as one segmented row that sets the web's own select, so theme.js still
  // saves and applies the choice at once; the palette below follows it.
  var appearanceThemeChoices = [
    ["light", "浅色"],
    ["dark", "深色"],
    ["auto", "跟随系统"],
  ];

  function syncAppearanceTheme() {
    var select = getElement("appThemeSelect");
    document
      .querySelectorAll("#mobileAppearanceTheme [data-theme-choice]")
      .forEach(function (button) {
        button.setAttribute(
          "aria-pressed",
          select && button.dataset.themeChoice === select.value
            ? "true"
            : "false",
        );
      });
  }

  function ensureAppearanceTheme() {
    var dialog = getElement("appearanceDialog");
    var controls = dialog && dialog.querySelector(".appearance-controls");
    if (!controls || !getElement("appThemeSelect")) return;
    if (getElement("mobileAppearanceTheme")) return;
    var row = document.createElement("div");
    row.id = "mobileAppearanceTheme";
    row.className = "mobile-appearance-theme";
    row.setAttribute("role", "group");
    row.setAttribute("aria-labelledby", "mobileAppearanceThemeLabel");
    row.innerHTML =
      '<span id="mobileAppearanceThemeLabel" class="mobile-appearance-theme-label">页面配色</span>' +
      '<span class="mobile-appearance-theme-track">' +
      appearanceThemeChoices
        .map(function (choice) {
          return (
            '<button type="button" data-theme-choice="' +
            choice[0] +
            '" aria-pressed="false">' +
            choice[1] +
            "</button>"
          );
        })
        .join("") +
      "</span>";
    controls.insertBefore(row, controls.firstChild);
    row.addEventListener("click", function (event) {
      var button = event.target.closest("[data-theme-choice]");
      var select = getElement("appThemeSelect");
      if (!button || !select) return;
      if (select.value !== button.dataset.themeChoice) {
        select.value = button.dataset.themeChoice;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      // Edit the palette now in use, in a dialog drawn in that theme, as
      // opening 配色与字体 afresh would; the draft keeps both palettes.
      var theme = root.getAttribute("data-theme");
      var edit = getElement("appearanceEditMode");
      if (theme) dialog.setAttribute("data-theme", theme);
      if (edit && theme && edit.value !== theme) {
        edit.value = theme;
        edit.dispatchEvent(new Event("change", { bubbles: true }));
      }
      syncAppearanceTheme();
    });
    window.addEventListener("app:theme-change", syncAppearanceTheme);
    syncAppearanceTheme();
    state.cleanup.push(function () {
      window.removeEventListener("app:theme-change", syncAppearanceTheme);
      if (row.parentElement) row.parentElement.removeChild(row);
    });
  }

  function validateAnchors() {
    var missing = requiredAnchors.filter(function (selector) {
      return !document.querySelector(selector);
    });
    if (missing.length) {
      state.degraded = true;
      root.dataset.mobileShell = "degraded";
      console.error(
        "[KotobaFlowMobile] required anchors missing:",
        missing.join(", "),
      );
      return false;
    }
    return true;
  }

  function filterDetailSummary(detail) {
    if (!detail) return null;
    for (var i = 0; i < detail.children.length; i += 1) {
      if (detail.children[i].tagName === "SUMMARY") return detail.children[i];
    }
    return null;
  }

  function isRootFilterDetail(detail) {
    var content = getElement("mobileFilterContent");
    if (!detail || !content || !content.contains(detail)) return false;
    // Textbook controls rely on delegation and DOM queries rooted at
    // #tbSidebarContent. Keep those details in place and let the filter
    // content scroll naturally instead of detaching them into a subpage.
    // The page block's 本课目录 folds in place too, and so do the
    // vocabulary's 高级筛选 and 当前视图工具 (DF-13).
    if (
      detail.closest(
        "#tbSidebarContent, #clSidebarContent, #mobileSheetCurrent, #sidebar",
      )
    )
      return false;
    var parent = detail.parentElement;
    while (parent && parent !== content) {
      if (parent.tagName === "DETAILS") return false;
      parent = parent.parentElement;
    }
    return true;
  }

  function openFilterSubpage(detail) {
    if (
      !state.filterModule ||
      state.filterSubpage ||
      !isRootFilterDetail(detail)
    ) {
      return false;
    }
    var content = getElement("mobileFilterContent");
    var subpage = getElement("mobileFilterSubpage");
    var subpageContent = getElement("mobileFilterSubpageContent");
    var summary = filterDetailSummary(detail);
    if (!content || !subpage || !subpageContent || !summary) return false;

    state.filterSubpage = {
      detail: detail,
      parent: detail.parentElement,
      nextSibling: detail.nextSibling,
      wasOpen: detail.open,
      focus: document.activeElement,
    };
    detail.open = true;
    detail.classList.add("mobile-filter-subpage-detail");
    subpageContent.appendChild(detail);
    var title = getElement("mobileFilterSubpageTitle");
    var subpageSummary = getElement("mobileFilterSubpageSummary");
    if (title) title.textContent = summary.textContent.trim() || "更多筛选";
    if (subpageSummary)
      subpageSummary.textContent = "在当前面板内选择，不叠加弹窗";
    content.hidden = true;
    content.setAttribute("aria-hidden", "true");
    subpage.hidden = false;
    subpage.setAttribute("aria-hidden", "false");
    var back = getElement("mobileFilterSubpageBack");
    if (back)
      window.setTimeout(function () {
        back.focus({ preventScroll: true });
      }, 0);
    updateChrome();
    return true;
  }

  function closeFilterSubpage(restoreFocus) {
    var context = state.filterSubpage;
    if (!context) return false;
    var detail = context.detail;
    if (detail && context.parent && context.parent.isConnected) {
      context.parent.insertBefore(
        detail,
        context.nextSibling &&
          context.nextSibling.parentElement === context.parent
          ? context.nextSibling
          : null,
      );
    }
    if (detail) {
      detail.open = context.wasOpen;
      detail.classList.remove("mobile-filter-subpage-detail");
    }
    var content = getElement("mobileFilterContent");
    var subpage = getElement("mobileFilterSubpage");
    if (content) {
      content.hidden = false;
      content.setAttribute("aria-hidden", "false");
    }
    if (subpage) {
      subpage.hidden = true;
      subpage.setAttribute("aria-hidden", "true");
    }
    state.filterSubpage = null;
    if (restoreFocus && context.focus && context.focus.isConnected) {
      context.focus.focus({ preventScroll: true });
    } else {
      var focusTarget =
        content &&
        content.querySelector(
          "input:not([disabled]), select:not([disabled]), button:not([disabled])",
        );
      if (restoreFocus && focusTarget)
        focusTarget.focus({ preventScroll: true });
    }
    updateChrome();
    return true;
  }

  function imageViewerIsOpen() {
    var viewer = getElement("mobileImageViewer");
    return !!(viewer && !viewer.hidden && state.imageViewerContext);
  }

  function openImageViewer(image) {
    if (!image) return false;
    if (state.filterModule) closeFilter(false);
    if (settingsIsOpen()) closeSettings(false);
    if (searchIsOpen()) closeSearch(false);
    if (detailIsOpen()) closeDetail(false);
    var viewer = getElement("mobileImageViewer");
    var viewerImage = getElement("mobileImageViewerImage");
    if (!viewer || !viewerImage) return false;
    state.imageViewerContext = {
      focus: document.activeElement,
      image: image,
    };
    viewerImage.src = image.currentSrc || image.src;
    viewerImage.alt = image.alt || "课文插图";
    var title = getElement("mobileImageViewerTitle");
    if (title) title.textContent = image.alt || "课文插图";
    viewer.hidden = false;
    document.body.classList.add("mobile-image-open");
    requestLayer("mobile-image");
    updateChrome();
    var closeButton = getElement("mobileImageViewerClose");
    if (closeButton)
      window.setTimeout(function () {
        closeButton.focus({ preventScroll: true });
      }, 0);
    return true;
  }

  function closeImageViewer(restoreFocus) {
    var viewer = getElement("mobileImageViewer");
    var viewerImage = getElement("mobileImageViewerImage");
    var context = state.imageViewerContext;
    if (viewer) viewer.hidden = true;
    if (viewerImage) {
      viewerImage.removeAttribute("src");
      viewerImage.alt = "";
    }
    document.body.classList.remove("mobile-image-open");
    releaseLayer("mobile-image");
    state.imageViewerContext = null;
    updateChrome();
    if (restoreFocus && context && context.focus && context.focus.isConnected) {
      context.focus.focus({ preventScroll: true });
    }
  }

  function enhanceLessonImages() {
    document
      .querySelectorAll(
        "#textbookMain .tb-section-image, #textbookMain .tb-book-cover img",
      )
      .forEach(function (image) {
        if (!image.hasAttribute("tabindex")) image.tabIndex = 0;
        if (!image.hasAttribute("role")) image.setAttribute("role", "button");
        if (!image.hasAttribute("aria-label")) {
          image.setAttribute(
            "aria-label",
            "查看大图：" + (image.alt || "课文插图"),
          );
        }
      });
  }

  function lessonAudioLabel(mode) {
    var value = String(mode || "");
    if (value.indexOf("reading:body") === 0) return "本文朗读";
    if (value.indexOf("reading:application") === 0) return "应用文朗读";
    if (value.indexOf("dialogue:conversation") === 0) return "会话朗读";
    if (value.indexOf("vocab-loop") === 0) return "本课词汇";
    if (value.indexOf("vocab:") === 0) return "词汇发音";
    return "课文音频";
  }

  function lessonAudioModeMatches(mode, candidate) {
    var current = String(mode || "");
    var expected = String(candidate || "");
    if (!current || !expected) return false;
    return (
      current === expected ||
      (expected.indexOf("dialogue:") === 0 &&
        current.indexOf(expected + ":single:") === 0)
    );
  }

  function formatMobileAudioClock(value, placeholder) {
    var seconds = Number(value);
    if (!isFinite(seconds) || seconds < 0) return placeholder || "--:--";
    seconds = Math.floor(seconds);
    return (
      Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0")
    );
  }

  function lessonAudioTimeText(textbook) {
    var audio = textbook && textbook.ttsState && textbook.ttsState.audio;
    var current = audio && isFinite(audio.currentTime) ? audio.currentTime : 0;
    var duration =
      audio && isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : null;
    return (
      formatMobileAudioClock(current, "0:00") +
      " / " +
      formatMobileAudioClock(duration, "--:--")
    );
  }

  function syncLessonAudioDetails(textbook, bar) {
    if (!bar || !textbook) return;
    var tts = textbook.ttsState || {};
    var mode = String(tts.mode || "");
    var timeText = lessonAudioTimeText(textbook);
    bar.querySelectorAll("[data-mobile-audio-time]").forEach(function (time) {
      time.textContent = timeText;
    });
    bar
      .querySelectorAll(".mobile-lesson-audio-option")
      .forEach(function (option) {
        var optionMode = option.dataset.audioMode || "";
        var active = lessonAudioModeMatches(mode, optionMode);
        var percent = active ? lessonAudioProgress(textbook, mode) : 0;
        option.classList.toggle("is-active", active);
        var progress = option.querySelector("[data-mobile-audio-progress]");
        if (progress) {
          progress.style.setProperty("--mobile-audio-progress", percent + "%");
          progress.setAttribute("aria-valuenow", String(percent));
        }
      });
  }

  function bindLessonAudioElement(textbook) {
    var audio = textbook && textbook.ttsState && textbook.ttsState.audio;
    if (audio === state.lessonAudioElement) return;
    if (state.lessonAudioElementCleanup) state.lessonAudioElementCleanup();
    state.lessonAudioElement = audio || null;
    state.lessonAudioElementCleanup = null;
    if (!audio || typeof audio.addEventListener !== "function") return;
    var events = [
      "abort",
      "durationchange",
      "ended",
      "error",
      "loadedmetadata",
      "pause",
      "playing",
      "progress",
      "seeked",
      "stalled",
      "timeupdate",
    ];
    var onAudioChange = function () {
      syncMobileLessonAudio();
    };
    events.forEach(function (eventName) {
      audio.addEventListener(eventName, onAudioChange);
    });
    state.lessonAudioElementCleanup = function () {
      events.forEach(function (eventName) {
        audio.removeEventListener(eventName, onAudioChange);
      });
    };
  }

  function ensureLessonMiniPlayer() {
    var mini = getElement("mobileLessonMiniPlayer");
    if (!mini) {
      mini = document.createElement("section");
      mini.id = "mobileLessonMiniPlayer";
      mini.className = "mobile-lesson-mini-player";
      mini.hidden = true;
      mini.setAttribute("role", "region");
      mini.setAttribute("aria-label", "课文音频播放状态");
      mini.innerHTML =
        '<div class="mobile-lesson-mini-player-copy"><div class="mobile-lesson-mini-player-heading"><strong id="mobileLessonMiniLabel">课文音频</strong><span id="mobileLessonMiniStatus" aria-live="polite"></span></div><div id="mobileLessonMiniProgress" class="mobile-lesson-mini-player-progress" role="progressbar" aria-label="课文音频进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>' +
        '<input id="mobileLessonMiniSeek" class="mobile-lesson-mini-player-seek" type="range" min="0" max="1000" step="1" value="0" aria-label="朗读位置" hidden></div>' +
        '<button id="mobileLessonMiniPause" class="mobile-lesson-mini-player-button" type="button" hidden></button>' +
        '<button id="mobileLessonMiniStop" class="mobile-lesson-mini-player-button mobile-lesson-mini-player-stop" type="button" aria-label="停止">' +
        iconMarkup("stop") +
        '<span class="sr-only">停止</span></button>';
      document.body.appendChild(mini);
    }
    if (!mini.dataset.mobileBound) {
      mini.dataset.mobileBound = "true";
      addListener(getElement("mobileLessonMiniStop"), "click", function () {
        var textbook = getTextbookModule();
        if (textbook && typeof textbook._stopTtsPlayback === "function") {
          textbook._stopTtsPlayback("已停止");
        }
        syncMobileLessonAudio();
      });
      addListener(getElement("mobileLessonMiniPause"), "click", function () {
        var textbook = getTextbookModule();
        if (vocabLoopOf(textbook)) {
          if (textbook.ttsState.paused) textbook._resumeVocabLoop();
          else textbook._pauseVocabLoop();
          syncMobileLessonAudio();
          return;
        }
        var audio = seekableLessonAudio(textbook);
        if (!audio) return;
        if (audio.paused) resumeLessonAudio(audio);
        else audio.pause();
        syncMobileLessonAudio();
      });
      // Dragging moves the thumb and the clock; letting go seeks, so a drag
      // asks for one byte range rather than one per step.
      var seek = getElement("mobileLessonMiniSeek");
      addListener(seek, "input", function () {
        state.lessonSeekDragging = true;
        syncMobileLessonAudio();
      });
      addListener(seek, "change", function () {
        state.lessonSeekDragging = false;
        var textbook = getTextbookModule();
        if (vocabLoopOf(textbook)) {
          textbook._seekVocabLoop(Number(seek.value));
          syncMobileLessonAudio();
          return;
        }
        var audio = seekableLessonAudio(textbook);
        if (audio && isFinite(audio.duration) && audio.duration > 0) {
          audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
        }
        syncMobileLessonAudio();
      });
    }
    return mini;
  }

  // DF-06: a section recording (本文, 应用文, 会话) is one file, so it can
  // pause where it is and seek; a single line only stops. The word
  // read-through pauses and seeks by word (vocabLoopOf, DF-18).
  function seekableLessonAudio(textbook) {
    var tts = (textbook && textbook.ttsState) || {};
    var mode = String(tts.mode || "");
    var audio = tts.audio;
    if (!audio || tts.loading) return null;
    if (
      mode.indexOf("reading:") !== 0 &&
      !(mode.indexOf("dialogue:") === 0 && mode.indexOf(":single:") < 0)
    )
      return null;
    return audio;
  }

  // DF-18: the word read-through takes the same track, counted in words,
  // and the same pause; dragging to a word reads on from there.
  function vocabLoopOf(textbook) {
    var tts = textbook && textbook.ttsState;
    return !!(
      tts &&
      tts.mode === "vocab-loop" &&
      textbook.currentVocab &&
      textbook.currentVocab.length &&
      typeof textbook._pauseVocabLoop === "function"
    );
  }

  function vocabLoopPlace(textbook, index) {
    var words = textbook.currentVocab;
    var row = words[index] || {};
    return (
      "第 " +
      (index + 1) +
      " / " +
      words.length +
      " 词 · " +
      String(row.word || row.label || row.reading_hiragana || "")
    );
  }

  function resumeLessonAudio(audio) {
    var played = audio.play();
    if (played && typeof played.catch === "function") {
      played.catch(function (error) {
        console.warn("[KotobaFlowMobile] lesson audio resume failed", error);
      });
    }
  }

  // The page's own read-aloud button restarts its section; while that
  // section is paused here, it resumes instead.
  function wrapLessonAudioResume(textbook) {
    if (!textbook || typeof textbook._handleTtsButtonClick !== "function")
      return;
    var current = textbook._handleTtsButtonClick;
    if (current.__kotobaflowMobileResume) return;
    var wrapped = function (mode) {
      var audio = seekableLessonAudio(this);
      if (audio && audio.paused && mode === this.ttsState.mode) {
        resumeLessonAudio(audio);
        syncMobileLessonAudio();
        return;
      }
      return current.apply(this, arguments);
    };
    wrapped.__kotobaflowMobileResume = true;
    wrapped.__kotobaflowMobileOriginal = current;
    textbook._handleTtsButtonClick = wrapped;
  }

  function lessonAudioProgress(textbook, mode) {
    var tts = (textbook && textbook.ttsState) || {};
    var audio = tts.audio;
    var ratio = 0;
    if (mode === "vocab-loop" && textbook && textbook.currentVocab.length) {
      var repeatCount = Number(textbook.vocabLoopRepeatCount) || 1;
      var totalUnits = textbook.currentVocab.length * repeatCount;
      var currentUnit =
        (Number(tts.loopCursor) || 0) * repeatCount +
        (Number(tts.loopRepeat) || 0);
      var unitProgress = 0;
      if (audio && isFinite(audio.duration) && audio.duration > 0) {
        unitProgress = Math.max(
          0,
          Math.min(1, audio.currentTime / audio.duration),
        );
      } else if (tts.timerId) {
        unitProgress = 1;
      }
      ratio = totalUnits ? (currentUnit + unitProgress) / totalUnits : 0;
    } else if (audio && isFinite(audio.duration) && audio.duration > 0) {
      ratio = audio.currentTime / audio.duration;
    }
    return Math.round(Math.max(0, Math.min(1, ratio)) * 100);
  }

  function ensureLessonAudioBar(textbook) {
    restoreLessonAudioBar();
    return null;
  }

  function normalizeLessonSectionLabel(label) {
    var value = String(label || "")
      .replace(/\s+/g, " ")
      .trim();
    if (value === "本课词汇") return "词汇";
    return value || "章节";
  }

  function syncLessonSectionNav(nav, scroller, sections, preferredIndex) {
    if (!nav || !nav.isConnected || !sections.length) return;
    // A hairline under the section tabs shows how far through the lesson
    // the reader is.
    var range = scroller.scrollHeight - scroller.clientHeight;
    nav.style.setProperty(
      "--mobile-reading-progress",
      range > 0
        ? Math.min(1, Math.max(0, scroller.scrollTop / range)).toFixed(4)
        : "0",
    );
    var index = Number(preferredIndex);
    if (!isFinite(index) || index < 0) {
      var threshold =
        scroller.getBoundingClientRect().top + nav.offsetHeight + 18;
      index = 0;
      sections.forEach(function (section, sectionIndex) {
        if (section.getBoundingClientRect().top <= threshold)
          index = sectionIndex;
      });
      // A short last section can never reach the top; the end of the
      // reader means the reader is on it.
      if (
        scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <=
        8
      ) {
        index = sections.length - 1;
      }
    }
    index = Math.max(0, Math.min(sections.length - 1, index));
    var track = nav.querySelector(".mobile-lesson-section-track");
    Array.from(
      nav.querySelectorAll("[data-mobile-lesson-section-target]"),
    ).forEach(function (button, buttonIndex) {
      var active = buttonIndex === index;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "location");
      else button.removeAttribute("aria-current");
      if (active && track) {
        var left =
          button.offsetLeft -
          Math.max(0, (track.clientWidth - button.offsetWidth) / 2);
        track.scrollTo({ left: left, behavior: "auto" });
      }
    });
  }

  function ensureLessonSectionNav(textbook) {
    var reader = textbook && textbook.readerEl;
    if (!reader) reader = getElement("tbReader");
    // The shared book pager owns its outline and horizontal scroll state.
    // Moving its body or assigning section ids here would invalidate both.
    if (reader && reader.classList.contains("tb-reader--book")) {
      restoreLessonSectionNav();
      return null;
    }
    var scroller = reader;
    var body = reader && reader.querySelector(".tb-reader-body");
    if (!reader || !body || body.parentElement !== reader || !scroller)
      return null;
    var sections = Array.from(body.children).filter(function (child) {
      return child.classList && child.classList.contains("tb-section");
    });
    var nav = reader.querySelector("#mobileLessonSectionNav");
    var signature = sections
      .map(function (section) {
        return normalizeLessonSectionLabel(
          section.querySelector(".tb-section-badge")?.textContent,
        );
      })
      .join("|");
    if (nav && nav.dataset.sectionSignature !== signature) {
      nav.remove();
      nav = null;
    }
    if (!nav) {
      nav = document.createElement("nav");
      nav.id = "mobileLessonSectionNav";
      nav.className = "mobile-lesson-section-nav";
      nav.setAttribute("aria-label", "课文章节跳转");
      nav.dataset.sectionSignature = signature;
      var title = document.createElement("span");
      title.className = "mobile-lesson-section-label";
      title.textContent = "章节";
      nav.appendChild(title);
      var track = document.createElement("div");
      track.className = "mobile-lesson-section-track";
      nav.appendChild(track);
      var counts = {};
      sections.forEach(function (section, index) {
        var label = normalizeLessonSectionLabel(
          section.querySelector(".tb-section-badge")?.textContent,
        );
        counts[label] = (counts[label] || 0) + 1;
        var uniqueLabel =
          counts[label] > 1 ? label + " " + counts[label] : label;
        var id = "mobileLessonSection-" + index;
        section.id = id;
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = uniqueLabel;
        button.dataset.mobileLessonSectionTarget = id;
        button.setAttribute("aria-controls", id);
        track.appendChild(button);
      });
      reader.insertBefore(nav, body);
      nav.hidden = sections.length < 2;
      addListener(nav, "click", function (event) {
        var button = event.target.closest(
          "[data-mobile-lesson-section-target]",
        );
        if (!button) return;
        var target = getElement(button.dataset.mobileLessonSectionTarget);
        if (!target) return;
        var targetIndex = sections.indexOf(target);
        // Keep the tapped section marked while the reader travels to it.
        state.lessonSectionPin = targetIndex;
        window.clearTimeout(state.lessonSectionPinTimer);
        state.lessonSectionPinTimer = window.setTimeout(function () {
          state.lessonSectionPin = -1;
        }, 900);
        syncLessonSectionNav(nav, scroller, sections, targetIndex);
        var distance = Math.abs(
          target.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top,
        );
        var reduceMotion =
          window.matchMedia &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        target.scrollIntoView({
          // Animating several screens of text only delays the reader.
          behavior:
            reduceMotion || distance > scroller.clientHeight * 2
              ? "auto"
              : "smooth",
          block: "start",
        });
      });
    }
    if (state.lessonSectionNavScroller && state.lessonSectionNavHandler) {
      state.lessonSectionNavScroller.removeEventListener(
        "scroll",
        state.lessonSectionNavHandler,
      );
    }
    var queued = false;
    var handler = function () {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(function () {
        queued = false;
        if (state.lessonSectionPin >= 0) {
          // Each scroll step of the jump extends the pin until it settles.
          window.clearTimeout(state.lessonSectionPinTimer);
          state.lessonSectionPinTimer = window.setTimeout(function () {
            state.lessonSectionPin = -1;
          }, 200);
          syncLessonSectionNav(nav, scroller, sections, state.lessonSectionPin);
          return;
        }
        syncLessonSectionNav(nav, scroller, sections);
      });
    };
    scroller.addEventListener("scroll", handler, { passive: true });
    state.lessonSectionNavScroller = scroller;
    state.lessonSectionNavHandler = handler;
    syncLessonSectionNav(nav, scroller, sections);
    return nav;
  }

  function syncMobileLessonAudio() {
    var textbook = getTextbookModule();
    var mini = getElement("mobileLessonMiniPlayer");
    var isLesson = currentModule() === "lesson";
    var bar = null;
    if (!mini && (!textbook || !isLesson)) return;
    if (!mini) mini = ensureLessonMiniPlayer();
    var tts = (textbook && textbook.ttsState) || {};
    var mode = String(tts.mode || "");
    if (textbook) bindLessonAudioElement(textbook);
    if (isLesson && textbook && textbook.currentLesson) {
      bar = ensureLessonAudioBar(textbook);
    }
    var seekable = seekableLessonAudio(textbook);
    var words = vocabLoopOf(textbook) ? textbook.currentVocab.length : 0;
    var paused = !!((seekable && seekable.paused) || (words && tts.paused));
    var isActive = !!(
      textbook &&
      isLesson &&
      mode &&
      (tts.loading || (tts.audio && tts.audio.paused === false) || paused)
    );
    if (bar) syncLessonAudioDetails(textbook, bar);
    mini.hidden = !isActive;
    mini.setAttribute("aria-hidden", isActive ? "false" : "true");
    document.body.classList.toggle("mobile-lesson-audio-playing", isActive);
    if (!isActive) return;
    var label = getElement("mobileLessonMiniLabel");
    var status = getElement("mobileLessonMiniStatus");
    var progress = getElement("mobileLessonMiniProgress");
    if (label) label.textContent = lessonAudioLabel(mode);
    var seek = getElement("mobileLessonMiniSeek");
    var toggle = getElement("mobileLessonMiniPause");
    var dragging = !!((seekable || words) && state.lessonSeekDragging && seek);
    if (status) {
      var statusText =
        dragging && words
          ? vocabLoopPlace(textbook, Number(seek.value))
          : dragging
            ? formatMobileAudioClock(
                (Number(seek.value) / 1000) * seekable.duration,
                "0:00",
              ) +
              " / " +
              formatMobileAudioClock(seekable.duration, "--:--")
            : paused && !words
              ? "已暂停 · " + lessonAudioTimeText(textbook)
              : tts.statusText || (tts.loading ? "正在准备播放…" : "正在播放");
      if (status.textContent !== statusText) status.textContent = statusText;
    }
    var percent = lessonAudioProgress(textbook, mode);
    if (progress) {
      progress.hidden = !!(seekable || words);
      progress.style.setProperty("--mobile-audio-progress", percent + "%");
      progress.setAttribute("aria-valuenow", String(percent));
    }
    if (seek) {
      seek.hidden = !(seekable || words);
      // Section recordings seek in thousandths of their length; the
      // read-through in words, one step a word.
      var max = words ? Math.max(1, words - 1) : 1000;
      if (seek.max !== String(max)) seek.max = String(max);
      var ready = words
        ? words > 1
        : !!(seekable && isFinite(seekable.duration) && seekable.duration > 0);
      seek.disabled = !ready;
      if (ready && !dragging) {
        seek.value = String(
          words
            ? Math.min(words - 1, Number(tts.loopCursor) || 0)
            : Math.round(
                Math.max(
                  0,
                  Math.min(1, seekable.currentTime / seekable.duration),
                ) * 1000,
              ),
        );
      }
      seek.style.setProperty(
        "--mobile-audio-progress",
        (Number(seek.value) / max) * 100 + "%",
      );
      seek.setAttribute("aria-label", words ? "词汇朗读位置" : "朗读位置");
      seek.setAttribute(
        "aria-valuetext",
        words
          ? vocabLoopPlace(textbook, Number(seek.value))
          : lessonAudioTimeText(textbook),
      );
    }
    if (toggle) {
      toggle.hidden = !(seekable || words);
      var toggleLabel = paused ? "继续" : "暂停";
      if (toggle.getAttribute("aria-label") !== toggleLabel) {
        toggle.innerHTML =
          iconMarkup(paused ? "play" : "pause") +
          '<span class="sr-only">' +
          toggleLabel +
          "</span>";
        toggle.setAttribute("aria-label", toggleLabel);
      }
    }
    mini.classList.toggle("is-paused", paused);
    mini.dataset.audioMode = mode;
  }

  function wrapLessonAudioSync(textbook) {
    if (!textbook || typeof textbook._syncTtsButtonState !== "function") return;
    var current = textbook._syncTtsButtonState;
    if (current.__kotobaflowMobileAudioSync) {
      state.lessonAudioModule = textbook;
      if (!state.lessonAudioOriginalSync) {
        state.lessonAudioOriginalSync = current.__kotobaflowMobileOriginal;
        state.lessonAudioWrappedSync = current;
      }
      return;
    }
    var original = current;
    var wrapped = function () {
      var result = original.apply(this, arguments);
      try {
        syncMobileLessonAudio();
      } catch (error) {
        console.warn("[KotobaFlowMobile] lesson audio sync failed", error);
      }
      return result;
    };
    wrapped.__kotobaflowMobileAudioSync = true;
    wrapped.__kotobaflowMobileOriginal = original;
    textbook._syncTtsButtonState = wrapped;
    state.lessonAudioModule = textbook;
    state.lessonAudioOriginalSync = original;
    state.lessonAudioWrappedSync = wrapped;
  }

  function wrapLessonChunkDetail(textbook) {
    if (!textbook || typeof textbook._scheduleChunkDetailClose !== "function")
      return;
    var current = textbook._scheduleChunkDetailClose;
    if (current.__kotobaflowMobileChunkSchedule) {
      state.lessonChunkModule = textbook;
      if (!state.lessonChunkOriginalSchedule) {
        state.lessonChunkOriginalSchedule =
          current.__kotobaflowMobileChunkOriginal;
        state.lessonChunkWrappedSchedule = current;
      }
      return;
    }
    var original = current;
    var wrapped = function () {
      if (
        document.documentElement.getAttribute("data-native-app") === "android"
      ) {
        return;
      }
      return original.apply(this, arguments);
    };
    wrapped.__kotobaflowMobileChunkSchedule = true;
    wrapped.__kotobaflowMobileChunkOriginal = original;
    textbook._scheduleChunkDetailClose = wrapped;
    state.lessonChunkModule = textbook;
    state.lessonChunkOriginalSchedule = original;
    state.lessonChunkWrappedSchedule = wrapped;
  }

  function disableLessonChunkHover(textbook) {
    var reader = textbook && textbook.readerEl;
    if (!reader || reader.dataset.kotobaflowMobileChunkHover === "1") return;
    var stopHover = function (event) {
      var target = event.target;
      var related = event.relatedTarget;
      if (
        (target && target.closest && target.closest("[data-text-chunk]")) ||
        (related && related.closest && related.closest("[data-text-chunk]"))
      ) {
        event.stopImmediatePropagation();
      }
    };
    addListener(reader, "pointerover", stopHover, true);
    addListener(reader, "pointerout", stopHover, true);
    reader.dataset.kotobaflowMobileChunkHover = "1";
  }

  function enhanceLessonMobile() {
    enhanceLessonImages();
    var textbook = getTextbookModule();
    var isActiveLesson = !!(
      textbook &&
      currentModule() === "lesson" &&
      textbook.currentLessonId &&
      textbook.currentLesson
    );
    if (isActiveLesson) {
      wrapLessonAudioSync(textbook);
      wrapLessonAudioResume(textbook);
      wrapLessonChunkDetail(textbook);
      disableLessonChunkHover(textbook);
      ensureLessonAudioBar(textbook);
      ensureLessonSectionNav(textbook);
      ensureLessonMiniPlayer();
    }
    syncMobileLessonAudio();
  }

  function enhanceGrammarMobile() {
    var grammar = window.grammarModule;
    if (!grammar || typeof grammar.navigateToLesson !== "function") return;
    var current = grammar.navigateToLesson;
    if (current.__kotobaflowMobileGrammarNavigation) {
      state.grammarNavigationModule = grammar;
      if (!state.grammarOriginalNavigateToLesson) {
        state.grammarOriginalNavigateToLesson =
          current.__kotobaflowMobileGrammarOriginal;
        state.grammarWrappedNavigateToLesson = current;
      }
      return;
    }
    var original = current;
    var wrapped = function () {
      if (detailIsOpen()) closeDetail(false);
      return original.apply(this, arguments);
    };
    wrapped.__kotobaflowMobileGrammarNavigation = true;
    wrapped.__kotobaflowMobileGrammarOriginal = original;
    grammar.navigateToLesson = wrapped;
    state.grammarNavigationModule = grammar;
    state.grammarOriginalNavigateToLesson = original;
    state.grammarWrappedNavigateToLesson = wrapped;
  }

  function restoreLessonAudioSync() {
    var textbook = state.lessonAudioModule;
    if (
      textbook &&
      state.lessonAudioOriginalSync &&
      textbook._syncTtsButtonState === state.lessonAudioWrappedSync
    ) {
      textbook._syncTtsButtonState = state.lessonAudioOriginalSync;
    }
    var resume = textbook && textbook._handleTtsButtonClick;
    if (resume && resume.__kotobaflowMobileResume) {
      textbook._handleTtsButtonClick = resume.__kotobaflowMobileOriginal;
    }
    if (state.lessonAudioElementCleanup) state.lessonAudioElementCleanup();
    state.lessonAudioElement = null;
    state.lessonAudioElementCleanup = null;
    state.lessonAudioModule = null;
    state.lessonAudioOriginalSync = null;
    state.lessonAudioWrappedSync = null;
  }

  function restoreLessonChunkDetailSchedule() {
    var textbook = state.lessonChunkModule;
    if (
      textbook &&
      state.lessonChunkOriginalSchedule &&
      textbook._scheduleChunkDetailClose === state.lessonChunkWrappedSchedule
    ) {
      textbook._scheduleChunkDetailClose = state.lessonChunkOriginalSchedule;
    }
    state.lessonChunkModule = null;
    state.lessonChunkOriginalSchedule = null;
    state.lessonChunkWrappedSchedule = null;
  }

  function restoreGrammarNavigation() {
    var grammar = state.grammarNavigationModule;
    if (
      grammar &&
      state.grammarOriginalNavigateToLesson &&
      grammar.navigateToLesson === state.grammarWrappedNavigateToLesson
    ) {
      grammar.navigateToLesson = state.grammarOriginalNavigateToLesson;
    }
    state.grammarNavigationModule = null;
    state.grammarOriginalNavigateToLesson = null;
    state.grammarWrappedNavigateToLesson = null;
  }

  function restoreLessonAudioBar() {
    state.lessonAudioMoved
      .slice()
      .reverse()
      .forEach(function (entry) {
        if (
          !entry ||
          !entry.action ||
          !entry.parent ||
          !entry.parent.isConnected
        )
          return;
        entry.parent.insertBefore(
          entry.action,
          entry.nextSibling && entry.nextSibling.parentNode === entry.parent
            ? entry.nextSibling
            : null,
        );
      });
    state.lessonAudioMoved = [];
    var bar = getElement("mobileLessonAudioBar");
    if (bar && bar.parentElement) bar.parentElement.removeChild(bar);
  }

  function restoreLessonSectionNav() {
    if (state.lessonSectionNavScroller && state.lessonSectionNavHandler) {
      state.lessonSectionNavScroller.removeEventListener(
        "scroll",
        state.lessonSectionNavHandler,
      );
    }
    state.lessonSectionNavScroller = null;
    state.lessonSectionNavHandler = null;
    var nav = getElement("mobileLessonSectionNav");
    if (nav) nav.remove();
  }

  function focusableElements(container) {
    if (!container) return [];
    return Array.from(
      container.querySelectorAll(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
      ),
    ).filter(function (element) {
      if (element.hidden || element.closest("[hidden]")) return false;
      var style = getComputedStyle(element);
      // No box: inside a part the layout leaves out, such as the detail
      // heading row a phone drops.
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        element.getClientRects().length > 0
      );
    });
  }

  function activeLayerElement(layer) {
    if (layer === "dialog") return openNativeDialog();
    if (layer === "filter") return getElement("mobileFilterSheet");
    if (layer === "settings") {
      return settingsDataIsOpen()
        ? getElement("mobileSettingsDataPage")
        : getElement("mobileSettingsSheet");
    }
    if (layer === "search") return getElement("globalSearchDialog");
    if (layer === "chunk") return getElement("tbChunkDetail");
    if (layer === "image") return getElement("mobileImageViewer");
    if (layer === "plan") {
      return document.querySelector(
        ".dashboard-plan-overlay .dashboard-plan-dialog",
      );
    }
    if (layer === "detail") {
      return document.querySelector(
        ".detail-panel.anchored-detail-open, .detail-panel[aria-hidden='false']",
      );
    }
    return null;
  }

  function restoreA11yState() {
    state.a11yOriginal.forEach(function (entry) {
      if (!entry || !entry.node || !entry.node.isConnected) return;
      var closedDetail =
        entry.node.classList &&
        entry.node.classList.contains("detail-panel") &&
        (entry.node.hidden ||
          !entry.node.classList.contains("anchored-detail-open"));
      if (!(closedDetail && entry.ariaHidden === "false")) {
        if (entry.ariaHidden === null) {
          if (entry.node.hasAttribute("aria-hidden")) {
            entry.node.removeAttribute("aria-hidden");
          }
        } else if (
          entry.node.getAttribute("aria-hidden") !== entry.ariaHidden
        ) {
          entry.node.setAttribute("aria-hidden", entry.ariaHidden);
        }
      }
      if (entry.ariaModal === null) {
        if (entry.node.hasAttribute("aria-modal")) {
          entry.node.removeAttribute("aria-modal");
        }
      } else if (entry.node.getAttribute("aria-modal") !== entry.ariaModal) {
        entry.node.setAttribute("aria-modal", entry.ariaModal);
      }
      if ("inert" in entry.node) entry.node.inert = entry.inert;
    });
    state.a11yOriginal = [];
  }

  function rememberA11yNode(node) {
    if (
      !node ||
      state.a11yOriginal.some(function (entry) {
        return entry.node === node;
      })
    ) {
      return;
    }
    state.a11yOriginal.push({
      node: node,
      ariaHidden: node.getAttribute("aria-hidden"),
      ariaModal: node.getAttribute("aria-modal"),
      inert: !!node.inert,
    });
  }

  function applyA11yState(layer) {
    restoreA11yState();
    if (!layer) return;
    var active = activeLayerElement(layer);
    var backgroundIds = [
      "unifiedSidebar",
      "dashboardMain",
      "vocabMain",
      "grammarMain",
      "textbookMain",
      "statusBarRevealControls",
      "mobileAppShell",
      "mobileSettingsContent",
    ];
    backgroundIds.forEach(function (id) {
      var node = getElement(id);
      if (
        !node ||
        (id === "mobileAppShell" && layer === "detail") ||
        node === active ||
        (active && (active.contains(node) || node.contains(active)))
      )
        return;
      rememberA11yNode(node);
      node.setAttribute("aria-hidden", "true");
      if ("inert" in node) node.inert = true;
    });
    if (active) {
      rememberA11yNode(active);
      if (
        layer !== "detail" &&
        active.getAttribute("aria-hidden") !== "false"
      ) {
        active.setAttribute("aria-hidden", "false");
      }
      if (active.getAttribute("aria-modal") !== "true") {
        active.setAttribute("aria-modal", "true");
      }
      if ("inert" in active) active.inert = false;
    }
  }

  function focusLayer(layer) {
    var surface = activeLayerElement(layer);
    if (!surface || surface.hidden) return;
    if (surface.contains(document.activeElement)) return;
    // A detail page on a phone has no close button of its own: the app
    // bar's Back closes it, and takes focus as that button did.
    var back = getElement("mobileAppBarBack");
    var focusTarget =
      layer === "detail" && readerPage() && back && !back.hidden
        ? back
        : focusableElements(surface)[0];
    if (focusTarget) focusTarget.focus({ preventScroll: true });
  }

  function trapLayerFocus(event) {
    var surface = activeLayerElement(topLayer());
    if (!surface) return;
    var focusTargets = focusableElements(surface);
    var mobileBack =
      topLayer() === "detail" ? getElement("mobileAppBarBack") : null;
    var mobileFavorite =
      topLayer() === "detail" ? getElement("mobileDetailFavorite") : null;
    if (mobileFavorite && !mobileFavorite.hidden)
      focusTargets.unshift(mobileFavorite);
    if (mobileBack && !mobileBack.hidden) focusTargets.unshift(mobileBack);
    if (!focusTargets.length) return;
    var first = focusTargets[0];
    var last = focusTargets[focusTargets.length - 1];
    if (
      !surface.contains(document.activeElement) &&
      document.activeElement !== mobileBack &&
      document.activeElement !== mobileFavorite
    ) {
      event.preventDefault();
      first.focus({ preventScroll: true });
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  function captureDetailContext() {
    if (state.detailContext) return;
    var moduleName = currentModule();
    var active = activeLayerElement("detail");
    var focus = document.activeElement;
    if (active && focus && active.contains(focus)) focus = null;
    var vocab = null;
    if (moduleName === "vocab") {
      var mode =
        window.ViewMode && typeof window.ViewMode.get === "function"
          ? window.ViewMode.get()
          : "cards";
      var page = 1;
      if (mode === "list" && window.appConfig && window.appConfig.listView) {
        page = window.appConfig.listView.currentPage || 1;
      }
      if (mode === "cards" && window.appConfig && window.appConfig.cardMode) {
        page = window.appConfig.cardMode.currentPage || 1;
      }
      vocab = { mode: mode, page: page };
    }
    state.detailContext = {
      module: moduleName,
      focus: focus,
      scroll: captureScrollState(moduleName),
      vocab: vocab,
    };
  }

  function restoreDetailContext() {
    var context = state.detailContext;
    if (!context) return;
    state.detailContext = null;
    if (context.module === "vocab" && context.vocab) {
      var mode = context.vocab.mode;
      var current =
        window.ViewMode && typeof window.ViewMode.get === "function"
          ? window.ViewMode.get()
          : "cards";
      var select = getElement("viewModeSelect");
      if (current !== mode && select) {
        select.value = mode;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      var renderer =
        mode === "list"
          ? window.appConfig && window.appConfig.listView
          : mode === "cards"
            ? window.appConfig && window.appConfig.cardMode
            : null;
      if (
        renderer &&
        context.vocab.page &&
        renderer.currentPage !== context.vocab.page
      ) {
        renderer.currentPage = Math.max(1, Number(context.vocab.page) || 1);
        if (typeof renderer.render === "function") renderer.render();
      }
    }
    restoreScrollState(context.scroll);
    window.setTimeout(function () {
      restoreScrollState(context.scroll);
      if (context.focus && context.focus.isConnected) {
        context.focus.focus({ preventScroll: true });
      }
    }, 0);
  }

  function requestLayer(layerName) {
    var topLayer = window.JPLearn && window.JPLearn.topLayer;
    if (topLayer && typeof topLayer.requestOpen === "function") {
      topLayer.requestOpen(layerName);
    }
  }

  function releaseLayer(layerName) {
    var topLayer = window.JPLearn && window.JPLearn.topLayer;
    if (topLayer && typeof topLayer.release === "function") {
      topLayer.release(layerName);
    }
  }

  function openFilter() {
    var moduleName = currentModule();
    var sidebar = activeSidebar(moduleName);
    var host = getElement("unifiedModuleSidebarHost");
    var content = getElement("mobileFilterContent");
    var sheet = getElement("mobileFilterSheet");
    var backdrop = getElement("mobileFilterBackdrop");
    if (!sidebar || !host || !content || !sheet || !backdrop) return false;

    if (settingsIsOpen()) closeSettings(false);
    if (searchIsOpen()) closeSearch(false);
    if (detailIsOpen()) closeDetail(false);
    if (chunkDetailIsOpen()) closeChunkDetail(false);
    if (state.filterModule) closeFilter(false);
    state.previousFocus = document.activeElement;
    state.filterOriginalParent = sidebar.parentElement;
    state.filterOriginalNextSibling = sidebar.nextSibling;
    state.filterModule = moduleName;
    state.filterSidebar = sidebar;
    state.filterContext = {
      module: moduleName,
      focus: state.previousFocus,
      sidebar: sidebar,
      parent: state.filterOriginalParent,
      nextSibling: state.filterOriginalNextSibling,
      controls: captureControlState(sidebar),
      scroll: captureScrollState(moduleName),
      navigation: captureModuleNavigation(),
      grammarList: captureGrammarFilterState(),
    };
    sidebar.classList.remove("tablet-drawer-open");
    sidebar.style.display = "";
    // The web layout collapses every module sidebar to the desktop rail and
    // re-applies that class on resize; keep it expanded while it is the sheet.
    state.filterContext.wasCollapsed =
      sidebar.classList.contains("sidebar-collapsed");
    sidebar.classList.remove("sidebar-collapsed");
    state.filterCollapseObserver = new MutationObserver(function () {
      if (sidebar.classList.contains("sidebar-collapsed")) {
        sidebar.classList.remove("sidebar-collapsed");
      }
    });
    state.filterCollapseObserver.observe(sidebar, {
      attributes: true,
      attributeFilter: ["class"],
    });
    sidebar
      .querySelectorAll("details.sidebar-tool-section")
      .forEach(function (details) {
        details.open =
          moduleName === "grammar" && details.id === "gmSidebarTools";
      });
    if (moduleName === "classics") {
      // Works first, then the open work's directory; reading tools stay
      // folded until asked for.
      var classicsDirectory = sidebar.querySelector(".cl-directory");
      if (classicsDirectory) classicsDirectory.open = true;
    }
    if (moduleName === "lesson") {
      arrangeLessonSheet(sidebar);
      // 教材册 and 本课目录 open folded each time, as 课程目录 does (DF-07).
      var bookList = sidebar.querySelector(".mobile-book-fold");
      if (bookList) bookList.open = false;
    }
    if (moduleName === "vocab") decorateVocabChoices();
    state.sheetOutlineOpen = false;
    renderSheetCurrent(moduleName);
    content.appendChild(sidebar);
    sheet.hidden = false;
    backdrop.hidden = false;
    backdrop.setAttribute("aria-hidden", "false");
    document.body.classList.add("mobile-filter-open");
    requestLayer("mobile-filter");

    var title = getElement("mobileFilterTitle");
    var summary = getElement("mobileFilterSummary");
    if (title) title.textContent = sheetTitleFor(moduleName);
    if (summary) summary.textContent = contextSummary(moduleName);
    // Focus starts at the sheet's name, as in any dialog: a screen reader
    // announces it, and a touch screen draws no ring around the first button.
    if (title) {
      title.setAttribute("tabindex", "-1");
      window.setTimeout(function () {
        if (state.filterModule === moduleName) title.focus();
      }, 0);
    }
    watchSheet(moduleName, sidebar);
    updateChrome();
    return true;
  }

  // A reading page's sheet is its table of contents; the lists keep the
  // filter. A landscape phone has no page block, so it keeps the filter too.
  function readingSheet(moduleName) {
    return (
      readerPage() &&
      (moduleName === "lesson" ||
        (moduleName === "grammar" && grammarReaderOpen()))
    );
  }

  function sheetTitleFor(moduleName) {
    if (moduleName === "classics") return "作品与目录";
    if (readingSheet(moduleName)) return "本课与目录";
    return (
      { lesson: "筛选课文", grammar: "筛选语法", vocab: "筛选词汇" }[
        moduleName
      ] || moduleMeta[moduleName].label + "筛选"
    );
  }

  // The lesson sheet's order and book list. The web redraws the whole
  // sidebar for every book, which undoes both, so this runs again after
  // each redraw; it changes nothing that is already right, so watching the
  // sidebar for redraws cannot loop.
  function arrangeLessonSheet(sidebar) {
    var picker = sidebar.querySelector(".tb-book-picker");
    var directory = sidebar.querySelector(".tb-lesson-directory");
    // The course directory is the sheet's main job on a phone; keep it
    // directly under the book picker, ahead of the reading tools.
    if (picker && directory && picker.nextElementSibling !== directory) {
      picker.parentElement.insertBefore(directory, picker.nextElementSibling);
    }
    if (picker) renderBookList(picker);
  }

  // The book picker as list rows: the system radio dialog is replaced, the
  // select stays in the DOM (hidden by the sheet's CSS) as the web's own
  // state, and a tap sets it and fires its change event.
  function renderBookList(picker) {
    var select = picker.querySelector("select");
    if (!select) return;
    var signature = Array.prototype.map
      .call(select.options, function (option) {
        var group = option.parentElement;
        return (
          option.value +
          ":" +
          option.textContent +
          ":" +
          (group.tagName === "OPTGROUP" ? group.label : "")
        );
      })
      .join("|");
    var list = picker.querySelector(".mobile-book-list");
    if (!list || list.dataset.signature !== signature) {
      if (list) list.remove();
      list = document.createElement("div");
      list.className = "mobile-book-list";
      list.dataset.signature = signature;
      list.setAttribute("role", "radiogroup");
      list.setAttribute("aria-label", "教材册");
      var addRows = function (parent, options) {
        options.forEach(function (option) {
          var row = document.createElement("button");
          row.type = "button";
          row.className = "mobile-book-row";
          row.setAttribute("role", "radio");
          row.dataset.bookId = option.value;
          var name = document.createElement("span");
          name.className = "mobile-book-name";
          name.textContent = option.textContent;
          row.appendChild(name);
          var mark = document.createElement("span");
          mark.className = "mobile-book-mark";
          mark.setAttribute("aria-hidden", "true");
          mark.innerHTML = iconMarkup("check");
          row.appendChild(mark);
          parent.appendChild(row);
        });
      };
      Array.prototype.forEach.call(select.children, function (child) {
        if (child.tagName !== "OPTGROUP") {
          addRows(list, [child]);
          return;
        }
        var group = document.createElement("div");
        group.className = "mobile-book-group";
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", child.label);
        var caption = document.createElement("span");
        caption.className = "mobile-book-group-name";
        caption.setAttribute("aria-hidden", "true");
        caption.textContent = child.label;
        group.appendChild(caption);
        addRows(group, Array.prototype.slice.call(child.children));
        list.appendChild(group);
      });
      list.addEventListener("click", function (event) {
        var row =
          event.target.closest && event.target.closest(".mobile-book-row");
        if (!row || row.dataset.bookId === select.value) return;
        select.value = row.dataset.bookId;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        markBookRows(list, select);
      });
      bookFold(picker, select).appendChild(list);
    }
    markBookRows(list, select);
  }

  // 教材册 folds like 课程目录, its summary naming the open book (DF-07).
  function bookFold(picker, select) {
    var fold = picker.querySelector(".mobile-book-fold");
    if (fold) return fold;
    fold = document.createElement("details");
    fold.className = "tb-sidebar-group mobile-book-fold";
    var summary = document.createElement("summary");
    var name = document.createElement("span");
    name.textContent = "教材册";
    summary.appendChild(name);
    summary.appendChild(document.createElement("small"));
    fold.appendChild(summary);
    picker.insertBefore(fold, select.nextSibling);
    picker.classList.add("mobile-book-picker--folded");
    return fold;
  }

  function markBookRows(list, select) {
    list.querySelectorAll(".mobile-book-row").forEach(function (row) {
      var checked = row.dataset.bookId === select.value;
      if (row.getAttribute("aria-checked") !== String(checked)) {
        row.setAttribute("aria-checked", String(checked));
      }
    });
    var note = list.parentElement.querySelector(
      ".mobile-book-fold > summary > small",
    );
    var option = select.options[select.selectedIndex];
    var name = option ? option.textContent : "";
    if (note && note.textContent !== name) note.textContent = name;
  }

  // The page block of the open sheet follows the page: switching the
  // textbook (or a grammar lesson) from inside the sheet redraws the heading,
  // the outline and the sidebar, in that order and over several ticks. Each
  // change schedules one pass; a pass that finds nothing changed touches no
  // node, so the focus stays where it is.
  function refreshSheetCurrent() {
    var moduleName = state.filterModule;
    var sheet = getElement("mobileFilterSheet");
    var block = getElement("mobileSheetCurrent");
    if (
      !moduleName ||
      !sheet ||
      sheet.hidden ||
      !block ||
      moduleName !== currentModule()
    )
      return;
    if (moduleName === "lesson" && state.filterSidebar) {
      arrangeLessonSheet(state.filterSidebar);
    }
    var title = getElement("mobileFilterTitle");
    var summary = getElement("mobileFilterSummary");
    var next = block.cloneNode(false);
    renderSheetCurrent(moduleName, next);
    if (next.hidden !== block.hidden || next.innerHTML !== block.innerHTML) {
      block.hidden = next.hidden;
      block.textContent = "";
      while (next.firstChild) block.appendChild(next.firstChild);
    }
    // A redraw replaces the control that had focus (a book row, a proxy);
    // focus then falls to the body, outside the modal sheet.
    if (
      title &&
      !state.filterSubpage &&
      !sheet.contains(document.activeElement)
    ) {
      title.focus({ preventScroll: true });
    }
    var heading = sheetTitleFor(moduleName);
    if (title && title.textContent !== heading) title.textContent = heading;
    var description = contextSummary(moduleName);
    if (summary && summary.textContent !== description) {
      summary.textContent = description;
    }
  }

  function scheduleSheetRefresh() {
    if (state.sheetRefreshTimer) return;
    state.sheetRefreshTimer = window.setTimeout(function () {
      state.sheetRefreshTimer = 0;
      refreshSheetCurrent();
    }, 0);
  }

  // While the sheet is open, watch what its page block and book list are
  // drawn from: the lesson reader (its outline), the grammar reader and the
  // textbook sidebar's own redraws.
  function watchSheet(moduleName, sidebar) {
    unwatchSheet();
    if (!window.MutationObserver) return;
    var observer = new MutationObserver(scheduleSheetRefresh);
    state.sheetObserver = observer;
    if (moduleName === "lesson") {
      var reader = getElement("tbReader");
      if (reader) {
        observer.observe(reader, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["aria-current"],
        });
      }
      var sidebarContent = sidebar.querySelector("#tbSidebarContent");
      if (sidebarContent) observer.observe(sidebarContent, { childList: true });
    } else if (moduleName === "grammar") {
      var grammarReader = getElement("gmLessonReader");
      if (grammarReader) {
        observer.observe(grammarReader, { childList: true, subtree: true });
      }
    }
  }

  function unwatchSheet() {
    if (state.sheetObserver) {
      state.sheetObserver.disconnect();
      state.sheetObserver = null;
    }
    if (state.sheetRefreshTimer) {
      window.clearTimeout(state.sheetRefreshTimer);
      state.sheetRefreshTimer = 0;
    }
  }

  function routePanelTools() {
    var panel = window.PanelLayout;
    if (
      !panel ||
      typeof panel.openTools !== "function" ||
      state.panelWrappedOpenTools
    )
      return;
    state.panelOriginalOpenTools = panel.openTools;
    // Page headings open module tools ("筛选", "目录") through the desktop
    // drawer, which the shell hides; open the filter sheet instead and let
    // the caller pick the element to focus inside it.
    state.panelWrappedOpenTools = function (options) {
      if (state.filterModule !== currentModule() && !openFilter()) return false;
      options = options || {};
      if (options.returnFocus) state.previousFocus = options.returnFocus;
      window.setTimeout(function () {
        var target =
          typeof options.focus === "function"
            ? options.focus()
            : options.focus
              ? document.querySelector(options.focus)
              : null;
        if (target && target.getClientRects().length) {
          target.focus({ preventScroll: true });
          if (target.scrollIntoView) target.scrollIntoView({ block: "center" });
        }
      }, 0);
      return true;
    };
    panel.openTools = state.panelWrappedOpenTools;
  }

  function fitMobileBook(pager) {
    var scroller = pager.scroller;
    var frame = pager.frame;
    if (
      !scroller ||
      !frame ||
      !frame.isConnected ||
      !scroller.clientHeight ||
      !scroller.clientWidth
    )
      return;
    var bounds = scroller.getBoundingClientRect();
    var scale = bounds.height ? scroller.clientHeight / bounds.height : 1;
    var top =
      (frame.getBoundingClientRect().top - bounds.top) * scale +
      scroller.scrollTop;
    var available = Math.floor(scroller.clientHeight - top - 12);
    // Native chrome costs another 132 px on a landscape/tablet viewport. The
    // web pager's 480 px desktop threshold need not hide a usable 320 px book.
    var maxHeight = available >= 320 ? available + "px" : "";
    if (frame.style.maxHeight === maxHeight) return;
    frame.style.maxHeight = maxHeight;
    frame.dataset.mobileBookFit = "true";
    pager.refresh();
  }

  // ART-20. Scene notes fold to two lines on a phone page (mobile-layout.css);
  // only a note the fold actually cuts becomes a button that opens it.
  function markSceneNotes(pager) {
    if (!readerPage() || !pager.body) return;
    pager.body
      .querySelectorAll(".tb-scene-note:not([aria-expanded])")
      .forEach(function (note) {
        if (note.scrollHeight <= note.clientHeight + 1) return;
        note.setAttribute("role", "button");
        note.setAttribute("tabindex", "0");
        note.setAttribute("aria-expanded", "false");
      });
  }

  // DF-03. A lesson's grammar folds under its section heading on a phone:
  // open by default, a tap on the heading closes it and another opens it.
  function markGrammarFolds(body) {
    if (!readerPage() || !body || typeof body.querySelectorAll !== "function")
      return;
    body
      .querySelectorAll(
        ".tb-section-grammar > .tb-section-head:not([aria-expanded])",
      )
      .forEach(function (head) {
        head.setAttribute("role", "button");
        head.setAttribute("tabindex", "0");
        head.setAttribute("aria-expanded", "true");
      });
  }

  // DF-04. A grammar point lists its first three examples on a phone; the
  // rest fold under 更多例句, one row on the page until it is opened. The
  // folded examples stay where they are, audio buttons and all. Runs are
  // consecutive examples: a KotobaFlow point's list, a 新编 point's examples
  // and each list in a grammar point's 例句 section.
  var EXAMPLE_ROWS =
    ".tb-cgrammar-examples > li, .tb-grammar-item .tb-item-body > .tb-example, " +
    "#gm-section-examples .gm-detail-section-body > .gm-ex-card, " +
    "#gm-section-examples .gm-detail-section-body > .gm-ex-simple";
  var SHOWN_EXAMPLES = 3;

  function foldExamples(container, keepOpen) {
    if (
      !readerPage() ||
      !container ||
      typeof container.querySelectorAll !== "function"
    )
      return;
    container.querySelectorAll(EXAMPLE_ROWS).forEach(function (first) {
      var previous = first.previousElementSibling;
      if (previous && previous.matches(EXAMPLE_ROWS)) return;
      var rows = [first];
      for (
        var next = first.nextElementSibling;
        next && next.matches(EXAMPLE_ROWS);
        next = next.nextElementSibling
      )
        rows.push(next);
      if (
        rows.length <= SHOWN_EXAMPLES ||
        rows[SHOWN_EXAMPLES].hasAttribute("data-mobile-more-example")
      )
        return;
      var folded = rows.slice(SHOWN_EXAMPLES);
      folded.forEach(function (row) {
        row.setAttribute("data-mobile-more-example", "");
      });
      var toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "mobile-more-examples";
      toggle._mobileRows = folded;
      // A list's rows are its items; the toggle follows the list.
      var last =
        first.parentElement.tagName === "OL"
          ? first.parentElement
          : rows[rows.length - 1];
      last.parentNode.insertBefore(toggle, last.nextSibling);
      setExamplesOpen(
        toggle,
        !!keepOpen &&
          folded.some(function (row) {
            return keepOpen(row);
          }),
      );
    });
  }

  function setExamplesOpen(toggle, open) {
    toggle._mobileRows.forEach(function (row) {
      row.hidden = !open;
    });
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.textContent = open
      ? "收起例句"
      : "更多例句（" + toggle._mobileRows.length + "）";
  }

  // A lesson laid out again (a display switch, a reload) returns to the
  // reading unit it saved; an example folded away would put it on page one,
  // so the list holding that unit stays open.
  function savedLessonUnit() {
    var textbook =
      window.ModuleSwitcher &&
      typeof window.ModuleSwitcher.getTextbookModule === "function"
        ? window.ModuleSwitcher.getTextbookModule()
        : null;
    var anchor =
      textbook && (textbook._bookRestoreAnchor || textbook._bookAnchor);
    var text = anchor && anchor.target && anchor.target.text;
    if (!text) return null;
    return function (row) {
      return row.textContent.replace(/\s+/g, " ").trim().slice(0, 160) === text;
    };
  }

  // After a fold opens or closes, the page shows the control that did it.
  function refoldBook(control) {
    var frame = control.closest(".book-frame");
    var pager = frame && frame._mobilePager;
    if (!pager) return;
    pager.refresh();
    var page = Math.floor(pager.columnOf(control) / pager.perSpread);
    if (pager.page !== page) pager.goTo(page, false);
  }

  // ART-B3. WebView 83 paginates with the engine before LayoutNG, which
  // ignores the web's break-after: avoid, so a section heading could close a
  // page while its text began on the next (KotobaFlow1 lesson 1, 「会话」).
  // After each new layout, a heading whose first line of following text lands
  // on a later page starts a page itself. A run of headings moves together:
  // only the first of them is marked. Pages are measured again after every
  // mark, so later headings see the shifted layout.
  var KEPT_HEADS =
    ".tb-section-head, .tb-cgrammar-head, .tb-cgrammar-subhead, .gm-reader-section-head";

  function keepHeadsWithText(pager) {
    var body = pager.body;
    if (state.keepingHeads || !readerPage() || !body || !(pager.column > 1))
      return;
    var layoutKey = [
      pager.columns,
      pager.column,
      body.scrollWidth,
      body.clientHeight,
      body.textContent.length,
    ].join("|");
    if (pager._mobileHeadsKey === layoutKey) return;
    state.keepingHeads = true;
    try {
      var marked = body.querySelectorAll("[data-mobile-keep]");
      if (marked.length) {
        marked.forEach(function (node) {
          node.removeAttribute("data-mobile-keep");
        });
        reflowBook(pager);
      }
      for (var round = 0; round < 12; round++) {
        var head = strandedHead(pager);
        if (!head) break;
        head.setAttribute("data-mobile-keep", "break");
        reflowBook(pager);
      }
      if (round === 12)
        console.warn("KotobaFlow: heading breaks did not settle");
    } finally {
      state.keepingHeads = false;
      pager._mobileHeadsKey = [
        pager.columns,
        pager.column,
        body.scrollWidth,
        body.clientHeight,
        body.textContent.length,
      ].join("|");
    }
  }

  // DF-22: the kana chart of KotobaFlow 1 lesson 0 (a table for each of the
  // lesson's phonetic_sections) ran on from the text before it, broke where
  // the page ended and continued without its column header, and its tap
  // detail followed the chart pages later. On a phone page each chart starts
  // a page and is cut between whole rows into parts that each fit a page,
  // every part under its own copy of the header; the detail floats as a card
  // above the footer (mobile-layout.css). The rows themselves move, so the
  // web's delegated taps, playback and selection keep working.
  function fitKanaTables(pager) {
    var body = pager.body;
    if (state.fittingKana || !readerPage() || !body || !(pager.column > 1))
      return;
    var sections = body.querySelectorAll(".tb-section-kana");
    if (!sections.length) return;
    var key = [pager.column, body.clientHeight, sections.length].join("|");
    if (pager._mobileKanaKey === key) return;
    state.fittingKana = true;
    try {
      sections.forEach(function (section) {
        joinKanaTable(section);
        section.setAttribute("data-mobile-kana", "");
      });
      reflowBook(pager);
      sections.forEach(function (section) {
        splitKanaTable(pager, section);
      });
      reflowBook(pager);
    } finally {
      state.fittingKana = false;
      pager._mobileKanaKey = key;
    }
  }

  function joinKanaTable(section) {
    var first = section.querySelector(".tb-kana-table > tbody");
    section
      .querySelectorAll("[data-mobile-kana-part]")
      .forEach(function (part) {
        part.querySelectorAll("tbody > tr").forEach(function (row) {
          first.appendChild(row);
        });
        part.remove();
      });
  }

  // Rows per part, measured on the whole chart: the first part shares its
  // page with the section head and hint. When more than one page is needed
  // the rows are spread evenly, so no part is left with a row or two.
  function kanaParts(pager, section, table) {
    var rows = Array.prototype.slice.call(table.tBodies[0].rows);
    var style = window.getComputedStyle(pager.body);
    var page =
      pager.body.clientHeight -
      parseFloat(style.paddingTop || 0) -
      parseFloat(style.paddingBottom || 0) -
      8;
    var head = table.tHead ? table.tHead.getBoundingClientRect().height : 0;
    var lead =
      table.getBoundingClientRect().top - section.getBoundingClientRect().top;
    var heights = rows.map(function (row) {
      return row.getBoundingClientRect().height + 1;
    });
    var capacity = function (index) {
      return (index ? page : page - lead) - head;
    };
    var greedy = [];
    var used = 0;
    heights.forEach(function (height, index) {
      var current = greedy[greedy.length - 1];
      if (
        !current ||
        (current.length && used + height > capacity(greedy.length - 1))
      ) {
        current = [];
        greedy.push(current);
        used = 0;
      }
      current.push(rows[index]);
      used += height;
    });
    if (greedy.length < 2) return greedy;
    var size = Math.ceil(rows.length / greedy.length);
    var even = [];
    for (var start = 0; start < rows.length; start += size)
      even.push(rows.slice(start, start + size));
    var fits = even.every(function (part, index) {
      var total = 0;
      part.forEach(function (row) {
        total += heights[rows.indexOf(row)];
      });
      return total <= capacity(index);
    });
    return fits && even.length === greedy.length ? even : greedy;
  }

  function splitKanaTable(pager, section) {
    var wrap = section.querySelector(".tb-kana-table-wrap");
    var table = wrap && wrap.querySelector(".tb-kana-table");
    if (!table || !table.tBodies[0] || !table.tBodies[0].rows.length) return;
    var parts = kanaParts(pager, section, table);
    var after = wrap;
    for (var index = 1; index < parts.length; index++) {
      var part = document.createElement("div");
      part.className = wrap.className;
      part.setAttribute("data-mobile-kana-part", "");
      var copy = table.cloneNode(false);
      if (table.caption) {
        var caption = table.caption.cloneNode(true);
        caption.textContent += "（续）";
        copy.appendChild(caption);
      }
      if (table.tHead) copy.appendChild(table.tHead.cloneNode(true));
      var rows = document.createElement("tbody");
      parts[index].forEach(function (row) {
        rows.appendChild(row);
      });
      copy.appendChild(rows);
      part.appendChild(copy);
      after.parentNode.insertBefore(part, after.nextSibling);
      after = part;
    }
  }

  function openKanaDetail() {
    return document.querySelector(
      "#textbookMain .tb-kana-detail[data-mobile-kana-open]",
    );
  }

  function closeKanaDetail() {
    var open = openKanaDetail();
    if (open) open.removeAttribute("data-mobile-kana-open");
    return !!open;
  }

  // The old engine computes a changed break-before but keeps the columns it
  // had laid out until something else invalidates them; a one-pixel width
  // change does, and is put back before anything paints.
  function reflowBook(pager) {
    var body = pager.body;
    var width = body.style.width;
    body.style.width = body.clientWidth - 1 + "px";
    void body.offsetWidth;
    body.style.width = width;
    void body.offsetWidth;
    pager.refresh();
  }

  function strandedHead(pager) {
    var heads = pager.body.querySelectorAll(KEPT_HEADS);
    for (var i = 0; i < heads.length; i++) {
      var head = heads[i];
      if (
        head.hasAttribute("data-mobile-keep") ||
        !head.getClientRects().length
      )
        continue;
      var start = pager.columnOf(head);
      var text = firstLineColumn(pager, head);
      if (text > start) {
        // Earlier headings stacked directly above move with this one.
        var lead = head;
        var previous = lead.previousElementSibling;
        while (
          previous &&
          previous.matches(KEPT_HEADS) &&
          pager.columnOf(previous) === start
        ) {
          lead = previous;
          previous = lead.previousElementSibling;
        }
        // The break goes on the outermost box the heading opens (its
        // section), where the old engine reliably honours it.
        while (
          lead.parentElement !== pager.body &&
          lead.parentElement.firstElementChild === lead
        )
          lead = lead.parentElement;
        return lead;
      }
    }
    return null;
  }

  // Page of the first line of text (or image) that follows the element in
  // the book.
  function firstLineColumn(pager, element) {
    var walker = document.createTreeWalker(
      pager.body,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    );
    var range = document.createRange();
    for (
      var node = nextOutside(walker, element);
      node;
      node = walker.nextNode()
    ) {
      var rect = null;
      if (node.nodeType === 3) {
        if (!node.textContent.trim()) continue;
        range.selectNodeContents(node);
        rect = range.getClientRects()[0];
      } else if (/^(IMG|SVG|VIDEO|CANVAS)$/i.test(node.tagName)) {
        rect = node.getClientRects()[0];
      }
      if (rect && (rect.width || rect.height)) return columnAt(pager, rect);
    }
    return -1;
  }

  function nextOutside(walker, element) {
    var node = element;
    while (node && !node.nextSibling && node !== walker.root)
      node = node.parentNode;
    if (!node || node === walker.root) return null;
    walker.currentNode = node.nextSibling;
    return walker.currentNode;
  }

  function columnAt(pager, rect) {
    var bounds = pager.body.getBoundingClientRect();
    var scale = bounds.width ? pager.body.clientWidth / bounds.width : 1;
    var left = (rect.left - bounds.left) * scale + pager.body.scrollLeft;
    return Math.max(0, Math.floor((left + 2) / pager.column));
  }

  function routeBookPagers() {
    var books = window.JPLearn && window.JPLearn.bookPager;
    if (!books || state.bookWrappedMount) return;
    state.bookOriginalMount = books.mount;
    state.bookWrappedMount = function (options) {
      // Marked before the pager's first layout, which runs inside mount.
      markLevelPlaceholders(options && options.body);
      markGrammarFolds(options && options.body);
      foldExamples(options && options.body, savedLessonUnit());
      var originalChange = options.onChange;
      var mobileOptions = Object.assign({}, options, {
        onChange: function (pager) {
          if (typeof originalChange === "function")
            originalChange.call(this, pager);
          if (pager.frame) pager.frame._mobilePager = pager;
          fitMobileBook(pager);
          markSceneNotes(pager);
          fitKanaTables(pager);
          keepHeadsWithText(pager);
          syncFolio(pager);
          renameGroupTurns(pager);
          showEveryLevel(pager);
          syncRunningHead();
        },
      });
      return state.bookOriginalMount(mobileOptions);
    };
    books.mount = state.bookWrappedMount;
  }

  // KotobaFlow words carry no JLPT level, so the web prints "-" in the level
  // slot of every lesson word. A phone page hides that placeholder; real
  // levels (新编 N5–N2) stay.
  function markLevelPlaceholders(body) {
    if (!body || typeof body.querySelectorAll !== "function") return;
    body
      .querySelectorAll(".tb-reading-vocab-row .tb-item-level")
      .forEach(function (level) {
        if (level.textContent.trim() === "-")
          level.setAttribute("data-mobile-placeholder", "");
      });
  }

  // ─── Phone reading: the screen is the page (2026-10-23) ─────────────────
  // Lessons, grammar, words and classics turn pages, so whatever sits above
  // the book costs every page its height. On a phone their page headings and
  // the grammar reader's toolbar fold into the filter sheet, the app bar
  // carries a running head that names the place, and the book footer shows
  // a folio. The web headings stay in the document, hidden; the sheet offers
  // their actions by clicking the originals, so the modules' own handlers,
  // labels and states stay authoritative.
  var READER_HEADINGS = {
    lesson: "tbLessonHeading",
    grammar: "grammarHeading",
    vocab: "vocabHeading",
    classics: "clPartHeading",
  };

  function readerPage() {
    return root.dataset.mobileReader === "page";
  }

  function grammarReaderOpen() {
    return !!(
      window.grammarModule &&
      window.grammarModule.currentView === "lesson-reader"
    );
  }

  // A grammar list opened from a lesson's study path, which 返回课文 leaves.
  function grammarCourseContext() {
    var grammar = window.grammarModule;
    var context = grammar && grammar.courseContext;
    return context && context.lessonId && !grammarReaderOpen() ? context : null;
  }

  function shownBook(moduleName) {
    var main = moduleMain(moduleName);
    var frames = main ? main.querySelectorAll(".book-frame") : [];
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].getClientRects().length) return frames[i];
    }
    return null;
  }

  // The section a page belongs to, as the pager names it in the page list
  // ("第 12 页 · 本课词汇").
  function bookSection(frame) {
    var select = frame && frame.querySelector(".book-page-select");
    var option = select && select.options[select.selectedIndex];
    return option ? option.textContent.split(" · ").slice(1).join(" · ") : "";
  }

  function trimmedText(node) {
    return node ? node.textContent.replace(/\s+/g, " ").trim() : "";
  }

  function headingTitle(host) {
    var title = host && host.querySelector(".page-heading-title");
    if (!title) return "";
    var text = title.querySelector(".page-heading-title-text");
    if (!text) return trimmedText(title);
    var prefix = trimmedText(title.querySelector(".page-heading-title-prefix"));
    return (prefix ? prefix + " " : "") + trimmedText(text);
  }

  // ART-17: on a phone only a screen is a "页". The web calls one catalog
  // page a 组 ("第 1 / 422 组 · 1–24 词"); the app bar names the entries
  // instead ("1–24 / 10,116 词", "1–24 / 739 条"). The total is the leading
  // number of the heading's count ("10,116 词", "739 个语法点").
  function catalogRange(extra, countText) {
    var range = /(\d[\d,]*)\s*[–-]\s*(\d[\d,]*)\s*(词|条)/.exec(extra);
    var total = /^\s*(\d[\d,]*)/.exec(countText);
    if (!range) return "";
    return (
      range[1] +
      "–" +
      range[2] +
      (total ? " / " + total[1] : "") +
      " " +
      range[3]
    );
  }

  function runningHead(moduleName) {
    var frame = shownBook(moduleName);
    if (moduleName === "grammar" && grammarReaderOpen()) {
      var reader = getElement("gmLessonReader");
      var number = trimmedText(
        reader && reader.querySelector(".gm-reader-lesson-no"),
      );
      return {
        title:
          trimmedText(reader && reader.querySelector(".gm-reader-title-ja")) ||
          number ||
          "辅助课文",
        aside: bookSection(frame) || number,
      };
    }
    var heading = getElement(READER_HEADINGS[moduleName]);
    var head = {
      title: heading && !heading.hidden ? headingTitle(heading) : "",
      aside: "",
    };
    if (moduleName === "classics") {
      head.aside = [textFrom(["statusClassicsBook"], ""), bookSection(frame)]
        .filter(Boolean)
        .join(" · ");
    } else if (moduleName === "lesson") {
      head.aside = bookSection(frame);
    } else {
      // Word and grammar catalogs: the entries of the filtered list on show.
      var countText = trimmedText(
        heading &&
          !heading.hidden &&
          heading.querySelector(".page-heading-meta-item"),
      );
      head.aside =
        catalogRange(
          trimmedText(frame && frame.querySelector(".book-status-extra")),
          countText,
        ) || countText;
    }
    if (!head.title) head.title = moduleMeta[moduleName].label;
    return head;
  }

  // An open entry names itself, then the panel's label ("语法详情"), whose
  // heading row a phone leaves out. A panel holding no single entry (the
  // lesson word list) shows its label alone.
  function detailRunningHead() {
    if (!document.body.classList.contains("mobile-detail-open")) return null;
    var panel = activeLayerElement("detail");
    if (!panel) return null;
    var label = trimmedText(panel.querySelector(".detail-panel-header h2"));
    var entryNode = panel.querySelector(
      ".gm-detail-title, .vocab-detail-title-row h3, .tb-vocab-popup-head h3, .detail-content > h3",
    );
    var entry = trimmedText(entryNode);
    // ART-11: a lesson word is named by its headword, over the subtitle
    // "课文词汇" (the panel label is "课文词汇详情").
    if (entryNode && entryNode.closest(".tb-vocab-popup-head")) {
      label = "课文词汇";
    }
    return entry ? { title: entry, aside: label } : { title: label, aside: "" };
  }

  // DF-15: a narrated work's player sits where the lesson's does, above the
  // bottom bar; the classics page leaves it that room (mobile-layout.css).
  // The reader draws the player with each part, and the part heading with it.
  function syncClassicsNarration() {
    var main = getElement("classicsMain");
    if (!main) return;
    var narrated = !!main.querySelector("#clReader .cl-audio");
    if (main.classList.contains("mobile-cl-narrated") !== narrated)
      main.classList.toggle("mobile-cl-narrated", narrated);
  }

  // The lesson and classics headings are created when those modules first
  // render; watch each heading once it exists. The grammar reader replaces
  // its children for every lesson.
  function watchRunningHeads() {
    var observer = state.headObserver;
    if (!observer) return;
    Object.keys(READER_HEADINGS).forEach(function (moduleName) {
      var heading = getElement(READER_HEADINGS[moduleName]);
      if (!heading || state.headWatched.has(heading)) return;
      state.headWatched.add(heading);
      observer.observe(heading, {
        attributes: true,
        attributeFilter: ["hidden"],
        characterData: true,
        childList: true,
        subtree: true,
      });
    });
    var reader = getElement("gmLessonReader");
    if (reader && !state.headWatched.has(reader)) {
      state.headWatched.add(reader);
      observer.observe(reader, { childList: true });
    }
    // Detail panels replace their content for each entry they show.
    ["detailContent", "gmDetailContent", "tbDetailContent"].forEach(
      function (id) {
        var content = getElement(id);
        if (!content || state.headWatched.has(content)) return;
        state.headWatched.add(content);
        observer.observe(content, { childList: true });
      },
    );
  }

  // ART-10: a word entry's 收藏 is a star in the detail app bar. The page's
  // button stays the real control (hidden on a phone); the entry is redrawn
  // after every change, which brings this back through the head observer.
  function syncDetailFavorite() {
    var proxy = getElement("mobileDetailFavorite");
    if (!proxy) return;
    var source = document.body.classList.contains("mobile-detail-open")
      ? document.querySelector("#detailContent #detailBtnFavorite")
      : null;
    if (proxy.hidden !== !source) proxy.hidden = !source;
    if (!source) return;
    var pressed = source.getAttribute("aria-pressed") || "false";
    if (proxy.getAttribute("aria-pressed") !== pressed) {
      proxy.setAttribute("aria-pressed", pressed);
    }
    proxy._mobileSource = source;
  }

  // ART-19: with the tab bar to jump by, a grammar point's section headings
  // are anchors, not toggles. Every section is open and the headings read as
  // headings; the page marks the content so the styles and the click guard
  // below know.
  function syncGrammarAnchors() {
    var content = getElement("gmDetailContent");
    if (!content) return;
    var anchored =
      readerPage() && !!content.querySelector(".gm-detail-outline");
    content.toggleAttribute("data-mobile-anchors", anchored);
    content
      .querySelectorAll(".gm-detail-section > summary")
      .forEach(function (summary) {
        if (anchored) {
          summary.parentElement.open = true;
          summary.setAttribute("role", "heading");
          summary.setAttribute("aria-level", "3");
          summary.tabIndex = -1;
        } else if (summary.getAttribute("role") === "heading") {
          summary.removeAttribute("role");
          summary.removeAttribute("aria-level");
          summary.removeAttribute("tabindex");
        }
      });
    foldExamples(content);
    syncGrammarTab(content);
  }

  // DF-09. The tabs follow the reader down a point: the current section is
  // the lowest whose heading has reached the bottom of the tab bar (a phone
  // orders the sections by position, mobile-layout.css, so position decides,
  // not the tab order). The detail scrolls in either reading layout. At the
  // end of the page the last short sections cannot reach the bar, so a tab
  // chosen there keeps its mark while its section is on screen below.
  function syncGrammarTab(content) {
    var tabs = readerPage() && content.querySelector(".gm-detail-outline");
    if (!tabs || !content.clientHeight) return;
    var buttons = tabs.querySelectorAll(".gm-detail-nav-btn");
    var line = tabs.getBoundingClientRect().bottom + 2;
    var topOf = function (button) {
      var section = getElement(button.getAttribute("data-section-target"));
      return section ? section.getBoundingClientRect().top : Infinity;
    };
    var current = null;
    Array.prototype.forEach.call(buttons, function (button) {
      var top = topOf(button);
      if (top <= line && (!current || top > topOf(current))) current = button;
    });
    var active = tabs.querySelector(".gm-detail-nav-btn.active");
    if (
      active &&
      current &&
      topOf(active) > topOf(current) &&
      topOf(active) < content.getBoundingClientRect().bottom &&
      content.scrollTop + content.clientHeight >= content.scrollHeight - 1
    )
      return;
    current = current || buttons[0];
    if (!current || current === active) return;
    Array.prototype.forEach.call(buttons, function (button) {
      button.classList.toggle("active", button === current);
    });
    if (tabs.scrollWidth > tabs.clientWidth) {
      tabs.scrollLeft =
        current.offsetLeft - (tabs.clientWidth - current.offsetWidth) / 2;
    }
  }

  function syncRunningHead() {
    syncGrammarAnchors();
    syncDetailFavorite();
    watchRunningHeads();
    var title = getElement("mobileRunningTitle");
    var aside = getElement("mobileRunningAside");
    if (!title || !aside) return;
    var moduleName = currentModule();
    var head = READER_HEADINGS[moduleName]
      ? detailRunningHead() || runningHead(moduleName)
      : { title: "", aside: "" };
    if (title.textContent !== head.title) title.textContent = head.title;
    if (aside.textContent !== head.aside) aside.textContent = head.aside;
    aside.hidden = !head.aside;
  }

  // Folio: the shown page and the page count. The page list stays the real
  // control, laid transparently over the folio so a tap still opens it.
  function syncFolio(pager) {
    if (pager._mobileFolioPage !== pager.page) {
      pager._mobileFolioPage = pager.page;
      closeKanaDetail();
    }
    var pages = pager.frame && pager.frame.querySelector(".book-pages");
    if (!pages || typeof pager.firstColumn !== "function") return;
    var folio = pages.querySelector(".mobile-folio");
    if (!folio) {
      folio = document.createElement("span");
      folio.className = "mobile-folio";
      folio.setAttribute("aria-hidden", "true");
      pages.insertBefore(folio, pages.firstChild);
    }
    var first = pager.firstColumn() + 1;
    var last = pager.lastColumn() + 1;
    var text =
      (last > first ? first + "–" + last : first) + " / " + pager.columns;
    if (folio.textContent !== text) folio.textContent = text;
  }

  // ART-21: the web keeps one level mark per spread when every entry shares
  // its level (CardMode._syncBookLevels), so after sorting by level only the
  // first row of a page said "N5". A phone row stands alone under the thumb
  // and carries its own mark.
  function showEveryLevel(pager) {
    if (!readerPage() || !pager.body) return;
    pager.body.querySelectorAll(".cc-level-repeated").forEach(function (mark) {
      mark.classList.remove("cc-level-repeated");
      mark.removeAttribute("aria-hidden");
    });
  }

  // The catalog's edge turns say 上一组/下一组 (ART-17); on a phone crossing
  // one is just the next screen.
  function renameGroupTurns(pager) {
    var turns = pager.frame
      ? pager.frame.querySelectorAll("[data-book-flip]")
      : [];
    Array.prototype.forEach.call(turns, function (turn) {
      var label = turn.getAttribute("aria-label") || "";
      var renamed = label.replace("组", "页");
      if (renamed === label) return;
      turn.setAttribute("aria-label", renamed);
      if (turn.title) turn.title = renamed;
    });
  }

  // Buttons of the current page heading, in the groups the sheet shows:
  // the one primary action, a previous/next pair, segmented choices, rows.
  // 筛选 and 目录 only open this sheet and are left out.
  function sheetActionKind(button) {
    var id = button.getAttribute("data-heading-action");
    if (id === "previous" || id === "next") return "pair";
    if (
      button.classList.contains("page-heading-action--segment") ||
      button.classList.contains("gm-toggle-btn")
    )
      return "segment";
    if (button.classList.contains("page-heading-action--primary"))
      return "primary";
    return "row";
  }

  function sheetSources(moduleName) {
    if (moduleName === "grammar" && grammarReaderOpen()) {
      var reader = getElement("gmLessonReader");
      var topbar = reader && reader.querySelector(".gm-reader-topbar");
      return {
        eyebrow: trimmedText(
          reader && reader.querySelector(".gm-reader-lesson-no"),
        ),
        title: runningHead(moduleName).title,
        meta: [
          trimmedText(reader && reader.querySelector(".gm-reader-title-zh")),
        ],
        // 返回列表 is the app bar's Back on a phone, and the section jumps
        // are the sheet's outline.
        buttons: topbar
          ? Array.from(topbar.querySelectorAll("button")).filter(
              function (button) {
                return (
                  button.id !== "gmReaderBack" &&
                  !button.closest(".gm-reader-jump-nav")
                );
              },
            )
          : [],
      };
    }
    var heading = getElement(READER_HEADINGS[moduleName]);
    if (!heading || heading.hidden) return null;
    var eyebrow = heading.querySelector(".page-heading-eyebrow");
    return {
      eyebrow: eyebrow && !eyebrow.hidden ? trimmedText(eyebrow) : "",
      title: headingTitle(heading),
      // The web's "第 1 / 422 页" counts catalog groups, which the app bar
      // shows as an entry range instead (ART-17).
      meta: Array.from(heading.querySelectorAll(".page-heading-meta-item"))
        .map(trimmedText)
        .filter(function (text) {
          return !/^第\s*\d+\s*\/\s*\d+\s*页$/.test(text);
        }),
      buttons: Array.from(
        heading.querySelectorAll(".page-heading-actions [data-heading-action]"),
      )
        .filter(function (button) {
          var id = button.getAttribute("data-heading-action");
          // 继续本课 only returns to the lesson, which the sheet's × does
          // (DF-07).
          if (moduleName === "lesson" && id === "continue") return false;
          return id !== "tools" && id !== "toc" && !button.hidden;
        })
        .concat(sheetExtraButtons(moduleName)),
    };
  }

  // Phone-only actions the sheet carries for its page: reading the word page
  // aloud, which the app bar shows only to stop (ART-22).
  function sheetExtraButtons(moduleName) {
    var readPage = getElement("mobileVocabReadPage");
    var mode =
      window.ViewMode && typeof window.ViewMode.get === "function"
        ? window.ViewMode.get()
        : "cards";
    return moduleName === "vocab" && readPage && mode === "cards"
      ? [readPage]
      : [];
  }

  // A proxy names the action as its source does: the visible label, and the
  // destination the source keeps in its title or accessible name ("上一课：
  // 第0课 …", "继续本课：预习词汇") as a second line.
  function sheetProxy(source, kind) {
    var proxy = document.createElement("button");
    proxy.type = "button";
    proxy.className = "mobile-sheet-action mobile-sheet-action--" + kind;
    var labelNode = source.querySelector(".page-heading-action-label");
    var label = trimmedText(labelNode || source);
    var detail = String(
      source.getAttribute("aria-label") || source.title || "",
    ).trim();
    var colon = detail.indexOf("：");
    detail = colon > -1 ? detail.slice(colon + 1).trim() : "";
    var icon = source.querySelector("ui-icon");
    var trailing = source.classList.contains("has-trailing-icon");
    if (icon && !trailing) proxy.appendChild(icon.cloneNode(true));
    var copy = document.createElement("span");
    copy.className = "mobile-sheet-action-copy";
    var strong = document.createElement("strong");
    strong.textContent = label;
    copy.appendChild(strong);
    if (detail && detail !== label) {
      var small = document.createElement("small");
      small.textContent = detail;
      copy.appendChild(small);
    }
    proxy.appendChild(copy);
    if (icon && trailing) proxy.appendChild(icon.cloneNode(true));
    var pressed =
      source.getAttribute("aria-pressed") ||
      (source.classList.contains("gm-toggle-btn")
        ? String(source.classList.contains("active"))
        : "");
    if (pressed) proxy.setAttribute("aria-pressed", pressed);
    var name = source.getAttribute("aria-label");
    if (name) proxy.setAttribute("aria-label", name);
    if (source.title) proxy.title = source.title;
    proxy.disabled = !!source.disabled;
    if (source.dataset.headingAction)
      proxy.dataset.sheetAction = source.dataset.headingAction;
    proxy._mobileSource = source;
    return proxy;
  }

  function renderSheetCurrent(moduleName, block) {
    block = block || getElement("mobileSheetCurrent");
    if (!block) return;
    block.textContent = "";
    var sources = readerPage() && sheetSources(moduleName);
    block.hidden = !sources;
    if (!sources) return;
    if (sources.eyebrow) {
      var eyebrow = document.createElement("p");
      eyebrow.className = "mobile-sheet-current-eyebrow";
      eyebrow.textContent = sources.eyebrow;
      block.appendChild(eyebrow);
    }
    var title = document.createElement("h3");
    title.id = "mobileSheetCurrentTitle";
    title.className = "mobile-sheet-current-title";
    title.textContent = sources.title || moduleMeta[moduleName].label;
    block.appendChild(title);
    var metaItems = sources.meta.filter(Boolean);
    if (metaItems.length) {
      var meta = document.createElement("p");
      meta.className = "mobile-sheet-current-meta";
      metaItems.forEach(function (item) {
        var span = document.createElement("span");
        span.textContent = item;
        meta.appendChild(span);
      });
      block.appendChild(meta);
    }
    var groups = [];
    sources.buttons.forEach(function (button) {
      var kind = sheetActionKind(button);
      // Segmented choices group by their own control; a page can have two.
      var parent = kind === "segment" ? button.parentElement : null;
      var group = groups.filter(function (candidate) {
        return candidate.kind === kind && candidate.parent === parent;
      })[0];
      if (!group) {
        group = { kind: kind, parent: parent, buttons: [] };
        groups.push(group);
      }
      group.buttons.push(button);
    });
    var rank = { primary: 0, pair: 1, segment: 2, row: 3 };
    groups
      .slice()
      .sort(function (a, b) {
        return (
          rank[a.kind] - rank[b.kind] || groups.indexOf(a) - groups.indexOf(b)
        );
      })
      .forEach(function (group) {
        var container = document.createElement("div");
        container.className =
          "mobile-sheet-actions mobile-sheet-actions--" + group.kind;
        if (group.kind === "segment") {
          container.setAttribute("role", "group");
          var groupName =
            group.parent &&
            (group.parent.getAttribute("aria-label") ||
              (group.parent.classList.contains("page-heading-actions")
                ? "视图"
                : ""));
          if (groupName) container.setAttribute("aria-label", groupName);
          container.style.gridTemplateColumns =
            "repeat(" + group.buttons.length + ", minmax(0, 1fr))";
        }
        group.buttons.forEach(function (button) {
          container.appendChild(sheetProxy(button, group.kind));
        });
        block.appendChild(container);
      });
    if (moduleName === "lesson") {
      renderSheetOutline(
        block,
        document.querySelectorAll("#tbReader .tb-outline nav a"),
        function (link) {
          return link.getAttribute("aria-current");
        },
        true,
      );
    } else if (moduleName === "grammar" && grammarReaderOpen()) {
      // The jumps name their sections as the pager does ("正文" for
      // "正文阅读"), which marks the current one.
      var section = bookSection(shownBook("grammar"));
      renderSheetOutline(
        block,
        document.querySelectorAll("#gmLessonReader .gm-reader-jump-nav button"),
        function (button, label) {
          return section &&
            (section.indexOf(label) === 0 || label.indexOf(section) === 0)
            ? "location"
            : "";
        },
      );
    }
  }

  // 本课目录: the sections of the open lesson, the current one marked. A
  // number the source sets apart (目标语法 10) becomes a trailing count.
  // Folded, it is a group like 课程目录, its summary naming the current
  // section (DF-07); it stays as the reader leaves it while the sheet is open.
  function renderSheetOutline(block, links, currentOf, folded) {
    if (!links.length) return;
    var nav = document.createElement("nav");
    nav.className = "mobile-sheet-outline";
    nav.setAttribute("aria-labelledby", "mobileSheetOutlineTitle");
    var heading = document.createElement("h4");
    heading.id = "mobileSheetOutlineTitle";
    heading.className = "mobile-sheet-outline-title";
    heading.textContent = "本课目录";
    var list = nav;
    var currentLabel = "";
    var currentNote = null;
    if (folded) {
      nav.className += " mobile-sheet-outline--folded";
      var fold = document.createElement("details");
      fold.className = "tb-sidebar-group mobile-sheet-outline-fold";
      fold.open = !!state.sheetOutlineOpen;
      fold.addEventListener("toggle", function () {
        state.sheetOutlineOpen = fold.open;
      });
      var summary = document.createElement("summary");
      var name = document.createElement("span");
      name.id = heading.id;
      name.textContent = heading.textContent;
      summary.appendChild(name);
      currentNote = document.createElement("small");
      summary.appendChild(currentNote);
      fold.appendChild(summary);
      nav.appendChild(fold);
      list = fold;
    } else {
      nav.appendChild(heading);
    }
    Array.prototype.forEach.call(links, function (link) {
      var proxy = document.createElement("button");
      proxy.type = "button";
      proxy.className = "mobile-sheet-outline-link";
      var countNode = link.querySelector("span");
      var count = trimmedText(countNode);
      var label = trimmedText(link);
      if (count && /^\d+$/.test(count))
        label = label.slice(0, label.lastIndexOf(count)).trim();
      else count = "";
      proxy.textContent = label;
      if (count) {
        var small = document.createElement("small");
        small.className = "mobile-sheet-outline-count";
        small.textContent = count;
        proxy.appendChild(small);
      }
      var current = currentOf(link, label);
      if (current) {
        proxy.setAttribute("aria-current", current);
        currentLabel = label;
      }
      proxy._mobileSource = link;
      list.appendChild(proxy);
    });
    if (currentNote) currentNote.textContent = currentLabel;
    block.appendChild(nav);
  }

  // A proxy closes the sheet, then lets the original do its work: lesson
  // and part changes, course steps and view choices all happen on the page.
  function runSheetProxy(proxy) {
    var source = proxy && proxy._mobileSource;
    if (!source || proxy.disabled) return;
    closeFilter(true);
    if (source.isConnected && !source.disabled) source.click();
    window.setTimeout(updateChrome, 0);
  }

  function syncAppBarBack(layer) {
    var back = getElement("mobileAppBarBack");
    if (!back) return;
    // The grammar reader's 返回列表 and a study path's 返回课文 become the
    // app bar's Back.
    back.hidden =
      !layer &&
      !(
        readerPage() &&
        currentModule() === "grammar" &&
        (grammarReaderOpen() || grammarCourseContext())
      );
  }

  function closeFilter(restoreFocus, options) {
    options = options || {};
    var context = state.filterContext;
    if (state.filterSubpage) closeFilterSubpage(false);
    unwatchSheet();
    var host = getElement("unifiedModuleSidebarHost");
    var sidebar = state.filterSidebar;
    var originalParent =
      state.filterOriginalParent || (context && context.parent);
    var originalNextSibling =
      state.filterOriginalNextSibling || (context && context.nextSibling);
    if (state.filterCollapseObserver) {
      state.filterCollapseObserver.disconnect();
      state.filterCollapseObserver = null;
    }
    if (sidebar && context && context.wasCollapsed) {
      sidebar.classList.add("sidebar-collapsed");
    }
    if (sidebar && originalParent && originalParent.isConnected) {
      originalParent.insertBefore(
        sidebar,
        originalNextSibling &&
          originalNextSibling.parentElement === originalParent
          ? originalNextSibling
          : null,
      );
      sidebar.classList.remove("tablet-drawer-open");
    } else if (sidebar && host) {
      host.appendChild(sidebar);
      sidebar.classList.remove("tablet-drawer-open");
    }
    state.filterModule = null;
    state.filterSidebar = null;
    state.filterOriginalParent = null;
    state.filterOriginalNextSibling = null;
    state.filterContext = null;
    var sheet = getElement("mobileFilterSheet");
    var backdrop = getElement("mobileFilterBackdrop");
    if (sheet) sheet.hidden = true;
    if (backdrop) {
      backdrop.hidden = true;
      backdrop.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("mobile-filter-open");
    releaseLayer("mobile-filter");
    if (restoreFocus && context && context.focus && context.focus.focus) {
      context.focus.focus({ preventScroll: true });
    } else if (
      restoreFocus &&
      state.previousFocus &&
      state.previousFocus.focus
    ) {
      state.previousFocus.focus({ preventScroll: true });
    }
    state.previousFocus = null;
    updateChrome();
  }

  function settingsIsOpen() {
    var panel = getElement("appSettingsPanel");
    // The web settings controller animates closed for 190 ms before hiding.
    // During that animation ownership already belongs to the new dialog.
    return !!(
      panel &&
      !panel.hidden &&
      !panel.classList.contains("is-closing")
    );
  }

  function settingsDataIsOpen() {
    var page = getElement("mobileSettingsDataPage");
    return !!(page && !page.hidden);
  }

  function openSettingsData() {
    if (!settingsIsOpen()) return false;
    var page = getElement("mobileSettingsDataPage");
    var danger = document.querySelector(
      "#mobileSettingsDataPage .app-settings-danger",
    );
    if (!page || !danger) return false;
    state.settingsDataFocus = document.activeElement;
    page.hidden = false;
    danger.open = true;
    updateChrome();
    var back = getElement("mobileSettingsDataBack");
    if (back) back.focus({ preventScroll: true });
    return true;
  }

  function closeSettingsData(restoreFocus) {
    var page = getElement("mobileSettingsDataPage");
    if (!page || page.hidden) return false;
    page.hidden = true;
    var focus = restoreFocus ? state.settingsDataFocus : null;
    state.settingsDataFocus = null;
    updateChrome();
    if (focus && focus.isConnected && typeof focus.focus === "function") {
      focus.focus({ preventScroll: true });
    }
    return true;
  }

  function syncSettings() {
    var sheet = getElement("mobileSettingsSheet");
    var open = settingsIsOpen();
    if (sheet) sheet.hidden = !open;
    if (!open && settingsDataIsOpen()) closeSettingsData(false);
    document.body.classList.toggle("mobile-settings-open", open);
    // The existing settings controller already owns the product top-layer id.
    // Reusing it prevents this mobile wrapper from closing the panel it just
    // opened. Claim it only as the sheet opens: a dialog launched from the
    // sheet (配色与字体) takes the layer over, and claiming it back on a
    // later sync would close that dialog at once.
    if (open && !state.settingsLayerHeld) requestLayer("app-settings");
    else if (!open && state.settingsLayerHeld) releaseLayer("app-settings");
    state.settingsLayerHeld = open;
    updateChrome();
  }

  function toggleSettings() {
    var toggle = getElement("appSettingsToggle");
    if (!toggle) return false;
    if (state.filterModule) closeFilter(false);
    if (searchIsOpen()) closeSearch(false);
    if (detailIsOpen()) closeDetail(false);
    if (chunkDetailIsOpen()) closeChunkDetail(false);
    if (planIsOpen()) closePlan();
    toggle.click();
    window.setTimeout(syncSettings, 0);
    return true;
  }

  function closeSettings(restoreFocus) {
    closeSettingsData(false);
    if (settingsIsOpen()) {
      var toggle = getElement("appSettingsToggle");
      if (toggle) toggle.click();
    }
    var sheet = getElement("mobileSettingsSheet");
    if (sheet) sheet.hidden = true;
    document.body.classList.remove("mobile-settings-open");
    releaseLayer("app-settings");
    if (restoreFocus && state.previousFocus && state.previousFocus.focus) {
      state.previousFocus.focus();
    }
    state.previousFocus = null;
    updateChrome();
  }

  function searchIsOpen() {
    var overlay = getElement("globalSearchOverlay");
    return !!(
      overlay &&
      !overlay.hidden &&
      overlay.getAttribute("aria-hidden") !== "true"
    );
  }

  function syncMobileSearchGroups() {
    var results = getElement("globalSearchResults");
    var input = getElement("globalSearchInput");
    if (!results || !input) return;

    var query = String(input.value || "").trim();
    var groupMeta = [
      { kind: "vocab", label: "词汇", icon: "library" },
      { kind: "grammar", label: "语法", icon: "grammar" },
      { kind: "lesson", label: "课文", icon: "book" },
    ];
    var sections = Array.prototype.slice
      .call(results.children)
      .filter(function (node) {
        return node.classList && node.classList.contains("global-search-group");
      });

    if (!query) {
      sections.forEach(function (section) {
        if (section.classList.contains("mobile-search-empty-group")) {
          section.remove();
        }
      });
      return;
    }

    var genericEmpty = results.querySelector(".global-search-empty");
    if (genericEmpty) genericEmpty.remove();

    var loading = (
      getElement("globalSearchStatus")?.textContent || ""
    ).includes("正在读取更多索引");
    var sectionByKind = {};
    sections.forEach(function (section) {
      var kind = section.dataset.mobileSearchKind || "";
      if (!kind) {
        var heading = section.querySelector(
          ".global-search-group-heading > span",
        );
        var headingText = heading ? heading.textContent.trim() : "";
        var matched = groupMeta.find(function (meta) {
          return headingText.indexOf(meta.label) !== -1;
        });
        kind = matched ? matched.kind : "";
        if (kind) section.dataset.mobileSearchKind = kind;
      }
      if (kind) sectionByKind[kind] = section;
    });

    groupMeta.forEach(function (meta, index) {
      var section = sectionByKind[meta.kind];
      if (!section) {
        section = document.createElement("section");
        section.className = "global-search-group mobile-search-empty-group";
        section.dataset.mobileSearchKind = meta.kind;
        section.setAttribute("aria-label", meta.label + "结果");

        var heading = document.createElement("div");
        heading.className = "global-search-group-heading";
        var headingLabel = document.createElement("span");
        headingLabel.innerHTML = iconMarkup(meta.icon);
        headingLabel.appendChild(document.createTextNode(meta.label));
        var count = document.createElement("small");
        count.textContent = "0";
        heading.appendChild(headingLabel);
        heading.appendChild(count);

        var empty = document.createElement("div");
        empty.className = "global-search-group-empty";
        section.appendChild(heading);
        section.appendChild(empty);

        var next = groupMeta
          .slice(index + 1)
          .map(function (nextMeta) {
            return sectionByKind[nextMeta.kind];
          })
          .find(Boolean);
        if (next) results.insertBefore(section, next);
        else results.appendChild(section);
        sectionByKind[meta.kind] = section;
      }

      var empty = section.querySelector(".global-search-group-empty");
      if (empty) {
        var nextText = loading
          ? "正在读取" + meta.label + "索引…"
          : "暂无匹配的" + meta.label;
        if (empty.textContent !== nextText) empty.textContent = nextText;
      }
    });
  }

  function toggleSearch() {
    var toggle = getElement("globalSearchToggle");
    if (!toggle) return false;
    clearSearchReturnContext();
    if (state.filterModule) closeFilter(false);
    if (settingsIsOpen()) closeSettings(false);
    if (detailIsOpen()) closeDetail(false);
    if (chunkDetailIsOpen()) closeChunkDetail(false);
    if (planIsOpen()) closePlan();
    toggle.click();
    return true;
  }

  function closeSearch(restoreFocus) {
    var close = document.querySelector(
      "#globalSearchOverlay [data-global-search-close], #globalSearchClose, #globalSearchCancel",
    );
    if (close) close.click();
    if (restoreFocus && state.previousFocus && state.previousFocus.focus) {
      state.previousFocus.focus();
    }
    state.previousFocus = null;
    updateChrome();
  }

  function clearSearchReturnContext() {
    if (state.searchReturnTimer) {
      window.clearTimeout(state.searchReturnTimer);
      state.searchReturnTimer = 0;
    }
    if (state.searchResultFallbackTimer) {
      window.clearTimeout(state.searchResultFallbackTimer);
      state.searchResultFallbackTimer = 0;
    }
    state.searchReturnContext = null;
  }

  function captureSearchReturnContext(resultButton) {
    var input = getElement("globalSearchInput");
    var results = getElement("globalSearchResults");
    if (!searchIsOpen() || !input || !results || !resultButton) return;
    clearSearchReturnContext();
    var heading = resultButton
      .closest(".global-search-group")
      ?.querySelector(".global-search-group-heading > span");
    var headingText = heading ? heading.textContent.trim() : "";
    var kind =
      headingText.indexOf("语法") !== -1
        ? "grammar"
        : headingText.indexOf("课文") !== -1
          ? "lesson"
          : "vocab";
    // Lesson results navigate to their reader; they do not own a detail layer.
    if (kind === "lesson") return;
    var context = {
      query: String(input.value || ""),
      scrollTop: results.scrollTop || 0,
      resultIndex: resultButton.getAttribute("data-search-index") || "",
      title:
        resultButton.querySelector(".global-search-result-copy strong")
          ?.textContent || "",
      kind: kind,
      panelId: kind === "grammar" ? "grammarDetailPanel" : "detailPanel",
      detailOpened: false,
    };
    state.searchReturnContext = context;
    state.searchResultFallbackTimer = window.setTimeout(function () {
      state.searchResultFallbackTimer = 0;
      if (state.searchReturnContext !== context || detailIsOpen()) return;
      if (kind === "vocab" && currentModule() === "vocab") {
        var words = window.taxonomyManager?.allWords || [];
        var card = document.querySelector("#vocabMain .cc-card");
        var cardIndex = card && card.getAttribute("data-index");
        var word = words.find(function (candidate) {
          return (
            String(candidate?.index) === String(cardIndex) &&
            String(candidate.word || candidate.label || "") === context.title
          );
        });
        var anchor = card;
        if (word && window.detailPanel?.showNode) {
          window.detailPanel.showNode(
            { type: "word", rawData: word },
            anchor?.querySelector(".cc-card-body") ||
              anchor ||
              getElement("modBtnVocab"),
            { focus: true },
          );
        }
      }
    }, 1200);
    state.searchReturnTimer = window.setTimeout(function () {
      state.searchReturnTimer = 0;
      // Limit only a failed asynchronous handoff. Reading an open detail has
      // no time limit; its close/module transition owns cleanup instead.
      if (state.searchReturnContext === context && !context.detailOpened) {
        clearSearchReturnContext();
      }
    }, 5000);
  }

  function restoreSearchReturnContext(context) {
    if (!context || !context.query) return;
    var opened = toggleSearch();
    if (!opened) return;
    updateChrome();
    var input = getElement("globalSearchInput");
    if (!input) return;
    input.value = context.query;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    var attempts = 0;
    var restore = function () {
      if (!searchIsOpen()) return;
      var results = getElement("globalSearchResults");
      var status = getElement("globalSearchStatus");
      if (!results) return;
      var ready =
        status &&
        !String(status.textContent || "").includes("正在读取更多索引") &&
        results.querySelectorAll(".global-search-group").length >= 3;
      if (ready || attempts >= 30) {
        results.scrollTop = Number(context.scrollTop) || 0;
        return;
      }
      attempts += 1;
      window.setTimeout(restore, 100);
    };
    window.setTimeout(restore, 80);
  }

  function closePlan() {
    var close = document.querySelector(
      ".dashboard-plan-overlay [data-dashboard-action='close-plan']",
    );
    if (close) close.click();
    else releaseLayer("dashboard-plan");
    updateChrome();
  }

  function closeChunkDetail(restoreFocus) {
    var textbook = getTextbookModule();
    if (textbook && typeof textbook._closeChunkDetail === "function") {
      textbook._closeChunkDetail(restoreFocus !== false);
    } else {
      var close = document.querySelector(
        "#tbChunkDetail .tb-chunk-detail-close",
      );
      if (close) close.click();
    }
    updateChrome();
  }

  function detailIsOpen() {
    return !!document.querySelector(
      ".detail-panel.anchored-detail-open, .detail-panel[aria-hidden='false']",
    );
  }

  // DF-20: an entry slides in from the right and back out on Back, and a
  // module fades in when it replaces another. Only transform and opacity
  // move, for about 200 ms; with Android's animations removed nothing moves.
  // The web pins the open panel's transform with !important, which keyframes
  // cannot override but a transition can (mobile-layout.css). WebView 83 has
  // no Animation.finished, so transitionend or a timer ends each one.
  var DETAIL_SLIDE_MS = 200;
  var MODULE_FADE_MS = 180;

  function motionReduced() {
    return root.getAttribute("data-mobile-motion") === "reduce";
  }

  function openDetailPanel() {
    return document.querySelector(".detail-panel.anchored-detail-open");
  }

  function slideDetailIn() {
    var panel = openDetailPanel();
    if (!panel || motionReduced()) return;
    panel.style.setProperty("transition", "none", "important");
    panel.style.setProperty("--mobile-detail-offset", "translateX(100%)");
    void window.getComputedStyle(panel).transform;
    panel.style.removeProperty("transition");
    panel.style.removeProperty("--mobile-detail-offset");
  }

  // The entry closes once it has slid out. An entry opened meanwhile keeps
  // the panel: the slide turns back and nothing closes.
  function slideDetailOut(done) {
    var panel = openDetailPanel();
    if (!panel || motionReduced()) return done();
    state.detailLeaving = true;
    var timer = 0;
    function end(close) {
      if (!state.detailLeaving) return;
      state.detailLeaving = false;
      state.cancelDetailLeave = null;
      window.clearTimeout(timer);
      panel.removeEventListener("transitionend", ended);
      // Something else (a module switch) may have closed it meanwhile.
      if (close && panel.classList.contains("anchored-detail-open")) done();
      panel.style.removeProperty("--mobile-detail-offset");
    }
    function ended(event) {
      if (event.target === panel && event.propertyName === "transform")
        end(true);
    }
    state.cancelDetailLeave = function () {
      end(false);
    };
    panel.addEventListener("transitionend", ended);
    timer = window.setTimeout(function () {
      end(true);
    }, DETAIL_SLIDE_MS + 80);
    panel.style.setProperty("--mobile-detail-offset", "translateX(100%)");
  }

  function watchDetailOpens() {
    var anchored = window.JPLearn && window.JPLearn.anchoredDetail;
    if (!anchored || typeof anchored.open !== "function") return;
    var open = anchored.open;
    anchored.open = function () {
      if (state.cancelDetailLeave) state.cancelDetailLeave();
      return open.apply(this, arguments);
    };
    state.cleanup.push(function () {
      anchored.open = open;
    });
  }

  function fadeModuleIn(moduleName) {
    var previous = state.enteringMain;
    if (previous) previous.removeAttribute("data-mobile-enter");
    window.clearTimeout(state.moduleFadeTimer);
    var main = moduleMain(moduleName);
    state.enteringMain = null;
    if (!main || motionReduced()) return;
    void main.offsetWidth;
    main.setAttribute("data-mobile-enter", "");
    state.enteringMain = main;
    state.moduleFadeTimer = window.setTimeout(function () {
      main.removeAttribute("data-mobile-enter");
      state.enteringMain = null;
    }, MODULE_FADE_MS + 60);
  }

  function closeDetail(restoreFocus) {
    var anchored = window.JPLearn && window.JPLearn.anchoredDetail;
    if (anchored && typeof anchored.close === "function") {
      var active =
        typeof anchored.getActiveModule === "function"
          ? anchored.getActiveModule()
          : currentModule();
      anchored.close(active, restoreFocus !== false);
    } else {
      var close = document.querySelector(
        ".detail-panel.anchored-detail-open [data-detail-close], .detail-panel.anchored-detail-open .detail-close-btn",
      );
      if (close) close.click();
    }
    updateChrome();
  }

  function openContext() {
    var moduleName = currentModule();
    if (moduleName === "dashboard") return toggleSettings();
    return openFilter();
  }

  function scrollModuleToTop(moduleName) {
    var main = moduleMain(moduleName);
    if (main && typeof main.scrollTo === "function") {
      main.scrollTo({ top: 0, left: 0, behavior: "auto" });
    } else if (main) {
      main.scrollTop = 0;
      main.scrollLeft = 0;
    }
    if (main) {
      main
        .querySelectorAll(
          ".card-container, .list-container, .study-container, .gm-subview-pane, .tb-reader",
        )
        .forEach(function (scrollable) {
          if (getComputedStyle(scrollable).display === "none") return;
          if (typeof scrollable.scrollTo === "function") {
            scrollable.scrollTo({ top: 0, left: 0, behavior: "auto" });
          } else {
            scrollable.scrollTop = 0;
            scrollable.scrollLeft = 0;
          }
        });
    }
    if (window.scrollTo) window.scrollTo(0, 0);
  }

  function syncVocabToolbar() {
    var toolbar = getElement("mobileVocabToolbar");
    if (readerPage()) {
      // The vocabulary heading is folded away on a phone; reading the page
      // aloud stays one tap away, beside search in the app bar.
      var search = getElement("mobileAppSearchButton");
      if (toolbar && search && toolbar.nextElementSibling !== search) {
        search.parentElement.insertBefore(toolbar, search);
      }
    } else {
      var headingActions = document.querySelector(
        "#vocabHeading .page-heading-actions",
      );
      if (
        headingActions &&
        toolbar &&
        toolbar.parentElement !== headingActions
      ) {
        headingActions.appendChild(toolbar);
      }
    }
    var select = getElement("viewModeSelect");
    var mode =
      window.ViewMode && typeof window.ViewMode.get === "function"
        ? window.ViewMode.get()
        : select && select.value
          ? select.value
          : "cards";
    document
      .querySelectorAll("#mobileVocabModeButtons [data-mobile-vocab-mode]")
      .forEach(function (button) {
        var active = button.dataset.mobileVocabMode === mode;
        button.setAttribute("aria-selected", active ? "true" : "false");
        button.tabIndex = active ? 0 : -1;
      });
    var summary = getElement("mobileVocabResultSummary");
    if (summary) summary.textContent = contextSummary("vocab");
    var filterSummary = getElement("mobileFilterSummary");
    if (filterSummary && state.filterModule) {
      filterSummary.textContent = contextSummary(state.filterModule);
    }
    syncVocabReadPageButton();
  }

  function syncVocabReadPageButton() {
    var button = getElement("mobileVocabReadPage");
    if (!button) return;
    if (state.vocabAudioSyncTimer) {
      window.clearTimeout(state.vocabAudioSyncTimer);
      state.vocabAudioSyncTimer = 0;
    }
    var mode =
      window.ViewMode && typeof window.ViewMode.get === "function"
        ? window.ViewMode.get()
        : "cards";
    var player = window.VocabTTS;
    var playing = !!(player && player.isPlaying);
    // On a phone page reading aloud starts from the sheet; the bar's read
    // button comes back only to stop (ART-22). The sheet's 随机学 20 词 is
    // the one study entry (DF-12).
    var page = readerPage();
    button.hidden = mode !== "cards" || (page && !playing);
    button.disabled = !getElement("ccReadPage");
    button.classList.toggle("is-playing", playing);
    button.setAttribute("aria-pressed", playing ? "true" : "false");
    button.innerHTML =
      iconMarkup(playing ? "pause" : "play") +
      "<span>" +
      (playing ? "停止顺序朗读" : "顺序朗读本页") +
      "</span>";
    if (playing) {
      state.vocabAudioSyncTimer = window.setTimeout(
        syncVocabReadPageButton,
        350,
      );
    }
  }

  // DF-13: the sheet has no room for Android's select popup. The vocabulary's
  // lists become choices drawn like the sheet's own: a short one (the list
  // view's 排序 and 每页) a segmented track, a long one (词性, 领域, 语义标签)
  // a row naming the choice that opens its chips in place. The select stays
  // the source: a choice sets it and sends change.
  var VOCAB_CHOICE_SELECTS = [
    "posSelect",
    "domainSelect",
    "semanticSelect",
    "listSortSelect",
    "pageSizeSelect",
  ];

  // The card view hides its 排序 and 每页; they belong to the list.
  var VOCAB_CARD_HIDDEN_FIELDS = ["ccSortSelect", "ccPerPageSelect"];

  function choiceLabel(option) {
    // "名词 (noun)" adds the code after the name; the chip keeps the name.
    return (
      option.textContent.replace(/\s*\([^()]*\)\s*$/, "").trim() || option.value
    );
  }

  function decorateVocabChoices() {
    VOCAB_CHOICE_SELECTS.forEach(function (id) {
      var select = getElement(id);
      if (select) decorateChoiceSelect(select);
    });
    VOCAB_CARD_HIDDEN_FIELDS.forEach(function (id) {
      var select = getElement(id);
      var field = select && select.closest(".sidebar-tool-field");
      if (field) field.classList.add("mobile-choice-off");
    });
  }

  function decorateChoiceSelect(select) {
    // A filter group holds its label and select; a view tool is a <label>
    // around both, so its choices follow it rather than sit inside it.
    var group = select.closest(".filter-group");
    var field = group || select.closest(".sidebar-tool-field");
    if (!field) return;
    var nameNode = group
      ? group.querySelector("label")
      : field.querySelector("span");
    var name = trimmedText(nameNode);
    var options = Array.prototype.slice.call(select.options);
    var key = options
      .map(function (option) {
        return option.value + "=" + option.textContent;
      })
      .join("|");
    var box = select._mobileChoice;
    if (!box || !box.isConnected || box._mobileKey !== key) {
      var expanded = !!(box && box._mobileExpanded);
      if (box && box.parentNode) box.parentNode.removeChild(box);
      box = buildChoiceBox(select, name, options, expanded);
      box._mobileKey = key;
      select._mobileChoice = box;
      field.classList.add("mobile-choice-field");
      if (group) group.appendChild(box);
      else field.parentNode.insertBefore(box, field.nextSibling);
    }
    syncChoiceBox(box);
  }

  function buildChoiceBox(select, name, options, expanded) {
    var track = options.length <= 5;
    var box = document.createElement("div");
    box.className =
      "mobile-choice mobile-choice--" + (track ? "track" : "chips");
    box._mobileSelect = select;
    box._mobileExpanded = expanded;
    var list = document.createElement("div");
    list.id = select.id + "MobileChoices";
    list.className = "mobile-choice-list";
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", name);
    options.forEach(function (option) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "mobile-choice-chip";
      chip.dataset.value = option.value;
      chip.textContent = choiceLabel(option);
      list.appendChild(chip);
    });
    if (track) {
      var label = document.createElement("span");
      label.className = "filter-label mobile-choice-name";
      label.textContent = name;
      box.appendChild(label);
      list.style.gridTemplateColumns =
        "repeat(" + options.length + ", minmax(0, 1fr))";
    } else {
      var head = document.createElement("button");
      head.type = "button";
      head.className = "mobile-choice-head";
      head.setAttribute("aria-controls", list.id);
      head.innerHTML =
        '<span class="mobile-choice-name"></span>' +
        '<span class="mobile-choice-value"></span>';
      head.firstChild.textContent = name;
      box.appendChild(head);
    }
    box.appendChild(list);
    return box;
  }

  function syncChoiceBox(box) {
    var select = box._mobileSelect;
    if (!select) return;
    box.querySelectorAll(".mobile-choice-chip").forEach(function (chip) {
      var on = chip.dataset.value === select.value;
      chip.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var head = box.querySelector(".mobile-choice-head");
    if (!head) return;
    var list = box.querySelector(".mobile-choice-list");
    head.setAttribute("aria-expanded", box._mobileExpanded ? "true" : "false");
    list.hidden = !box._mobileExpanded;
    var option = select.options[select.selectedIndex];
    var value = head.querySelector(".mobile-choice-value");
    value.textContent = option ? choiceLabel(option) : "";
    head.classList.toggle("is-set", !!select.value);
  }

  function handleChoiceClick(event) {
    var target = event.target;
    var control =
      target && target.closest
        ? target.closest(".mobile-choice-chip, .mobile-choice-head")
        : null;
    var box = control && control.closest(".mobile-choice");
    var select = box && box._mobileSelect;
    if (!select) return;
    if (control.classList.contains("mobile-choice-head")) {
      box._mobileExpanded = !box._mobileExpanded;
      syncChoiceBox(box);
      return;
    }
    var value = control.dataset.value;
    if (select.value !== value) {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    // The list view redraws its tools on change; its new select gets its
    // own choices from the catalog event.
    if (box.isConnected) syncChoiceBox(box);
  }

  function setVocabMode(mode) {
    var select = getElement("viewModeSelect");
    var viewMode = window.ViewMode;
    var appConfig = window.appConfig;
    if (!viewMode || !appConfig) return false;

    if (mode === "study") {
      viewMode.set("study");
      if (typeof appConfig.applyFilters === "function") {
        appConfig.applyFilters();
      }
      syncVocabToolbar();
      return true;
    }

    if (
      typeof viewMode.get === "function" &&
      viewMode.get() === "study" &&
      appConfig.studyMode &&
      typeof appConfig.studyMode.leaveStudyToCatalog === "function"
    ) {
      appConfig.studyMode.leaveStudyToCatalog();
    }

    if (!select) return false;
    select.value = mode;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    syncVocabToolbar();
    return true;
  }

  function switchModule(moduleName) {
    if (!moduleMeta[moduleName]) return Promise.resolve(false);
    var sameModule = currentModule() === moduleName;
    if (!sameModule && currentModule() === "lesson") {
      var lessonAudio = getTextbookModule();
      if (
        lessonAudio &&
        lessonAudio.ttsState &&
        lessonAudio.ttsState.mode &&
        typeof lessonAudio._stopTtsPlayback === "function"
      ) {
        lessonAudio._stopTtsPlayback("已切换页面");
      }
    }
    closeFilter(false);
    closeSettings(false);
    if (searchIsOpen()) closeSearch(false);
    if (planIsOpen()) closePlan();
    if (imageViewerIsOpen()) closeImageViewer(false);
    if (detailIsOpen()) closeDetail(false);
    if (chunkDetailIsOpen()) closeChunkDetail(false);
    if (sameModule) {
      scrollModuleToTop(moduleName);
      updateChrome();
      return Promise.resolve(true);
    }
    var switcher = window.ModuleSwitcher;
    if (!switcher || typeof switcher.switchTo !== "function")
      return Promise.resolve(false);
    return Promise.resolve(switcher.switchTo(moduleName)).then(function () {
      updateChrome();
      return true;
    });
  }

  // The addresses js/core/site-pages.js opens a module from (its
  // moduleAtLocation); the app root is the dashboard.
  var LOAD_ADDRESS =
    window.location.hash === "#classics" ||
    /^\/(vocabulary|grammar|textbook)(\/(index\.html)?)?$/.test(
      window.location.pathname,
    );

  function moduleAddressAtLoad() {
    return LOAD_ADDRESS && !!(window.JPLearn && window.JPLearn.sitePages);
  }

  function restoreNavigationAfterReady() {
    if (state.navigationRestoreAttempted) return;
    state.navigationRestoreAttempted = true;
    if (state.userSelectedModule) return;
    // A page loaded at a module address (a reload at /textbook/, or the
    // classics hash mobile-platform.js restores) is reopened by the web's
    // site-pages.js on the same app:ready. A second resume racing it would
    // save the half-loaded lesson over the real one.
    if (moduleAddressAtLoad()) return;
    var switcher = window.ModuleSwitcher;
    var store = window.ProgressStore;
    if (
      !switcher ||
      typeof switcher.resume !== "function" ||
      !store ||
      typeof store.getNavigation !== "function"
    )
      return;

    var saved;
    try {
      saved = store.getNavigation();
    } catch (error) {
      console.warn("[MobileShell] 无法读取移动端导航状态", error);
      return;
    }
    var target = saved && saved.lastModule;
    if (target !== "vocab" && target !== "grammar" && target !== "lesson")
      return;

    Promise.resolve(switcher.resume(saved))
      .then(function (restored) {
        if (restored && !state.userSelectedModule) {
          updateChrome();
          syncSettings();
        }
      })
      .catch(function (error) {
        console.warn("[MobileShell] 恢复移动端导航状态失败", error);
      });
  }

  function bindNavigationRestore() {
    var events = window.JPLearn && window.JPLearn.events;
    if (!events || typeof events.on !== "function") return;
    var unsubscribe = events.on("app:ready", restoreNavigationAfterReady);
    if (typeof unsubscribe === "function") state.cleanup.push(unsubscribe);
    if (window.appConfig && window.appConfig.status === "ready") {
      window.setTimeout(restoreNavigationAfterReady, 0);
    }
  }

  function topLayer() {
    if (openNativeDialog()) return "dialog";
    if (state.filterModule) return "filter";
    if (settingsIsOpen()) return "settings";
    if (searchIsOpen()) return "search";
    if (chunkDetailIsOpen()) return "chunk";
    if (imageViewerIsOpen()) return "image";
    if (detailIsOpen()) return "detail";
    if (planIsOpen()) return "plan";
    return "";
  }

  function openNativeDialog() {
    return document.querySelector("dialog[open]");
  }

  function installDialogFallbacks() {
    document.querySelectorAll("dialog").forEach(function (dialog) {
      if (
        typeof dialog.showModal === "function" &&
        typeof dialog.close === "function"
      )
        return;
      dialog.setAttribute("data-mobile-dialog-fallback", "true");
      dialog.setAttribute("role", "dialog");
      dialog.showModal = function () {
        if (dialog.hasAttribute("open")) return;
        dialog.setAttribute("open", "");
        dialog.setAttribute("aria-modal", "true");
        updateChrome();
        focusLayer("dialog");
      };
      dialog.close = function (value) {
        if (!dialog.hasAttribute("open")) return;
        if (value !== undefined) dialog.returnValue = String(value);
        dialog.removeAttribute("open");
        dialog.dispatchEvent(new Event("close"));
      };
    });
  }

  function closeNativeDialog() {
    var dialog = openNativeDialog();
    if (!dialog) return false;
    // Use each feature's close action, so its own draft/focus cleanup runs.
    var close = dialog.querySelector("#appearanceClose, #archiveClose");
    if (close) close.click();
    else dialog.close();
    return true;
  }

  function emitLayerEvent(eventName, layerName) {
    document.dispatchEvent(
      new CustomEvent("mobile:layer-" + eventName, {
        detail: { layer: layerName },
      }),
    );
  }

  // The app bar's context button: 目录 where the sheet is a table of
  // contents (reading pages, classics), 筛选 for the lists, 设置 on Today.
  // The grammar list and its reader share a module, so the head observer
  // calls this too.
  function syncContextButton(moduleName) {
    var contextButton = getElement("mobileAppContextButton");
    if (!contextButton) return;
    var icon = "filter";
    var label = "筛选";
    if (moduleName === "dashboard") {
      icon = "settings";
      label = "设置";
    } else if (moduleName === "classics" || readingSheet(moduleName)) {
      icon = "list";
      label = "目录";
    }
    if (
      contextButton.dataset.mobileIcon !== icon ||
      contextButton.getAttribute("aria-label") !== label
    ) {
      setButtonContent(contextButton, icon, label);
    }
    contextButton.setAttribute(
      "aria-pressed",
      state.filterModule ? "true" : "false",
    );
  }

  function updateChrome() {
    var moduleName = currentModule();
    state.activeModule = moduleName;
    root.dataset.mobileModule = moduleName;
    var meta = moduleMeta[moduleName];
    var title = getElement("mobileAppBarTitle");
    var subtitle = getElement("mobileAppBarSubtitle");
    var contextButton = getElement("mobileAppContextButton");
    var backButton = getElement("mobileAppBarBack");
    if (title) title.textContent = meta.label;
    if (subtitle) subtitle.textContent = contextSummary(moduleName);
    if (contextButton) syncContextButton(moduleName);
    syncClassicsNav();
    document
      .querySelectorAll("#mobileBottomNav [data-mobile-module]")
      .forEach(function (button) {
        var active = button.dataset.mobileModule === moduleName;
        button.setAttribute("aria-current", active ? "page" : "false");
      });
    var layer = topLayer();
    if (layer || state.chromeModule !== moduleName) setChromeHidden(false);
    if (state.chromeModule && state.chromeModule !== moduleName)
      fadeModuleIn(moduleName);
    state.chromeModule = moduleName;
    var nextLayer = layer || "none";
    var previousLayer = root.dataset.mobileTopLayer || "none";
    var searchContext = state.searchReturnContext;
    if (searchContext) {
      var searchPanel = getElement(searchContext.panelId);
      var ownsDetail =
        moduleName === searchContext.kind &&
        searchPanel &&
        searchPanel.classList.contains("anchored-detail-open");
      if (ownsDetail) {
        searchContext.detailOpened = true;
        if (state.searchReturnTimer) {
          window.clearTimeout(state.searchReturnTimer);
          state.searchReturnTimer = 0;
        }
      } else if (
        searchContext.detailOpened ||
        (nextLayer !== "none" && nextLayer !== "search")
      ) {
        clearSearchReturnContext();
      }
    }
    if (previousLayer !== nextLayer) {
      if (previousLayer !== "detail" && nextLayer === "detail") {
        captureDetailContext();
      }
      if (previousLayer === "detail" && nextLayer !== "detail") {
        restoreDetailContext();
      }
      if (previousLayer !== "none") emitLayerEvent("close", previousLayer);
      if (nextLayer !== "none") emitLayerEvent("open", nextLayer);
    }
    root.dataset.mobileTopLayer = nextLayer;
    document.body.classList.toggle("mobile-layer-open", !!layer);
    document.body.classList.toggle("mobile-detail-open", layer === "detail");
    // After the class above, which gives the panel its phone place.
    if (previousLayer !== "detail" && nextLayer === "detail") slideDetailIn();
    document.body.classList.toggle("mobile-search-open", layer === "search");
    document.body.classList.toggle("mobile-image-open", layer === "image");
    document.body.classList.toggle("mobile-plan-open", layer === "plan");
    document.body.classList.toggle("mobile-dialog-open", layer === "dialog");
    var chunkBackdrop = getElement("mobileChunkBackdrop");
    if (chunkBackdrop) {
      chunkBackdrop.hidden = layer !== "chunk";
      chunkBackdrop.setAttribute(
        "aria-hidden",
        layer === "chunk" ? "false" : "true",
      );
    }
    applyA11yState(layer);
    if (previousLayer !== nextLayer && nextLayer !== "none") {
      window.setTimeout(function () {
        focusLayer(nextLayer);
      }, 0);
    }
    enhanceGrammarMobile();
    enhanceLessonMobile();
    if (backButton) syncAppBarBack(layer);
    syncVocabToolbar();
    syncRunningHead();
    syncClassicsNarration();
    normalizeAccessibleNames();
  }

  // The web adds its 古典 button once the local classics library has loaded;
  // the bottom navigation offers the module from the same moment.
  function syncClassicsNav() {
    var nav = getElement("mobileBottomNav");
    var button = nav && nav.querySelector('[data-mobile-module="classics"]');
    if (!button) return;
    var offered = !!getElement("modBtnClassics");
    if (button.hidden !== !offered) button.hidden = !offered;
    nav.classList.toggle("mobile-bottom-nav--five", offered);
  }

  function handleModuleBack() {
    var moduleName = currentModule();
    if (
      moduleName === "grammar" &&
      window.grammarModule &&
      window.grammarModule.currentView === "lesson-reader"
    ) {
      var grammarBack = window.grammarModule.lessonReader;
      if (grammarBack && typeof grammarBack.onBack === "function") {
        grammarBack.onBack();
      } else if (typeof window.grammarModule._switchSubView === "function") {
        window.grammarModule._switchSubView("lesson-list");
      }
      updateChrome();
      return true;
    }
    // Back from a lesson's grammar step returns to the lesson, as 返回课文
    // does, and lets the switcher decide whether the step is complete.
    var course = moduleName === "grammar" && grammarCourseContext();
    if (
      course &&
      window.ModuleSwitcher &&
      typeof window.ModuleSwitcher.returnToTextbook === "function"
    ) {
      window.ModuleSwitcher.returnToTextbook(course);
      updateChrome();
      return true;
    }
    if (
      moduleName === "lesson" &&
      window.ModuleSwitcher &&
      typeof window.ModuleSwitcher.getTextbookModule === "function"
    ) {
      var textbook = window.ModuleSwitcher.getTextbookModule();
      if (textbook && textbook.currentLessonId) {
        return openFilter();
      }
    }
    return false;
  }

  function handleBack() {
    for (var index = externalBackHandlers.length - 1; index >= 0; index--) {
      if (externalBackHandlers[index]()) return true;
    }
    var activeElement = document.activeElement;
    var viewport = window.visualViewport;
    var keyboardLikelyOpen =
      viewport && window.innerHeight - viewport.height > 80;
    if (
      activeElement &&
      /^(INPUT|TEXTAREA|SELECT)$/.test(activeElement.tagName) &&
      keyboardLikelyOpen
    ) {
      activeElement.blur();
      return true;
    }
    if (closeNativeDialog()) return true;
    if (closeKanaDetail()) return true;
    var outline = document.querySelector(".tb-reader--book .tb-outline[open]");
    if (outline) {
      outline.open = false;
      return true;
    }
    if (state.filterSubpage) {
      closeFilterSubpage(true);
      return true;
    }
    if (settingsDataIsOpen()) {
      closeSettingsData(true);
      return true;
    }
    var layer = topLayer();
    if (layer === "filter") {
      closeFilter(true);
      return true;
    }
    if (layer === "settings") {
      closeSettings(true);
      return true;
    }
    if (layer === "search") {
      closeSearch(true);
      return true;
    }
    if (layer === "chunk") {
      closeChunkDetail(true);
      return true;
    }
    if (layer === "plan") {
      closePlan();
      return true;
    }
    if (layer === "image") {
      closeImageViewer(true);
      return true;
    }
    if (layer === "detail") {
      if (state.detailLeaving) return true;
      var searchContext = state.searchReturnContext;
      clearSearchReturnContext();
      slideDetailOut(function () {
        closeDetail(!!searchContext ? false : true);
        if (searchContext) restoreSearchReturnContext(searchContext);
      });
      return true;
    }
    return handleModuleBack();
  }

  function bindNativeBack() {
    var capacitor = window.Capacitor;
    var app = capacitor && capacitor.Plugins && capacitor.Plugins.App;
    if (!app || typeof app.addListener !== "function") return;
    var listener = app.addListener("backButton", function () {
      if (!handleBack() && typeof app.exitApp === "function") app.exitApp();
    });
    state.nativeBackListener = listener;
    if (listener && typeof listener.remove === "function") {
      state.cleanup.push(function () {
        listener.remove();
      });
    }
  }

  // The filter sheet follows a downward drag on its header and closes when
  // released far or fast enough, like a native bottom sheet.
  function bindFilterSheetSwipe() {
    var sheet = getElement("mobileFilterSheet");
    var backdrop = getElement("mobileFilterBackdrop");
    if (!sheet) return;
    var drag = null;
    function reset() {
      sheet.style.transition = "";
      sheet.style.transform = "";
      if (backdrop) backdrop.style.opacity = "";
    }
    addListener(
      sheet,
      "touchstart",
      function (event) {
        drag = null;
        if (event.touches.length !== 1 || state.filterSubpage) return;
        var header = sheet.querySelector(".mobile-sheet-header");
        var touch = event.touches[0];
        if (!header || touch.clientY > header.getBoundingClientRect().bottom)
          return;
        drag = {
          startY: touch.clientY,
          lastY: touch.clientY,
          lastTime: event.timeStamp,
          velocity: 0,
          moved: false,
          height: sheet.getBoundingClientRect().height || 1,
        };
      },
      { passive: true },
    );
    addListener(
      sheet,
      "touchmove",
      function (event) {
        if (!drag || event.touches.length !== 1) return;
        var y = event.touches[0].clientY;
        var offset = Math.max(0, y - drag.startY);
        if (!drag.moved && offset < 8) return;
        drag.moved = true;
        var elapsed = Math.max(1, event.timeStamp - drag.lastTime);
        drag.velocity = (y - drag.lastY) / elapsed;
        drag.lastY = y;
        drag.lastTime = event.timeStamp;
        sheet.style.transition = "none";
        sheet.style.transform = "translateY(" + offset + "px)";
        if (backdrop)
          backdrop.style.opacity = String(
            Math.max(0, 1 - offset / drag.height),
          );
        if (event.cancelable) event.preventDefault();
      },
      { passive: false },
    );
    function finish() {
      var current = drag;
      drag = null;
      if (!current || !current.moved) return;
      var offset = Math.max(0, current.lastY - current.startY);
      var dismiss =
        offset > Math.min(140, current.height * 0.3) ||
        (current.velocity > 0.5 && offset > 24);
      sheet.style.transition = "transform 160ms ease-out";
      if (!dismiss) {
        sheet.style.transform = "";
        if (backdrop) backdrop.style.opacity = "";
        window.setTimeout(reset, 180);
        return;
      }
      sheet.style.transform = "translateY(100%)";
      if (backdrop) backdrop.style.opacity = "0";
      window.setTimeout(function () {
        closeFilter(true);
        reset();
      }, 160);
    }
    addListener(sheet, "touchend", finish, { passive: true });
    addListener(
      sheet,
      "touchcancel",
      function () {
        drag = null;
        reset();
      },
      { passive: true },
    );
  }

  // Reading room: the app bar and bottom navigation slide away while the
  // learner scrolls down by touch, and return on any upward scroll, at the
  // top of the page, on a module change or when a layer opens. Scrolls the
  // app makes itself (section jumps, restored positions) never hide them.
  var CHROME_HIDE_TRAVEL = 24;
  var CHROME_SHOW_TRAVEL = 12;
  var CHROME_TOP_ZONE = 8;
  // Pages that barely scroll would fit once the bars leave, snap back to the
  // top and bring them back again; keep the bars on such pages.
  var CHROME_MIN_RANGE = 240;
  // A fling keeps scrolling after the finger lifts.
  var CHROME_TOUCH_WINDOW_MS = 1500;
  // The bars' own slide resizes the scrollers; scroll clamps caused by that
  // resize are not the learner's.
  var CHROME_SETTLE_MS = 320;

  function setChromeHidden(hidden) {
    hidden = !!hidden;
    if (state.chromeHidden === hidden) return;
    state.chromeHidden = hidden;
    state.chromeTravel = 0;
    state.chromeSettleUntil = Date.now() + CHROME_SETTLE_MS;
    root.dataset.mobileChrome = hidden ? "hidden" : "visible";
  }

  function bindChromeAutoHide() {
    var touching = false;
    var lastTouch = 0;
    var positions = new WeakMap();
    root.dataset.mobileChrome = "visible";
    function markTouch() {
      lastTouch = Date.now();
    }
    addListener(
      document,
      "touchstart",
      function () {
        touching = true;
        markTouch();
      },
      { capture: true, passive: true },
    );
    addListener(document, "touchmove", markTouch, {
      capture: true,
      passive: true,
    });
    ["touchend", "touchcancel"].forEach(function (type) {
      addListener(
        document,
        type,
        function () {
          touching = false;
          markTouch();
        },
        { capture: true, passive: true },
      );
    });
    addListener(document, "wheel", markTouch, { capture: true, passive: true });
    addListener(
      document,
      "scroll",
      function (event) {
        var scroller = event.target;
        if (!scroller || scroller.nodeType !== 1) return;
        var container = document.querySelector(".app-container");
        if (!container || !container.contains(scroller)) return;
        var top = scroller.scrollTop;
        var previous = positions.has(scroller) ? positions.get(scroller) : top;
        positions.set(scroller, top);
        var delta = top - previous;
        if (!delta) return;
        if (Date.now() < state.chromeSettleUntil) return;
        if (top <= CHROME_TOP_ZONE) {
          setChromeHidden(false);
          return;
        }
        if (topLayer()) return;
        if (!touching && Date.now() - lastTouch > CHROME_TOUCH_WINDOW_MS)
          return;
        if (delta > 0 !== state.chromeTravel > 0) state.chromeTravel = 0;
        state.chromeTravel += delta;
        if (
          !state.chromeHidden &&
          state.chromeTravel > CHROME_HIDE_TRAVEL &&
          scroller.scrollHeight - scroller.clientHeight > CHROME_MIN_RANGE
        ) {
          setChromeHidden(true);
        } else if (
          state.chromeHidden &&
          state.chromeTravel < -CHROME_SHOW_TRAVEL
        ) {
          setChromeHidden(false);
        }
      },
      { capture: true, passive: true },
    );
    // Keyboard and screen-reader focus brings the bars back into view.
    ["mobileAppBar", "mobileBottomNav"].forEach(function (id) {
      addListener(getElement(id), "focusin", function () {
        setChromeHidden(false);
      });
    });
  }

  // Vocabulary list on a phone: the kana reading beside the headword, the
  // part of speech in front of the gloss, checkboxes only in an explicit
  // selection mode, and a one-line pager that starts each page at the top.
  // The web list keeps rendering the table and owning its events; each
  // render is decorated afterwards.
  var KANA_ONLY = /^[぀-ヿー・\s]+$/;

  function vocabListView() {
    return (window.appConfig && window.appConfig.listView) || null;
  }

  function listSelecting() {
    var container = getElement("list-container");
    return !!container && container.dataset.mobileSelect === "on";
  }

  function pageWordsByIndex(list) {
    var map = {};
    var size = list.pageSize || 0;
    var start = Math.max(0, ((list.currentPage || 1) - 1) * size);
    (list.words || []).slice(start, start + size).forEach(function (word) {
      map[word.index] = word;
    });
    return map;
  }

  function syncListSelection() {
    var container = getElement("list-container");
    if (!container) return;
    var rows = Array.from(container.querySelectorAll("tr.list-row"));
    var checked = 0;
    rows.forEach(function (row) {
      var box = row.querySelector(".row-check");
      var on = !!(box && box.checked);
      if (on) checked += 1;
      row.classList.toggle("mobile-row-checked", on);
    });
    var all = container.querySelector('[data-mobile-list-select="all"]');
    if (all) {
      var everything = rows.length > 0 && checked === rows.length;
      all.textContent = everything ? "取消全选" : "全选本页";
      all.setAttribute("aria-pressed", everything ? "true" : "false");
      all.disabled = rows.length === 0;
    }
  }

  function decorateVocabList() {
    var container = getElement("list-container");
    var list = vocabListView();
    if (!container || !list) return;
    var selecting = listSelecting();
    var words = pageWordsByIndex(list);
    container.querySelectorAll("tr.list-row").forEach(function (row) {
      if (row.dataset.mobileDecorated === "true") return;
      row.dataset.mobileDecorated = "true";
      var word = words[Number(row.getAttribute("data-word-index"))];
      var cell = row.querySelector("td.col-word");
      if (cell) cell.setAttribute("lang", "ja");
      var reading = word && word.reading_hiragana;
      if (
        cell &&
        reading &&
        word.word &&
        reading !== word.word &&
        !KANA_ONLY.test(word.word)
      ) {
        var span = document.createElement("span");
        span.className = "mobile-list-reading";
        span.textContent = reading;
        var headword = cell.querySelector("strong");
        if (headword) headword.insertAdjacentElement("afterend", span);
        else cell.appendChild(span);
      }
      var pos = row.querySelector("td.col-pos");
      if (pos) {
        var label = pos.textContent.trim();
        pos.classList.toggle("is-empty", !label || label === "-");
      }
    });

    var bar = container.querySelector(".list-batch-bar");
    if (bar && !bar.querySelector('[data-mobile-list-select="toggle"]')) {
      var toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "btn-ghost mobile-list-select-toggle";
      toggle.setAttribute("data-mobile-list-select", "toggle");
      bar.insertBefore(toggle, bar.firstChild);
      var all = document.createElement("button");
      all.type = "button";
      all.className = "btn-ghost mobile-list-select-all";
      all.setAttribute("data-mobile-list-select", "all");
      var count = bar.querySelector("#listSelectedCount");
      bar.insertBefore(all, count ? count.nextSibling : null);
    }
    var selectToggle =
      bar && bar.querySelector('[data-mobile-list-select="toggle"]');
    if (selectToggle) {
      selectToggle.textContent = selecting ? "完成" : "选择";
      selectToggle.setAttribute("aria-pressed", selecting ? "true" : "false");
      selectToggle.setAttribute(
        "aria-label",
        selecting ? "完成选择" : "选择词条",
      );
    }

    var pager = container.querySelector(".pagination");
    if (pager && !pager.querySelector(".mobile-page-status")) {
      var status = document.createElement("span");
      status.className = "mobile-page-status";
      status.textContent =
        "第 " +
        (list.currentPage || 1) +
        " / " +
        (list.totalPages || 1) +
        " 页";
      pager.insertBefore(status, pager.querySelector("#pageNext"));
    }
    syncListSelection();
  }

  function setListSelecting(on) {
    var container = getElement("list-container");
    var list = vocabListView();
    if (!container) return;
    if (on) {
      container.dataset.mobileSelect = "on";
      decorateVocabList();
      return;
    }
    delete container.dataset.mobileSelect;
    // Leaving selection drops it, as in other phone lists.
    if (list && list.selectedIndices && list.selectedIndices.size) {
      list.selectedIndices.clear();
      if (typeof list.render === "function") {
        list.render();
        return;
      }
    }
    decorateVocabList();
  }

  function bindVocabList() {
    var events = window.JPLearn && window.JPLearn.events;
    if (events && typeof events.on === "function") {
      var off = events.on("vocab:catalog-rendered", function (payload) {
        if (payload && payload.view === "list") decorateVocabList();
        decorateVocabChoices();
        // 清除筛选 and global search change the catalog without the filter
        // sheet, so the app bar count is refreshed here as well.
        var subtitle = getElement("mobileAppBarSubtitle");
        if (subtitle && currentModule() === "vocab") {
          subtitle.textContent = contextSummary("vocab");
        }
      });
      if (typeof off === "function") state.cleanup.push(off);
    }
    addListener(
      document,
      "click",
      function (event) {
        var target = event.target;
        if (!target || !target.closest) return;
        var control = target.closest(
          "#list-container [data-mobile-list-select]",
        );
        if (control) {
          event.preventDefault();
          var action = control.getAttribute("data-mobile-list-select");
          if (action === "toggle") {
            setListSelecting(!listSelecting());
          } else if (action === "all") {
            var checkAll = getElement("checkAll");
            if (checkAll) {
              checkAll.checked =
                control.getAttribute("aria-pressed") !== "true";
              checkAll.dispatchEvent(new Event("change", { bubbles: true }));
            }
            syncListSelection();
          }
          return;
        }
        var pageButton = target.closest(
          "#list-container #pagePrev, #list-container #pageNext, #list-container .btn-page-num",
        );
        if (pageButton && !pageButton.classList.contains("disabled")) {
          // The web pager keeps the old scroll offset; a new page starts at
          // its first word.
          window.setTimeout(function () {
            var container = getElement("list-container");
            if (container) container.scrollTop = 0;
          }, 0);
          return;
        }
        if (target.closest("#list-container #btnBatchStudy")) {
          // The study session is built from the selection on this click.
          window.setTimeout(function () {
            setListSelecting(false);
          }, 0);
          return;
        }
        if (!listSelecting()) return;
        var row = target.closest("#list-container tr.list-row");
        if (
          !row ||
          target.closest(".list-fav-btn, .row-check, .btn-local-graph")
        )
          return;
        // While selecting, a tap ticks the row instead of opening it.
        event.preventDefault();
        event.stopPropagation();
        var box = row.querySelector(".row-check");
        if (box) box.click();
      },
      true,
    );
    addListener(document, "change", function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      if (target.closest("#list-container")) syncListSelection();
      if (target.id === "pageSizeSelect") {
        var container = getElement("list-container");
        if (container) container.scrollTop = 0;
      }
    });
    decorateVocabList();
  }

  // Dialogs opened from the settings sheet are its sub-pages on a phone:
  // closing one returns to the sheet instead of dropping to the page.
  function bindSettingsDialogReturn() {
    addListener(
      document,
      "click",
      function (event) {
        var opener =
          event.target &&
          event.target.closest &&
          event.target.closest("#appAppearanceOpen");
        var dialog = getElement("appearanceDialog");
        if (!opener || !dialog || !settingsIsOpen()) return;
        dialog.addEventListener(
          "close",
          function () {
            window.setTimeout(function () {
              if (state.initialized && !topLayer() && !settingsIsOpen())
                toggleSettings();
            }, 0);
          },
          { once: true },
        );
      },
      true,
    );
  }

  function bindEvents() {
    // WebView 83 has no :focus-visible, so it rings whatever script focuses
    // after a tap. Note how the reader last moved: the CSS drops the ring
    // after a tap and keeps it for Tab, or for arrow keys outside a field
    // (inside one they move the caret).
    root.dataset.mobileInput = "touch";
    addListener(
      window,
      "pointerdown",
      function () {
        root.dataset.mobileInput = "touch";
      },
      true,
    );
    addListener(
      window,
      "keydown",
      function (event) {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        var target = event.target || {};
        if (
          event.key === "Tab" ||
          (/^(Arrow|Page)|^(Home|End)$/.test(event.key) &&
            !/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) &&
            !target.isContentEditable)
        )
          root.dataset.mobileInput = "keyboard";
      },
      true,
    );
    // The app-bar Back is part of the mobile detail surface. Keep the shared
    // desktop outside-pointer/focus handlers from closing that detail before
    // this button's click can consume its return destination.
    addListener(
      window,
      "pointerdown",
      function (event) {
        var back =
          event.target.closest && event.target.closest("#mobileAppBarBack");
        if (!back || !detailIsOpen()) return;
        event.preventDefault();
        event.stopPropagation();
      },
      true,
    );
    addListener(
      window,
      "focusin",
      function (event) {
        if (event.target !== getElement("mobileAppBarBack") || !detailIsOpen())
          return;
        event.stopPropagation();
      },
      true,
    );
    addListener(
      window,
      "keydown",
      function (event) {
        if (event.key !== "Escape" || !topLayer()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        handleBack();
      },
      true,
    );
    // The native data page sits beside appSettingsPanel. Its controls still
    // belong to settings, so the web document outside-click handler must not
    // dismiss a failed-save message or the retry action.
    addListener(getElement("mobileSettingsSheet"), "click", function (event) {
      event.stopPropagation();
    });
    document.querySelectorAll("dialog").forEach(function (dialog) {
      addListener(dialog, "close", function () {
        updateChrome();
        window.setTimeout(function () {
          var toggle = getElement("appSettingsToggle");
          if (
            document.activeElement === toggle ||
            document.activeElement === document.body
          ) {
            var target = getElement("mobileAppContextButton");
            if (target) target.focus({ preventScroll: true });
          }
        }, 0);
      });
    });
    var shell = getElement("mobileAppShell");
    function commitLessonCardNavigation(event) {
      var target = event && event.target;
      if (state.filterModule === "classics") {
        // Choosing a work or one of its parts opens it: show the reader.
        var classicsChoice =
          target && target.closest
            ? target.closest("[data-cl-work], .cl-part-card")
            : null;
        if (!classicsChoice) return false;
        window.setTimeout(function () {
          if (state.filterModule === "classics") {
            closeFilter(true, { apply: true });
          }
        }, 0);
        return true;
      }
      var lessonCard =
        target && target.closest ? target.closest(".tb-lesson-card") : null;
      if (!lessonCard || state.filterModule !== "lesson") return false;
      // A lesson card is navigation, not a reversible filter value. Let the
      // textbook module start loading it, then reveal the selected lesson.
      window.setTimeout(function () {
        if (state.filterModule === "lesson") {
          closeFilter(true, { apply: true });
        }
      }, 0);
      return true;
    }
    // Tapping a word opens its entry and reads it aloud: on a phone the tap is
    // the only gesture, so the web card's separate play action is folded in.
    addListener(document, "click", function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      var cardBody = target.closest("#vocabMain .cc-card-body[data-detail]");
      if (cardBody) {
        var control = target.closest("button, a, input");
        if (control && cardBody.contains(control)) return;
        var wordIndex = parseInt(cardBody.getAttribute("data-detail"), 10);
        if (!isNaN(wordIndex) && window.VocabTTS && window.VocabTTS.playOne) {
          window.VocabTTS.playOne(wordIndex, function () {});
        }
        return;
      }
      var lessonWord = target.closest(
        "#textbookMain [data-vocab-detail-index]",
      );
      var textbook = lessonWord && getTextbookModule();
      if (!textbook || !textbook._handleTtsButtonClick) return;
      var row = (textbook.currentVocab || [])[
        parseInt(lessonWord.getAttribute("data-vocab-detail-index"), 10)
      ];
      var audioIndex = parseInt(row && row.index, 10);
      if (!isNaN(audioIndex)) {
        textbook._handleTtsButtonClick("vocab:" + audioIndex);
      }
    });
    // ART-20: a scene note shows two lines on a phone page; a tap (or Enter
    // or Space) opens the rest, and a second tap folds it again.
    var toggleSceneNote = function (event) {
      var note =
        readerPage() && event.target && event.target.closest
          ? event.target.closest("#textbookMain .book-body .tb-scene-note")
          : null;
      if (!note || !note.hasAttribute("aria-expanded")) return;
      if (event.type === "keydown") {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
      }
      var open = note.getAttribute("aria-expanded") !== "true";
      note.setAttribute("aria-expanded", open ? "true" : "false");
      var frame = note.closest(".book-frame");
      if (frame && frame._mobilePager) frame._mobilePager.refresh();
    };
    addListener(document, "click", toggleSceneNote);
    addListener(document, "keydown", toggleSceneNote);
    // DF-22: a kana or example word opens its chart's detail card (the web
    // has just filled it); a tap anywhere else closes the card. The card
    // floats above the footer, or under the app bar when it would cover the
    // tapped row.
    addListener(document, "click", function (event) {
      if (!readerPage()) return;
      var target = event.target;
      var button =
        target && target.closest
          ? target.closest("#textbookMain .tb-section-kana [data-kana-clip]")
          : null;
      var detail =
        button &&
        button.closest(".tb-section-kana").querySelector(".tb-kana-detail");
      if (target && target.closest && target.closest(".tb-kana-detail")) return;
      if (openKanaDetail() !== detail) closeKanaDetail();
      if (!detail) return;
      detail.setAttribute("data-mobile-kana-open", "");
      var covered =
        button.getBoundingClientRect().bottom >
        detail.getBoundingClientRect().top - 8;
      detail.setAttribute("data-mobile-kana-open", covered ? "top" : "");
    });
    // DF-03: the grammar heading opens and closes the section under it.
    var toggleGrammarSection = function (event) {
      var head =
        readerPage() && event.target && event.target.closest
          ? event.target.closest(
              "#textbookMain .book-body .tb-section-grammar > .tb-section-head[aria-expanded]",
            )
          : null;
      // A control inside the heading (a read-aloud button) keeps its own.
      if (!head || event.target.closest("button, a")) return;
      if (event.type === "keydown") {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
      }
      var open = head.getAttribute("aria-expanded") !== "true";
      head.setAttribute("aria-expanded", open ? "true" : "false");
      refoldBook(head);
    };
    addListener(document, "click", toggleGrammarSection);
    addListener(document, "keydown", toggleGrammarSection);
    // DF-04: 更多例句 opens the folded examples, 收起例句 folds them again.
    addListener(document, "click", function (event) {
      var toggle =
        event.target && event.target.closest
          ? event.target.closest(".mobile-more-examples")
          : null;
      if (!toggle || !toggle._mobileRows) return;
      var open = toggle.getAttribute("aria-expanded") !== "true";
      setExamplesOpen(toggle, open);
      if (toggle.closest(".book-frame")) {
        refoldBook(toggle);
        return;
      }
      // A grammar point scrolls: folding the list under the reader keeps
      // the toggle on screen.
      var content = toggle.closest(".detail-content");
      var place = toggle.getBoundingClientRect();
      var view = content && content.getBoundingClientRect();
      if (view && !open && (place.top < view.top || place.bottom > view.bottom))
        content.scrollTop += place.top - view.top - content.clientHeight / 2;
    });
    // DF-09: the grammar point's tabs follow its scrolling.
    addListener(
      document,
      "scroll",
      function (event) {
        var content = event.target;
        if (
          state.grammarTabFrame ||
          !content ||
          content.id !== "gmDetailContent"
        )
          return;
        state.grammarTabFrame = window.requestAnimationFrame(function () {
          state.grammarTabFrame = 0;
          syncGrammarTab(content);
        });
      },
      true,
    );
    addListener(getElement("mobileAppBarBack"), "click", function () {
      handleBack();
    });
    // A grammar point's section tabs and 开始练习 scroll a section in
    // smoothly and then focus its heading, which cuts the scroll short and
    // leaves the heading mid-page with the section before it above. Once the
    // web has done both, set the section just under the tab bar.
    addListener(document, "click", function (event) {
      var target = event.target;
      var jump =
        readerPage() && target && target.closest
          ? target.closest(
              "#grammarDetailPanel .gm-detail-nav-btn, #gmStartPractice",
            )
          : null;
      var section =
        jump &&
        getElement(
          jump.getAttribute("data-section-target") || "gm-section-practice",
        );
      var content = section && section.closest(".detail-content");
      var tabs = content && content.querySelector(".gm-detail-outline");
      if (!tabs) return;
      // The bar sticks to the top once the heading above it scrolls away.
      content.scrollTop = Math.round(
        content.scrollTop +
          section.getBoundingClientRect().top -
          content.getBoundingClientRect().top -
          tabs.offsetHeight,
      );
    });
    addListener(
      document,
      "click",
      function (event) {
        var summary =
          event.target && event.target.closest
            ? event.target.closest(".gm-detail-section > summary")
            : null;
        if (summary && summary.closest("[data-mobile-anchors]")) {
          event.preventDefault();
        }
      },
      true,
    );
    addListener(getElement("mobileDetailFavorite"), "click", function (event) {
      var source = event.currentTarget._mobileSource;
      if (source && source.isConnected) source.click();
      syncDetailFavorite();
    });
    addListener(getElement("mobileAppSearchButton"), "click", function () {
      state.previousFocus = document.activeElement;
      toggleSearch();
      updateChrome();
    });
    addListener(getElement("mobileAppContextButton"), "click", function () {
      state.previousFocus = document.activeElement;
      openContext();
      updateChrome();
    });
    document
      .querySelectorAll("#mobileVocabModeButtons [data-mobile-vocab-mode]")
      .forEach(function (button) {
        addListener(button, "click", function () {
          setVocabMode(button.dataset.mobileVocabMode);
        });
      });
    addListener(getElement("viewModeSelect"), "change", syncVocabToolbar);
    addListener(getElement("mobileVocabReadPage"), "click", function () {
      var readPage = getElement("ccReadPage");
      if (readPage) readPage.click();
      window.setTimeout(syncVocabReadPageButton, 0);
    });
    addListener(getElement("mobileSheetCurrent"), "click", function (event) {
      var target = event.target;
      var proxy =
        target && target.closest
          ? target.closest(".mobile-sheet-action, .mobile-sheet-outline-link")
          : null;
      if (!proxy) return;
      // The sheet's own delegation must not treat a proxy as a filter edit.
      event.stopPropagation();
      runSheetProxy(proxy);
    });
    addListener(getElement("mobileFilterClose"), "click", function () {
      closeFilter(true);
    });
    addListener(getElement("mobileFilterBackdrop"), "click", function () {
      closeFilter(true);
    });
    addListener(getElement("mobileChunkBackdrop"), "click", function () {
      closeChunkDetail(true);
    });
    addListener(getElement("mobileFilterSubpageBack"), "click", function () {
      closeFilterSubpage(true);
    });
    addListener(
      getElement("mobileFilterSubpageContent"),
      "click",
      function (event) {
        var context = state.filterSubpage;
        var delegatedParent = context && context.parent;
        if (delegatedParent && typeof delegatedParent.onclick === "function") {
          // Moving a <details> into the subpage removes it from its original
          // delegated-click ancestor. Forward the click so textbook course,
          // display-mode, and lesson controls retain their normal behavior.
          delegatedParent.onclick.call(delegatedParent, event);
        }
        commitLessonCardNavigation(event);
      },
    );
    addListener(getElement("mobileFilterContent"), "click", function (event) {
      if (commitLessonCardNavigation(event)) return;
      window.setTimeout(updateChrome, 0);
      var target = event.target;
      var summary = target && target.closest ? target.closest("summary") : null;
      var detail =
        summary && summary.closest ? summary.closest("details") : null;
      if (detail && isRootFilterDetail(detail)) {
        event.preventDefault();
        event.stopPropagation();
        openFilterSubpage(detail);
      }
    });
    addListener(getElement("mobileFilterContent"), "click", handleChoiceClick);
    addListener(getElement("mobileFilterContent"), "input", function () {
      window.setTimeout(updateChrome, 0);
      // Vocabulary text filtering uses a short debounce. Refresh the sheet
      // summary once more after the filtered collection has been rebuilt.
      window.setTimeout(updateChrome, 400);
    });
    addListener(getElement("mobileFilterContent"), "change", function () {
      window.setTimeout(updateChrome, 0);
    });
    addListener(getElement("mobileSettingsClose"), "click", function () {
      closeSettings(true);
    });
    addListener(getElement("mobileSettingsDataButton"), "click", function () {
      openSettingsData();
    });
    addListener(getElement("mobileSettingsDataBack"), "click", function () {
      closeSettingsData(true);
    });
    addListener(getElement("mobileImageViewerClose"), "click", function () {
      closeImageViewer(true);
    });
    addListener(getElement("mobileImageViewerBackdrop"), "click", function () {
      closeImageViewer(true);
    });
    addListener(getElement("textbookMain"), "click", function (event) {
      var target = event.target;
      var image =
        target && target.closest
          ? target.closest(".tb-section-image, .tb-book-cover img")
          : null;
      if (!image) return;
      event.preventDefault();
      openImageViewer(image);
    });
    addListener(getElement("textbookMain"), "keydown", function (event) {
      var target = event.target;
      var image =
        target && target.closest
          ? target.closest(".tb-section-image, .tb-book-cover img")
          : null;
      if (!image || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      openImageViewer(image);
    });
    document
      .querySelectorAll("#mobileBottomNav [data-mobile-module]")
      .forEach(function (button) {
        addListener(button, "click", function () {
          state.userSelectedModule = true;
          clearSearchReturnContext();
          switchModule(button.dataset.mobileModule);
        });
      });
    addListener(
      getElement("globalSearchResults"),
      "click",
      function (event) {
        var target = event.target;
        var result =
          target && target.closest
            ? target.closest("[data-search-index]")
            : null;
        if (result) captureSearchReturnContext(result);
      },
      { capture: true },
    );
    addListener(
      document,
      "keydown",
      function (event) {
        if (
          event.key !== "Enter" ||
          event.target !== getElement("globalSearchInput") ||
          !searchIsOpen()
        )
          return;
        var input = getElement("globalSearchInput");
        var result = input && input.getAttribute("aria-activedescendant");
        var button = result
          ? getElement(result)
          : document.querySelector("#globalSearchResults [data-search-index]");
        if (button) captureSearchReturnContext(button);
      },
      { capture: true },
    );
    addListener(
      document,
      "keydown",
      function (event) {
        if (event.key === "Tab" && topLayer()) {
          trapLayerFocus(event);
          return;
        }
        if (event.key === "Escape" && topLayer()) {
          event.preventDefault();
          event.stopImmediatePropagation();
          handleBack();
        }
      },
      { capture: true },
    );
    addListener(window, "backbutton", function (event) {
      if (handleBack() && event) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
    addListener(window, "resize", updateViewportMarkers, { passive: true });
    addListener(window, "orientationchange", updateViewportMarkers, {
      passive: true,
    });
    addListener(window, "app:layout-viewport-change", updateViewportMarkers);
    var syncAudioLifecycle = function () {
      window.setTimeout(syncMobileLessonAudio, 0);
    };
    addListener(document, "visibilitychange", syncAudioLifecycle);
    addListener(window, "blur", syncAudioLifecycle);
    addListener(window, "focus", syncAudioLifecycle);
    addListener(window, "pagehide", syncAudioLifecycle);
    addListener(window, "pageshow", syncAudioLifecycle);
    addListener(document, "click", function () {
      window.setTimeout(syncSettings, 0);
    });
    if (shell) {
      addListener(shell, "click", function (event) {
        event.stopPropagation();
      });
    }
    bindNavigationRestore();
    bindNativeBack();
  }

  function bindObservers() {
    // Lazy module initialization can remount the desktop sidebar after a fast
    // tap has already opened this sheet. Keep the active tools in their owner.
    var sidebarHost = getElement("unifiedModuleSidebarHost");
    if (window.MutationObserver && sidebarHost) {
      var sidebarObserver = new MutationObserver(function () {
        var content = getElement("mobileFilterContent");
        if (
          state.filterModule === currentModule() &&
          state.filterSidebar &&
          content &&
          state.filterSidebar.parentElement !== content
        ) {
          content.appendChild(state.filterSidebar);
        }
      });
      sidebarObserver.observe(sidebarHost, { childList: true });
      addObserver(sidebarObserver);
    }
    var moduleSwitcher = getElement("moduleSwitcher");
    if (window.MutationObserver && moduleSwitcher) {
      var moduleObserver = new MutationObserver(function () {
        if (state.filterModule && state.filterModule !== currentModule())
          closeFilter(false);
        updateChrome();
      });
      // childList: the web inserts its 古典 button once the library loads.
      moduleObserver.observe(moduleSwitcher, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["aria-current", "class"],
      });
      addObserver(moduleObserver);
    }
    if (window.MutationObserver) {
      var layerObserver = new MutationObserver(function () {
        syncSettings();
        updateChrome();
      });
      [
        getElement("appSettingsPanel"),
        getElement("globalSearchOverlay"),
        getElement("detailPanel"),
        getElement("grammarDetailPanel"),
        getElement("textbookDetailPanel"),
      ].forEach(function (node) {
        if (node) {
          layerObserver.observe(node, {
            attributes: true,
            attributeFilter: ["hidden", "aria-hidden", "class"],
          });
        }
      });
      addObserver(layerObserver);
      var dialogObserver = new MutationObserver(updateChrome);
      var watchDialog = function (dialog) {
        dialogObserver.observe(dialog, {
          attributes: true,
          attributeFilter: ["open"],
        });
      };
      document.querySelectorAll("dialog").forEach(watchDialog);
      addObserver(dialogObserver);
      // Sheets created on demand (export, About) join the same watch.
      var dialogHostObserver = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          mutation.addedNodes.forEach(function (node) {
            if (node.tagName !== "DIALOG") return;
            watchDialog(node);
            // Opened in the same task that added it, before this watch.
            if (node.open) updateChrome();
          });
        });
      });
      dialogHostObserver.observe(document.body, { childList: true });
      addObserver(dialogHostObserver);
    }
    var classicsStatus = getElement("classicsStatusGroup");
    if (window.MutationObserver && classicsStatus) {
      // The app bar names the open work and part.
      var classicsObserver = new MutationObserver(function () {
        if (currentModule() === "classics") updateChrome();
      });
      classicsObserver.observe(classicsStatus, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      addObserver(classicsObserver);
    }
    if (window.MutationObserver) {
      // The running head follows the folded headings: lesson and part
      // changes, filters and grammar views re-render them in place.
      state.headObserver = new MutationObserver(function () {
        if (state.runningHeadTimer) return;
        state.runningHeadTimer = window.setTimeout(function () {
          state.runningHeadTimer = 0;
          syncRunningHead();
          syncClassicsNarration();
          syncContextButton(currentModule());
          refreshSheetCurrent();
          syncAppBarBack(topLayer());
        }, 0);
      });
      state.headWatched = new WeakSet();
      addObserver(state.headObserver);
      watchRunningHeads();
    }
    var searchResults = getElement("globalSearchResults");
    if (window.MutationObserver && searchResults) {
      var searchObserver = new MutationObserver(function () {
        syncMobileSearchGroups();
      });
      searchObserver.observe(searchResults, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      addObserver(searchObserver);
    }
    var dashboardMain = getElement("dashboardMain");
    if (window.MutationObserver && dashboardMain) {
      var dashboardObserver = new MutationObserver(function () {
        window.setTimeout(updateChrome, 0);
      });
      dashboardObserver.observe(dashboardMain, {
        childList: true,
      });
      addObserver(dashboardObserver);
    }
    var textbookMain = getElement("textbookMain");
    if (window.MutationObserver && textbookMain) {
      var lessonObserver = new MutationObserver(function (mutations) {
        var reader = getElement("tbReader");
        if (
          reader &&
          mutations.some(function (mutation) {
            return mutation.type === "childList" && mutation.target === reader;
          })
        ) {
          state.lessonObserverRefresh = true;
        }
        if (state.lessonObserverTimer) return;
        state.lessonObserverTimer = window.setTimeout(function () {
          state.lessonObserverTimer = 0;
          var shouldRefresh = state.lessonObserverRefresh;
          state.lessonObserverRefresh = false;
          enhanceLessonMobile();
          if (shouldRefresh) updateChrome();
        }, 50);
      });
      lessonObserver.observe(textbookMain, {
        childList: true,
        subtree: true,
      });
      addObserver(lessonObserver);
    }
    if (window.MutationObserver && document.body) {
      var chunkObserver = new MutationObserver(function (mutations) {
        var relevant = mutations.some(function (mutation) {
          if (mutation.type === "attributes") {
            var target = mutation.target;
            return !!(
              target &&
              (target.id === "tbChunkDetail" ||
                (target.closest && target.closest("#tbChunkDetail")))
            );
          }
          return Array.from(mutation.addedNodes || []).some(function (node) {
            return !!(
              node &&
              node.nodeType === 1 &&
              (node.id === "tbChunkDetail" ||
                (node.querySelector && node.querySelector("#tbChunkDetail")))
            );
          });
        });
        if (relevant) window.setTimeout(updateChrome, 0);
      });
      chunkObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ["hidden"],
        childList: true,
        subtree: true,
      });
      addObserver(chunkObserver);
    }
  }

  function init() {
    if (state.initialized) return window.KotobaFlowMobileShell;
    root.dataset.mobileShell = "initializing";
    root.dataset.mobileNative = "true";
    if (!validateAnchors()) return window.KotobaFlowMobileShell;
    ensureScaffold();
    installDialogFallbacks();
    routePanelTools();
    routeBookPagers();
    var topLayer = window.JPLearn && window.JPLearn.topLayer;
    if (topLayer && typeof topLayer.register === "function") {
      topLayer.register("mobile-filter", {
        close: function (restoreFocus) {
          closeFilter(restoreFocus !== false);
        },
      });
      topLayer.register("mobile-image", {
        close: function (restoreFocus) {
          closeImageViewer(restoreFocus !== false);
        },
      });
    }
    updateViewportMarkers();
    bindEvents();
    bindFilterSheetSwipe();
    bindSettingsDialogReturn();
    bindChromeAutoHide();
    watchDetailOpens();
    bindVocabList();
    bindObservers();
    state.initialized = true;
    root.dataset.mobileShell = "ready";
    updateChrome();
    syncSettings();
    return window.KotobaFlowMobileShell;
  }

  function destroy() {
    if (!state.initialized) return;
    closeFilter(false);
    closeSettings(false);
    closeChunkDetail(false);
    closeImageViewer(false);
    if (state.lessonObserverTimer) {
      window.clearTimeout(state.lessonObserverTimer);
      state.lessonObserverTimer = 0;
    }
    if (state.vocabAudioSyncTimer) {
      window.clearTimeout(state.vocabAudioSyncTimer);
      state.vocabAudioSyncTimer = 0;
    }
    state.lessonObserverRefresh = false;
    restoreLessonAudioBar();
    restoreLessonSectionNav();
    restoreLessonAudioSync();
    restoreLessonChunkDetailSchedule();
    restoreGrammarNavigation();
    if (
      window.PanelLayout &&
      window.PanelLayout.openTools === state.panelWrappedOpenTools
    ) {
      window.PanelLayout.openTools = state.panelOriginalOpenTools;
    }
    state.panelOriginalOpenTools = null;
    state.panelWrappedOpenTools = null;
    if (
      window.JPLearn &&
      window.JPLearn.bookPager &&
      window.JPLearn.bookPager.mount === state.bookWrappedMount
    ) {
      window.JPLearn.bookPager.mount = state.bookOriginalMount;
    }
    state.bookOriginalMount = null;
    state.bookWrappedMount = null;
    document
      .querySelectorAll(".book-frame[data-mobile-book-fit]")
      .forEach(function (frame) {
        frame.style.maxHeight = "";
        delete frame.dataset.mobileBookFit;
      });
    document.querySelectorAll(".mobile-folio").forEach(function (folio) {
      folio.remove();
    });
    document
      .querySelectorAll("[data-mobile-placeholder]")
      .forEach(function (level) {
        level.removeAttribute("data-mobile-placeholder");
      });
    if (state.runningHeadTimer) {
      window.clearTimeout(state.runningHeadTimer);
      state.runningHeadTimer = 0;
    }
    window.clearTimeout(state.moduleFadeTimer);
    if (state.grammarTabFrame) {
      window.cancelAnimationFrame(state.grammarTabFrame);
      state.grammarTabFrame = 0;
    }
    state.headObserver = null;
    state.headWatched = null;
    var settingsDanger = getElement("mobileSettingsDataPage")?.querySelector(
      ".app-settings-danger",
    );
    if (settingsDanger && state.settingsDangerOriginalParent) {
      state.settingsDangerOriginalParent.insertBefore(
        settingsDanger,
        state.settingsDangerOriginalNextSibling &&
          state.settingsDangerOriginalNextSibling.parentElement ===
            state.settingsDangerOriginalParent
          ? state.settingsDangerOriginalNextSibling
          : null,
      );
      settingsDanger.open = state.settingsDangerOriginalOpen;
    }
    var settingsPanel = getElement("appSettingsPanel");
    if (settingsPanel && state.settingsOriginalParent) {
      state.settingsOriginalParent.insertBefore(
        settingsPanel,
        state.settingsOriginalNextSibling &&
          state.settingsOriginalNextSibling.parentElement ===
            state.settingsOriginalParent
          ? state.settingsOriginalNextSibling
          : null,
      );
    }
    state.cleanup.splice(0).forEach(function (cleanup) {
      cleanup();
    });
    state.observers.splice(0).forEach(function (observer) {
      observer.disconnect();
    });
    var shell = getElement("mobileAppShell");
    var backdrop = getElement("mobileFilterBackdrop");
    var chunkBackdrop = getElement("mobileChunkBackdrop");
    var filterSheet = getElement("mobileFilterSheet");
    var settingsSheet = getElement("mobileSettingsSheet");
    var settingsDataPage = getElement("mobileSettingsDataPage");
    var settingsDataButton = getElement("mobileSettingsDataButton");
    var subpage = getElement("mobileFilterSubpage");
    var imageViewer = getElement("mobileImageViewer");
    var miniPlayer = getElement("mobileLessonMiniPlayer");
    [
      shell,
      backdrop,
      chunkBackdrop,
      filterSheet,
      subpage,
      settingsSheet,
      settingsDataPage,
      settingsDataButton,
      imageViewer,
      miniPlayer,
    ].forEach(function (node) {
      if (node && node.parentElement) node.parentElement.removeChild(node);
    });
    document.body.classList.remove(
      "mobile-filter-open",
      "mobile-settings-open",
      "mobile-dialog-open",
      "mobile-layer-open",
      "mobile-detail-open",
      "mobile-search-open",
      "mobile-image-open",
      "mobile-plan-open",
      "mobile-lesson-audio-playing",
    );
    restoreA11yState();
    delete root.dataset.mobileShell;
    delete root.dataset.mobileTopLayer;
    delete root.dataset.mobileReader;
    delete root.dataset.mobileModule;
    delete root.dataset.mobileInput;
    state.initialized = false;
    state.degraded = false;
    state.settingsOriginalParent = null;
    state.settingsOriginalNextSibling = null;
    state.settingsDangerOriginalParent = null;
    state.settingsDangerOriginalNextSibling = null;
    state.settingsDangerOriginalOpen = false;
    state.settingsDataFocus = null;
    state.filterOriginalParent = null;
    state.filterOriginalNextSibling = null;
    state.filterContext = null;
    state.filterSubpage = null;
    state.detailContext = null;
    clearSearchReturnContext();
    state.imageViewerContext = null;
    state.lessonAudioMoved = [];
    state.lessonChunkModule = null;
    state.lessonChunkOriginalSchedule = null;
    state.lessonChunkWrappedSchedule = null;
    state.grammarNavigationModule = null;
    state.grammarOriginalNavigateToLesson = null;
    state.grammarWrappedNavigateToLesson = null;
    state.lessonObserverRefresh = false;
    restoreAccessibleNames();
    state.navigationRestoreAttempted = false;
    state.userSelectedModule = false;
    state.settingsLayerHeld = false;
    state.chromeHidden = false;
    state.chromeTravel = 0;
    state.chromeModule = "";
    delete root.dataset.mobileChrome;
    var listContainer = getElement("list-container");
    if (listContainer) delete listContainer.dataset.mobileSelect;
  }

  window.KotobaFlowMobileShell = {
    init: init,
    destroy: destroy,
    refresh: function () {
      updateViewportMarkers();
      updateChrome();
      syncSettings();
    },
    handleBack: handleBack,
    addBackHandler: function (handler) {
      if (typeof handler !== "function") return function () {};
      externalBackHandlers.push(handler);
      return function () {
        externalBackHandlers = externalBackHandlers.filter(function (item) {
          return item !== handler;
        });
      };
    },
    openFilter: openFilter,
    closeFilter: closeFilter,
    openFilterSubpage: openFilterSubpage,
    closeFilterSubpage: closeFilterSubpage,
    openImageViewer: openImageViewer,
    closeImageViewer: closeImageViewer,
    switchModule: switchModule,
    getState: function () {
      return {
        initialized: state.initialized,
        degraded: state.degraded,
        detailLeaving: !!state.detailLeaving,
        activeModule: state.activeModule,
        topLayer: topLayer(),
        viewport: root.dataset.mobileViewport || "",
        orientation: root.dataset.mobileOrientation || "",
      };
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
