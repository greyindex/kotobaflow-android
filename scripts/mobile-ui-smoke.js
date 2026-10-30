"use strict";

const fs = require("fs");
const path = require("path");
const { packagedProfile } = require("./build-profile");

// UI coverage for the October web port. This module deliberately has no runner:
// mobile-smoke.js owns the isolated server/browser and native storage tests.
async function runCurrentUiSmoke({
  browser,
  openApp,
  report,
  checkTouchTargets,
  checkAccessibleNames,
  viewports = [{ width: 393, height: 844 }],
}) {
  // The packaged edition: its books, and whether it has the classics library.
  const profile = packagedProfile();
  const results = { checks: [], books: [], responsive: [] };
  const screenshotDirectory = path.resolve(
    __dirname,
    "..",
    "local",
    "qa",
    "mobile-upstream-20261011",
  );
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  const screenshot = (page, name) =>
    page.screenshot({
      path: path.join(screenshotDirectory, `${name}.png`),
      animations: "disabled",
    });
  report.functional = results;
  const ensure = (name, passed, actual) => {
    if (!passed) {
      throw new Error(`${name}: ${JSON.stringify(actual).slice(0, 1800)}`);
    }
    results.checks.push(name);
    fs.writeFileSync(
      path.join(screenshotDirectory, "ui-progress.json"),
      JSON.stringify({ checks: results.checks.length, latest: name }),
    );
  };
  const settle = (page) => page.waitForTimeout(220);
  // Controls of the app bar, navigation and mini player that a tap at their
  // centre would miss (covered, or pointer-events: none).
  const appBarMisses = () =>
    Array.from(
      document.querySelectorAll(
        "#mobileAppBar button, #mobileBottomNav button, #mobileLessonMiniPlayer button",
      ),
    )
      .filter((button) => {
        const box = button.getBoundingClientRect();
        return (
          box.width > 0 &&
          box.height > 0 &&
          getComputedStyle(button).visibility !== "hidden"
        );
      })
      .map((button) => {
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        return {
          id: button.id || button.className,
          text: button.textContent.trim().slice(0, 16),
          hit: !!hit && (hit === button || button.contains(hit)),
        };
      })
      .filter((control) => !control.hit);
  const ready = async (page) => {
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(30000);
    await page.waitForFunction(
      () =>
        window.appConfig?.status === "ready" &&
        document.documentElement.dataset.mobileShell === "ready",
    );
    // 拓展阅读 (classics) joins the bottom navigation once its catalog loads;
    // both editions carry the classics library since DF-23.
    if (profile.classics)
      await page.waitForSelector(
        '#mobileBottomNav [data-mobile-module="classics"]:not([hidden])',
      );
  };
  const back = async (page) => {
    await page.dispatchEvent("body", "backbutton");
    await settle(page);
    // DF-20: an entry closes after it has slid out.
    await page.waitForFunction(
      () => !window.KotobaFlowMobileShell?.getState().detailLeaving,
    );
  };
  // DF-20: an entry slides in for about 200 ms; measure it once it is still.
  const detailSlidIn = (page) =>
    page.waitForFunction(() => {
      const panel = document.querySelector(
        ".detail-panel.anchored-detail-open",
      );
      if (!panel) return false;
      const transform = getComputedStyle(panel).transform;
      return transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)";
    });
  const geometry = (page) =>
    page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      shell: document.documentElement.dataset.mobileShell,
      viewport: document.documentElement.dataset.mobileViewport,
      // Visible entries: 拓展阅读 joins the four modules with the local library.
      navCount: document.querySelectorAll(
        "#mobileBottomNav [data-mobile-module]:not([hidden])",
      ).length,
      shellCount: document.querySelectorAll("#mobileAppShell").length,
    }));
  const noOverflow = async (page, name) => {
    const state = await geometry(page);
    ensure(
      `${name}: no document overflow`,
      state.scrollWidth <= state.width + 1,
      state,
    );
  };
  const a11y = async (page, name) => {
    const state = await checkAccessibleNames(page);
    ensure(
      `${name}: accessible controls`,
      !state.missingButtons.length &&
        !state.missingFields.length &&
        state.navSelected &&
        state.vocabTabSelected,
      state,
    );
  };
  const touch = async (page, name) => {
    const small = await checkTouchTargets(page);
    ensure(`${name}: touch targets`, small.length === 0, {
      count: small.length,
      examples: small.slice(0, 6),
    });
  };
  const switchModule = async (page, module) => {
    await page
      .locator(`#mobileBottomNav [data-mobile-module='${module}']`)
      .click();
    await page.waitForFunction(
      (name) =>
        document.querySelector("#mobileBottomNav [aria-current='page']")
          ?.dataset.mobileModule === name,
      module,
    );
    await settle(page);
  };
  const filter = async (page) => {
    if (!(await page.locator("#mobileFilterSheet").isVisible())) {
      await page.locator("#mobileAppContextButton").click();
    }
    await page.locator("#mobileFilterSheet").waitFor({ state: "visible" });
  };
  const closeFilter = async (page) => {
    if (await page.locator("#mobileFilterSubpage").isVisible())
      await back(page);
    if (await page.locator("#mobileFilterSheet").isVisible()) {
      await page.locator("#mobileFilterClose").click();
      await settle(page);
    }
  };
  const settings = async (page) => {
    if (await page.locator("#mobileSettingsSheet").isVisible()) return;
    await switchModule(page, "dashboard");
    await page.locator("#mobileAppContextButton").click();
    await page.locator("#mobileSettingsSheet").waitFor({ state: "visible" });
  };
  const modal = async (page, selector, name) => {
    await settle(page);
    const state = await page.locator(selector).evaluate((surface) => ({
      modal: surface.getAttribute("aria-modal"),
      focus: surface.contains(document.activeElement),
      background: document.querySelector("#mobileAppShell").inert,
      hidden: document
        .querySelector("#mobileAppShell")
        .getAttribute("aria-hidden"),
    }));
    ensure(
      `${name}: modal owns focus and isolates background`,
      state.modal === "true" &&
        state.focus &&
        state.background &&
        state.hidden === "true",
      state,
    );
    await page.locator(selector).locator("button:visible").first().focus();
    await page.keyboard.press("Shift+Tab");
    ensure(
      `${name}: focus remains inside overlay`,
      await page
        .locator(selector)
        .evaluate((surface) => surface.contains(document.activeElement)),
      selector,
    );
  };
  // Page headings of the reading modules, which a phone folds away.
  const pageHeadings = {
    "#tbReader": "tbLessonHeading",
    "#grammarMain": "grammarHeading",
    "#vocabMain": "vocabHeading",
    "#clReader": "clPartHeading",
  };
  const headingTools = async (page, host, name, action = "tools") => {
    const before = await page
      .locator(`${host} .book-page-select`)
      .first()
      .inputValue();
    const phone = await page.evaluate(
      () => document.documentElement.dataset.mobileReader === "page",
    );
    if (phone) {
      // A phone page keeps only a running head in the app bar; its 筛选 (目录
      // for the classics) opens the sheet that offers the heading's actions.
      const folded = await page.evaluate(
        (id) => ({
          heading: getComputedStyle(document.getElementById(id)).display,
          running: document
            .getElementById("mobileRunningTitle")
            .textContent.trim(),
        }),
        pageHeadings[host],
      );
      ensure(
        `${name}: heading folds into the running head`,
        folded.heading === "none" && !!folded.running,
        folded,
      );
      // ART-15: a reading page's sheet is a table of contents, the lists
      // keep the filter, the classics name their works.
      const expected = {
        "#tbReader": { button: "目录", icon: "list", title: "本课与目录" },
        "#grammarMain": { button: "筛选", icon: "filter", title: "筛选语法" },
        "#vocabMain": { button: "筛选", icon: "filter", title: "筛选词汇" },
        "#clReader": { button: "目录", icon: "list", title: "作品与目录" },
      }[host];
      const contextButton = await page.evaluate(() => {
        const button = document.getElementById("mobileAppContextButton");
        return {
          name: button.getAttribute("aria-label"),
          text: button.textContent.trim(),
          icon: button.dataset.mobileIcon,
        };
      });
      ensure(
        `${name}: app bar button is ${expected.button}`,
        contextButton.name === expected.button &&
          contextButton.text === expected.button &&
          contextButton.icon === expected.icon,
        contextButton,
      );
      await page.locator("#mobileAppContextButton").click();
      await page.locator("#mobileFilterSheet").waitFor({ state: "visible" });
      ensure(
        `${name}: sheet is titled ${expected.title}`,
        (await page.locator("#mobileFilterTitle").textContent()) ===
          expected.title,
        await page.locator("#mobileFilterTitle").textContent(),
      );
    } else {
      await page.locator(`${host} [data-heading-action='${action}']`).click();
    }
    await page.locator("#mobileFilterSheet").waitFor({ state: "visible" });
    ensure(
      `${name}: heading opens mobile tools`,
      await page.locator("#mobileFilterContent").isVisible(),
      name,
    );
    if (phone) {
      const current = await page.evaluate(() => ({
        shown: !document.getElementById("mobileSheetCurrent").hidden,
        title:
          document
            .getElementById("mobileSheetCurrentTitle")
            ?.textContent.trim() || "",
        actions: [
          ...document.querySelectorAll(
            "#mobileSheetCurrent .mobile-sheet-action",
          ),
        ].map((proxy) => proxy.dataset.sheetAction || ""),
      }));
      ensure(
        `${name}: sheet names the page and offers its actions`,
        current.shown &&
          !!current.title &&
          !current.actions.includes("tools") &&
          !current.actions.includes("toc") &&
          // DF-07: the sheet's × returns to the lesson.
          !current.actions.includes("continue"),
        current,
      );
    }
    await modal(page, "#mobileFilterSheet", `${name} tools`);
    if (await page.locator("#mobileFilterSubpage").isVisible())
      await back(page);
    await back(page);
    ensure(
      `${name}: Back closes tools`,
      !(await page.locator("#mobileFilterSheet").isVisible()),
      name,
    );
    ensure(
      `${name}: tools preserve book page`,
      (await page.locator(`${host} .book-page-select`).first().inputValue()) ===
        before,
      {
        before,
        after: await page
          .locator(`${host} .book-page-select`)
          .first()
          .inputValue(),
      },
    );
  };
  const bookGeometry = async (page, selector, name) => {
    await page.locator(selector).waitFor({ state: "visible" });
    await settle(page);
    await page.locator(selector).evaluate((frame) =>
      Promise.all(
        frame
          .getAnimations({ subtree: true })
          .filter(
            (animation) =>
              animation.effect?.getComputedTiming().iterations !== Infinity,
          )
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
    const state = await page.locator(selector).evaluate((frame) => {
      const body = frame.querySelector(".book-body");
      const rect = body.getBoundingClientRect();
      const footer = frame
        .querySelector(".book-footer")
        .getBoundingClientRect();
      const style = getComputedStyle(body);
      const scroller = frame.closest(
        "#tbReader, #card-container, #gmGrammarList, #gmLessonReader, #clReader",
      );
      const scrollerRect = scroller.getBoundingClientRect();
      const frameTop =
        frame.getBoundingClientRect().top -
        scrollerRect.top +
        scroller.scrollTop;
      return {
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        footerWidth: Math.round(footer.width),
        pages: frame.querySelector(".book-page-select").options.length,
        page: Number(frame.querySelector(".book-page-select").value),
        status: frame.querySelector(".book-status").textContent.trim(),
        available: Math.floor(scroller.clientHeight - frameTop - 12),
        footerBottom: Math.round(footer.bottom),
        scrollerBottom: Math.round(scrollerRect.bottom),
      };
    });
    ensure(
      `${name}: bounded book body and footer`,
      state.overflowX === "hidden" &&
        state.overflowY === "hidden" &&
        state.width > 100 &&
        state.height > 100 &&
        state.footerWidth > 100 &&
        state.pages > 0,
      state,
    );
    await noOverflow(page, name);
    if (state.available >= 320)
      ensure(
        `${name}: initial footer fits reading area`,
        state.footerBottom <= state.scrollerBottom + 1,
        {
          available: state.available,
          footerBottom: state.footerBottom,
          scrollerBottom: state.scrollerBottom,
        },
      );
    if (await page.locator(`${selector} .cc-word`).count()) {
      const entries = await page.locator(selector).evaluate((frame) => {
        const body = frame.querySelector(".book-body");
        const bounds = body.getBoundingClientRect();
        return Array.from(body.querySelectorAll(".cc-word"))
          .map((word) => {
            const rect = word.getBoundingClientRect();
            let opacity = 1;
            for (
              let node = word;
              node && node !== frame.parentElement;
              node = node.parentElement
            )
              opacity *= Number(getComputedStyle(node).opacity);
            return {
              left: Math.round(rect.left - bounds.left),
              right: Math.round(rect.right - bounds.left),
              width: Math.round(bounds.width),
              opacity,
              onPage:
                rect.right > bounds.left + 1 && rect.left < bounds.right - 1,
            };
          })
          .filter((word) => word.onPage);
      });
      ensure(
        `${name}: settled dictionary entries stay inside page`,
        entries.length > 0 &&
          entries.every(
            (entry) =>
              entry.left >= -1 &&
              entry.right <= entry.width + 1 &&
              entry.opacity >= 0.99,
          ),
        entries.slice(0, 8),
      );
    }
    return state;
  };
  // A curl turn (web 5417d47) lays frozen copies of the turning pages over the
  // frame until its motion ends; read the live page after that.
  const turnSettled = (page, selector) =>
    page.waitForFunction(
      (s) => !document.querySelector(`${s} .book-flip-layer`),
      selector,
    );
  const exercisePager = async (page, selector, name) => {
    const state = await bookGeometry(page, selector, name);
    ensure(`${name}: has multiple readable pages`, state.pages > 1, state);
    const book = page.locator(selector);
    const select = book.locator(".book-page-select");
    await select.selectOption("0");
    await book.locator(".book-turn[data-book-flip='next']").click();
    await page.waitForFunction(
      (s) => document.querySelector(`${s} .book-page-select`).value === "1",
      selector,
    );
    await book.locator(".book-turn[data-book-flip='prev']").click();
    await page.waitForFunction(
      (s) => document.querySelector(`${s} .book-page-select`).value === "0",
      selector,
    );
    await select.selectOption(String(Math.min(2, state.pages - 1)));
    ensure(
      `${name}: page selector`,
      Number(await select.inputValue()) === Math.min(2, state.pages - 1),
      await select.inputValue(),
    );
    await select.selectOption("0");
    await turnSettled(page, selector);
    const body = book.locator(".book-body");
    const area = await body.boundingBox();
    const y = area.y + Math.min(40, area.height / 2);
    // A real touch drag (the pages follow the finger, then turn on release).
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x, y }],
      });
    const from = area.x + area.width - 30;
    await touch("touchStart", from);
    for (let i = 1; i <= 8; i++)
      await touch("touchMove", from - (i * (area.width - 60)) / 8);
    await touch("touchEnd");
    await cdp.detach();
    await page.waitForFunction(
      (s) => document.querySelector(`${s} .book-page-select`).value === "1",
      selector,
    );
    ensure(
      `${name}: touch swipe turns one page`,
      (await select.inputValue()) === "1",
      await select.inputValue(),
    );
    await select.selectOption("0");
  };
  // Read geometry to choose a page, then use the visible page selector. No test
  // writes the pager's fields or bypasses the product's navigation handlers.
  const revealInBook = async (page, selector) => {
    const target = page.locator(selector).first();
    await target.waitFor({ state: "attached" });
    const destination = await target.evaluate((element) => {
      const body = element.closest(".book-body");
      if (!body) return null;
      const frame = body.closest(".book-frame");
      const gap = parseFloat(getComputedStyle(body).columnGap) || 0;
      const bounds = body.getBoundingClientRect();
      const rect = element.getClientRects()[0];
      const scale = bounds.width ? body.clientWidth / bounds.width : 1;
      const left = (rect.left - bounds.left) * scale + body.scrollLeft;
      return {
        value: String(
          Math.max(
            0,
            Math.min(
              frame.querySelector(".book-page-select").options.length - 1,
              Math.floor((left + 2) / (body.clientWidth + gap)),
            ),
          ),
        ),
        host: frame.closest("#tbReader")
          ? "#tbReader"
          : frame.closest("#gmGrammarList")
            ? "#gmGrammarList"
            : "#card-container",
      };
    });
    if (destination) {
      await page
        .locator(`${destination.host} .book-page-select`)
        .selectOption(destination.value);
      await settle(page);
    }
    return target;
  };
  // The sheet picks a textbook from list rows; the select stays hidden.
  const bookRow = (page, id) =>
    page.locator(`#mobileFilterContent .mobile-book-row[data-book-id='${id}']`);
  // DF-07: the rows sit in the folded 教材册 group.
  const pickBook = async (page, id) => {
    const fold = page.locator("#mobileFilterContent .mobile-book-fold");
    if ((await fold.getAttribute("open")) === null)
      await fold.locator(":scope > summary").click();
    await bookRow(page, id).click();
  };
  const openBook = async (page, id) => {
    await filter(page);
    await pickBook(page, id);
    await page.waitForFunction(
      (book) =>
        window.ModuleSwitcher?.getTextbookModule()?.currentBookId === book &&
        !!window.ModuleSwitcher?.getTextbookModule()?.currentLesson,
      id,
    );
    // The first non-kana lesson exercises every textbook's substantive content.
    if (
      (await page.locator(".tb-lesson-directory").getAttribute("open")) === null
    ) {
      await page.locator(".tb-lesson-directory > summary").click();
    }
    const lesson = await page
      .locator(".tb-lesson-card")
      .evaluateAll((cards, bookId) => {
        const selected =
          (bookId === "XinBian1" &&
            cards.find((entry) => entry.dataset.lessonId === "lesson_02")) ||
          cards.find((entry) => entry.dataset.lessonId !== "lesson_00") ||
          cards[0];
        return selected.dataset.lessonId;
      }, id);
    await page.locator(`.tb-lesson-card[data-lesson-id='${lesson}']`).click();
    await page.waitForFunction(
      ({ book, lessonId }) => {
        const module = window.ModuleSwitcher?.getTextbookModule();
        return (
          module?.currentBookId === book &&
          module?.currentLessonId === lessonId &&
          !!module?.currentLesson &&
          !!document.querySelector("#tbReader .book-frame")
        );
      },
      { book: id, lessonId: lesson },
    );
    // Lesson cards commit navigation and close their mobile sheet themselves.
    // Wait for that close instead of racing it with a second close-button click.
    await page.locator("#mobileFilterSheet").waitFor({ state: "hidden" });
    const images = page.locator("#tbReader .tb-book-cover img");
    if (await images.count()) {
      await page.waitForFunction(() =>
        Array.from(
          document.querySelectorAll("#tbReader .tb-book-cover img"),
        ).every((image) => image.complete && image.naturalWidth > 0),
      );
    }
    await settle(page);
    return lesson;
  };

  for (const viewport of [
    ...viewports,
    { width: 1280, height: 720 },
    { width: 1600, height: 900 },
  ]) {
    const { page, errors } = await openApp(browser, viewport);
    try {
      await ready(page);
      const state = await geometry(page);
      const expected =
        viewport.width <= 600
          ? "phone"
          : viewport.width <= 1024
            ? "tablet"
            : "desktop";
      ensure(
        `viewport ${viewport.width}x${viewport.height}: shell`,
        state.shell === "ready" &&
          state.viewport === expected &&
          state.navCount === (profile.classics ? 5 : 4) &&
          state.shellCount === 1,
        state,
      );
      await noOverflow(page, `viewport ${viewport.width}`);
      await touch(page, `viewport ${viewport.width}`);
      await a11y(page, `viewport ${viewport.width}`);
      if ([393, 844, 1280, 1600].includes(viewport.width))
        await screenshot(
          page,
          `${viewport.width}x${viewport.height}-dashboard`,
        );
      // Both phone and tablet books must use the same default layout.
      if ([320, 393, 640, 840, 844, 1280, 1600].includes(viewport.width)) {
        for (const [module, selector] of [
          ["vocab", "#card-container .book-frame"],
          ["grammar", "#gmGrammarList .book-frame"],
        ]) {
          await switchModule(page, module);
          await bookGeometry(page, selector, `${viewport.width} ${module}`);
          await touch(page, `${viewport.width} ${module}`);
          await a11y(page, `${viewport.width} ${module}`);
          if ([393, 1280, 1600].includes(viewport.width))
            await screenshot(
              page,
              `${viewport.width}x${viewport.height}-${module}-book`,
            );
          if ([844, 1280, 1600].includes(viewport.width)) {
            await page
              .locator(`${selector} .book-page-select`)
              .scrollIntoViewIfNeeded();
            const footer = await page
              .locator(`${selector} .book-footer`)
              .evaluate((element) => {
                const bounds = element.getBoundingClientRect();
                const nav = document
                  .querySelector("#mobileBottomNav")
                  .getBoundingClientRect();
                return {
                  top: Math.round(bounds.top),
                  bottom: Math.round(bounds.bottom),
                  navTop: Math.round(nav.top),
                };
              });
            ensure(
              `${viewport.width} ${module}: footer reachable above navigation`,
              footer.top >= 0 && footer.bottom <= footer.navTop + 1,
              footer,
            );
            await screenshot(
              page,
              `${viewport.width}x${viewport.height}-${module}-footer`,
            );
          }
        }
      }
      if ([1280, 1600].includes(viewport.width)) {
        await switchModule(page, "lesson");
        await openBook(page, "KotobaFlow1");
        await bookGeometry(
          page,
          "#tbReader .book-frame",
          `${viewport.width} textbook`,
        );
        await screenshot(
          page,
          `${viewport.width}x${viewport.height}-textbook-book`,
        );
        await page
          .locator("#tbReader .book-page-select")
          .scrollIntoViewIfNeeded();
        await screenshot(
          page,
          `${viewport.width}x${viewport.height}-textbook-footer`,
        );
      }
      ensure(
        `viewport ${viewport.width}: runtime errors`,
        errors.length === 0,
        errors.slice(0, 8),
      );
      report.viewports.push({ ...viewport, state, errors });
    } catch (error) {
      await screenshot(
        page,
        `${viewport.width}x${viewport.height}-failure`,
      ).catch(() => {});
      fs.writeFileSync(
        path.join(screenshotDirectory, "partial-ui-report.json"),
        JSON.stringify(results, null, 2),
      );
      throw error;
    } finally {
      await page.close();
    }
  }

  const fastApp = await openApp(browser, { width: 393, height: 844 });
  try {
    await ready(fastApp.page);
    await fastApp.page.route(
      "**/data/textbook/book_chunks/*.json*",
      async (route) => {
        await fastApp.page.waitForTimeout(200);
        await route.continue();
      },
    );
    await fastApp.page
      .locator("#mobileBottomNav [data-mobile-module='lesson']")
      .click();
    await fastApp.page.locator("#mobileAppContextButton").click();
    // 教材册 is folded (DF-07); its summary shows once the picker is drawn.
    await fastApp.page
      .locator("#mobileFilterContent .mobile-book-fold > summary")
      .waitFor({ state: "visible" });
    await fastApp.page.waitForFunction(
      () => !!window.ModuleSwitcher.getTextbookModule()?.currentLesson,
    );
    await settle(fastApp.page);
    const owner = await fastApp.page
      .locator("#textbookSidebar")
      .evaluate((sidebar) => ({
        parent: sidebar.parentElement.id,
        visible:
          sidebar.getBoundingClientRect().width > 0 &&
          getComputedStyle(sidebar).display !== "none",
      }));
    ensure(
      "textbook: fast context survives deferred initialization",
      owner.parent === "mobileFilterContent" && owner.visible,
      owner,
    );
    await back(fastApp.page);
    ensure(
      "fast context: runtime errors",
      fastApp.errors.length === 0,
      fastApp.errors.slice(0, 8),
    );
  } finally {
    await fastApp.page.close();
  }

  // DF-10: un-favouriting on a favourites list leaves the entry in place,
  // shown as not favourite and restorable with another tap; it goes when the
  // reader switches lists or leaves the page.
  const favouritesApp = await openApp(browser, { width: 393, height: 844 });
  try {
    const favPage = favouritesApp.page;
    await ready(favPage);
    await switchModule(favPage, "vocab");
    const words = await favPage.evaluate(() => {
      const picked = window.appConfig.cardMode.displayWords
        .slice(0, 3)
        .map((word) => word.index);
      picked.forEach((index) =>
        window.StudyStorage.markWord(index, "favorite"),
      );
      document.querySelector("#vocabViewTools .cc-tab-fav").click();
      return picked;
    });
    const cardStar = (index) =>
      favPage.locator(`#card-container .cc-fav[data-fav="${index}"]`).first();
    const cardState = () =>
      favPage.evaluate(
        (picked) =>
          picked.map((index) => {
            const star = document.querySelector(
              `#card-container .cc-fav[data-fav="${index}"]`,
            );
            return star ? star.classList.contains("active") : null;
          }),
        words,
      );
    await cardStar(words[0]).click();
    const unstarred = await cardState();
    await cardStar(words[0]).click();
    const restored = await cardState();
    await cardStar(words[0]).click();
    await favPage.evaluate(() => {
      const tab = () => document.querySelector("#vocabViewTools .cc-tab-fav");
      tab().click();
      tab().click();
    });
    const switched = await cardState();
    ensure(
      "favourites: an un-favourited word stays until the list switches",
      JSON.stringify(unstarred) === "[false,true,true]" &&
        JSON.stringify(restored) === "[true,true,true]" &&
        JSON.stringify(switched) === "[null,true,true]",
      { unstarred, restored, switched },
    );
    await cardStar(words[1]).click();
    await switchModule(favPage, "dashboard");
    await switchModule(favPage, "vocab");
    const returned = await cardState();
    ensure(
      "favourites: leaving the page drops the un-favourited word",
      JSON.stringify(returned) === "[null,null,true]",
      returned,
    );

    await switchModule(favPage, "grammar");
    const points = await favPage.evaluate(() => {
      const list = window.grammarModule.grammarList;
      const picked = list.filtered.slice(0, 2).map((item) => item.uid);
      picked.forEach((uid) => window.StudyStorage.toggleGrammarFavorite(uid));
      document.querySelector("#gmSidebarFilters .gm-tab-fav").click();
      return picked;
    });
    const pointState = () =>
      favPage.evaluate(
        (picked) =>
          picked.map((uid) => {
            const star = document.querySelector(
              `#gmGrammarList .gm-card-fav[data-grammar-fav="${uid}"]`,
            );
            return star ? star.classList.contains("active") : null;
          }),
        points,
      );
    const pointStar = (uid) =>
      favPage
        .locator(`#gmGrammarList .gm-card-fav[data-grammar-fav="${uid}"]`)
        .first();
    await pointStar(points[0]).click();
    const pointUnstarred = await pointState();
    await pointStar(points[0]).click();
    const pointRestored = await pointState();
    await pointStar(points[0]).click();
    await favPage.evaluate(() => {
      const tab = () => document.querySelector("#gmSidebarFilters .gm-tab-fav");
      tab().click();
      tab().click();
    });
    const pointSwitched = await pointState();
    await pointStar(points[1]).click();
    await switchModule(favPage, "dashboard");
    await switchModule(favPage, "grammar");
    const pointReturned = await pointState();
    ensure(
      "favourites: grammar points stay until the list switches or the page is left",
      JSON.stringify(pointUnstarred) === "[false,true]" &&
        JSON.stringify(pointRestored) === "[true,true]" &&
        JSON.stringify(pointSwitched) === "[null,true]" &&
        JSON.stringify(pointReturned) === "[null,null]",
      { pointUnstarred, pointRestored, pointSwitched, pointReturned },
    );
    ensure(
      "favourites: runtime errors",
      favouritesApp.errors.length === 0,
      favouritesApp.errors.slice(0, 8),
    );
  } finally {
    await favouritesApp.page.close();
  }

  // Today on a phone page (ART-13, ART-23, DF-14a, DF-14b): the date and
  // 学习计划, 今日目标, the calendar and 最近学习 only, no line under the
  // app bar title, one colour on the goal bar, accent ramp on the calendar.
  const todayApp = await openApp(browser, { width: 393, height: 844 });
  try {
    const todayPage = todayApp.page;
    await ready(todayPage);
    const readToday = () =>
      todayPage.evaluate(() => {
        const swatch = (token) => {
          const sample = document.createElement("i");
          sample.style.color = `var(${token})`;
          document.body.appendChild(sample);
          const value = getComputedStyle(sample).color;
          sample.remove();
          return value;
        };
        const shown = (element) =>
          !!element &&
          getComputedStyle(element).display !== "none" &&
          element.getBoundingClientRect().height > 0;
        const brand = document.querySelector("#mobileAppBrand img");
        const bar = document.querySelector(".dashboard-day-progress > span");
        const subtitle = document.getElementById("mobileAppBarSubtitle");
        const blocks = {
          heading: ".dashboard-heading",
          date: ".dashboard-heading .dashboard-eyebrow",
          plan: ".dashboard-plan-action",
          goal: ".dashboard-progress-card",
          calendar: ".dashboard-activity",
          recent: ".dashboard-recent",
          start: ".dashboard-start-card",
          tasks: ".dashboard-tasks",
          insights: "[data-dashboard-insights]",
          achievements: "[data-dashboard-achievements]",
        };
        const filled = document.querySelector(
          ".dashboard-activity .cg-cell[data-level='1'], .dashboard-activity .cg-cell[data-level='2'], .dashboard-activity .cg-cell[data-level='3'], .dashboard-activity .cg-cell[data-level='4']",
        );
        const overlay = filled && getComputedStyle(filled, "::before");
        return {
          accent: swatch("--c-primary"),
          barBackground: bar && getComputedStyle(bar).backgroundColor,
          barImage: bar && getComputedStyle(bar).backgroundImage,
          brandWidth: brand && brand.getBoundingClientRect().width,
          shown: Object.keys(blocks).filter((name) =>
            shown(document.querySelector(blocks[name])),
          ),
          subtitle: subtitle.textContent,
          subtitleShown: shown(subtitle),
          slogan: document.body.innerText.includes("每天一点点"),
          recommendation: document.body.innerText.includes("推荐下一步"),
          calendar: shown(document.querySelector(".dashboard-activity")),
          filledLevel: filled && filled.getAttribute("data-level"),
          filledOverlay: overlay && {
            background: overlay.backgroundColor,
            opacity: overlay.opacity,
          },
        };
      });
    const todayBlocks = [
      "heading",
      "date",
      "plan",
      "goal",
      "calendar",
      "recent",
    ].join();
    const emptyToday = await readToday();
    ensure(
      "today: goal bar asks for one colour",
      emptyToday.barImage === "none" &&
        emptyToday.barBackground === emptyToday.accent &&
        emptyToday.brandWidth <= 26,
      emptyToday,
    );
    ensure(
      "today: phone home keeps the date, plan, goal, calendar and recent study",
      emptyToday.shown.join() === todayBlocks && !emptyToday.recommendation,
      emptyToday,
    );
    ensure(
      "today: no slogan under the app bar title",
      emptyToday.subtitle === "" &&
        !emptyToday.subtitleShown &&
        !emptyToday.slogan,
      emptyToday,
    );
    await todayPage.evaluate(() =>
      window.StudyStorage.saveSession({
        id: "smoke-today-entry",
        total: 1,
        known: 1,
        durationMs: 60000,
      }),
    );
    await todayPage.waitForFunction(
      () =>
        !document
          .querySelector(".dashboard-shell")
          ?.hasAttribute("data-dashboard-empty"),
    );
    const filledToday = await readToday();
    ensure(
      "today: study data leaves the phone home as it is",
      filledToday.shown.join() === todayBlocks && !filledToday.recommendation,
      filledToday,
    );
    ensure(
      "today: calendar days use the accent ramp",
      !!filledToday.filledOverlay &&
        filledToday.filledOverlay.background === filledToday.accent &&
        Number(filledToday.filledOverlay.opacity) > 0 &&
        Number(filledToday.filledOverlay.opacity) <= 1,
      filledToday,
    );
    // DF-12: 学 20 was drawn in the app bar but inherited the old floating
    // toolbar's pointer-events: none, so a tap went to the bar behind it; a
    // scripted click() skips hit testing and passed. Tap-test every control
    // the bar and navigation show, on each page.
    for (const module of ["dashboard", "vocab", "grammar", "lesson"].concat(
      profile.classics ? ["classics"] : [],
    )) {
      await switchModule(todayPage, module);
      const missed = await todayPage.evaluate(appBarMisses);
      ensure(`app bar: ${module} controls take a tap`, !missed.length, missed);
    }
    ensure(
      "app bar: vocabulary has no 学 20 beside the sheet's 随机学 20 词",
      (await todayPage.locator("#mobileVocabStudy").count()) === 0,
      await todayPage.locator("#mobileVocabStudy").count(),
    );
    ensure(
      "today: runtime errors",
      todayApp.errors.length === 0,
      todayApp.errors.slice(0, 8),
    );
  } finally {
    await todayApp.page.close();
  }

  // DF-18: 顺序朗读 in a lesson's word list. The phone draws it 6px into the
  // gap before its page, so a tap focused it "on the page before" and the
  // book turned back with the click lost; and a turn that left focus behind
  // was undone when the shell laid the book out again, so the book lagged
  // or jumped back while the words went on. The read-through starts on its
  // page, follows its words in order and has DF-06's player: a track
  // counted in words that seeks to a word, pause and stop.
  const readApp = await openApp(browser, { width: 393, height: 844 });
  try {
    const readPage = readApp.page;
    await ready(readPage);
    await switchModule(readPage, "lesson");
    await filter(readPage);
    await readPage.evaluate(() => {
      const select = document.getElementById("tbBookSelect");
      select.value = "KotobaFlow3";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await readPage.waitForFunction(
      () =>
        window.ModuleSwitcher.getTextbookModule().currentBookId ===
          "KotobaFlow3" &&
        document.querySelector(".tb-lesson-card[data-lesson-id='lesson_01']"),
    );
    await readPage.evaluate(() =>
      document
        .querySelector(".tb-lesson-card[data-lesson-id='lesson_01']")
        .click(),
    );
    await readPage.waitForFunction(() => {
      const textbook = window.ModuleSwitcher.getTextbookModule();
      return (
        textbook.currentLessonId === "lesson_01" &&
        document.querySelector("#tbReader .book-body .tb-vocab-loop-btn")
      );
    });
    await closeFilter(readPage);
    // Each word the read-through reaches, with the page shown and its page.
    await readPage.evaluate(() => {
      const textbook = window.ModuleSwitcher.getTextbookModule();
      const frame = document.querySelector("#tbReader .book-frame");
      window.__readThrough = [];
      window.__readThroughTimer = window.setInterval(() => {
        const index = textbook.ttsState.activeVocabIndex;
        const log = window.__readThrough;
        if (textbook.ttsState.mode !== "vocab-loop" || index < 0) return;
        const pager = frame._mobilePager;
        const row = frame.querySelector(
          `.book-body .tb-reading-vocab-row[data-vocab-index="${index}"]`,
        );
        const entry = {
          index,
          shown: pager.page,
          page: Math.floor(pager.columnOf(row) / pager.perSpread),
        };
        const last = log[log.length - 1];
        if (!last || last.index !== index || last.shown !== entry.shown)
          log.push(entry);
      }, 40);
    });
    const shownPage = () =>
      readPage.evaluate(
        () => document.querySelector("#tbReader .book-frame")._mobilePager.page,
      );
    const readLog = () => readPage.evaluate(() => window.__readThrough);
    const readState = () =>
      readPage.evaluate(() => {
        const textbook = window.ModuleSwitcher.getTextbookModule();
        const tts = textbook.ttsState;
        const seek = document.getElementById("mobileLessonMiniSeek");
        const box = (id) => {
          const rect = document.getElementById(id).getBoundingClientRect();
          return [Math.round(rect.width), Math.round(rect.height)];
        };
        return {
          mode: tts.mode,
          paused: !!tts.paused,
          cursor: tts.loopCursor,
          playing: !!tts.audio && !tts.audio.paused,
          words: textbook.currentVocab.length,
          shown: !document.getElementById("mobileLessonMiniPlayer").hidden,
          seek: !seek.hidden && !seek.disabled,
          seekMax: Number(seek.max),
          seekValue: Number(seek.value),
          seekText: seek.getAttribute("aria-valuetext"),
          progress: !document.getElementById("mobileLessonMiniProgress").hidden,
          toggle: document
            .getElementById("mobileLessonMiniPause")
            .getAttribute("aria-label"),
          toggleShown: !document.getElementById("mobileLessonMiniPause").hidden,
          status: document.getElementById("mobileLessonMiniStatus").textContent,
          stop: box("mobileLessonMiniStop"),
          pause: box("mobileLessonMiniPause"),
        };
      });
    // The bar starts at its page's edge; the button is drawn left of it.
    await revealInBook(readPage, "#tbReader .book-body .tb-vocab-loop-bar");
    await turnSettled(readPage, "#tbReader");
    const startPage = await shownPage();
    await readPage.locator("#tbReader .book-body .tb-vocab-loop-btn").click();
    await readPage.waitForFunction(
      () => window.__readThrough.length >= 2,
      null,
      {
        timeout: 20000,
      },
    );
    const firstWords = await readLog();
    ensure(
      "textbook: 顺序朗读 starts on its page and reads its first words there (DF-18)",
      firstWords[0].index === 0 &&
        firstWords[1].index === 1 &&
        firstWords.every(
          (entry) => entry.shown === startPage && entry.page === startPage,
        ),
      { startPage, firstWords },
    );
    const playing = await readState();
    ensure(
      "textbook: the word read-through has DF-06's track, pause and stop (DF-18)",
      playing.mode === "vocab-loop" &&
        playing.shown &&
        playing.seek &&
        !playing.progress &&
        playing.seekMax === playing.words - 1 &&
        playing.seekValue === playing.cursor &&
        playing.seekText.startsWith(
          `第 ${playing.cursor + 1} / ${playing.words} 词`,
        ) &&
        playing.toggleShown &&
        playing.toggle === "暂停" &&
        playing.stop.every((side) => side >= 44 && side <= 48) &&
        playing.pause.every((side) => side >= 44 && side <= 48),
      playing,
    );
    await readPage.locator("#mobileLessonMiniPause").click();
    const paused = await readState();
    // Longer than a word and its gap: a paused read-through stays put.
    await readPage.waitForTimeout(3000);
    const stillPaused = await readState();
    ensure(
      "textbook: the word read-through pauses on its word (DF-18)",
      paused.paused &&
        !paused.playing &&
        paused.shown &&
        paused.toggle === "继续" &&
        paused.status.startsWith("已暂停") &&
        stillPaused.paused &&
        stillPaused.cursor === paused.cursor,
      { paused, stillPaused },
    );
    // Seek while paused to the last word of a later page: the book turns to
    // it, and reading on turns to the next page.
    const target = await readPage.evaluate((after) => {
      const pager = document.querySelector(
        "#tbReader .book-frame",
      )._mobilePager;
      const rows = [
        ...document.querySelectorAll(
          "#tbReader .book-body .tb-reading-vocab-row",
        ),
      ];
      const pageOf = (row) => Math.floor(pager.columnOf(row) / pager.perSpread);
      const index = rows.findIndex(
        (row, i) =>
          i > after + 2 &&
          i + 2 < rows.length &&
          pageOf(rows[i + 1]) > pageOf(row) &&
          pageOf(row) > pageOf(rows[after]),
      );
      return { index, page: pageOf(rows[index]) };
    }, paused.cursor);
    await readPage.evaluate((index) => {
      const seek = document.getElementById("mobileLessonMiniSeek");
      seek.value = String(index);
      seek.dispatchEvent(new Event("input", { bubbles: true }));
      seek.dispatchEvent(new Event("change", { bubbles: true }));
    }, target.index);
    await settle(readPage);
    const sought = await readState();
    const soughtPage = await shownPage();
    ensure(
      "textbook: the word track seeks to a word and turns to its page (DF-18)",
      target.index > 0 &&
        sought.paused &&
        sought.cursor === target.index &&
        sought.seekValue === target.index &&
        sought.status.startsWith("已暂停") &&
        soughtPage === target.page,
      { target, sought, soughtPage },
    );
    await readPage.evaluate(() => {
      window.__readThrough = [];
    });
    await readPage.locator("#mobileLessonMiniPause").click();
    await readPage.waitForFunction(
      (index) =>
        window.__readThrough.some((entry) => entry.index === index + 2),
      target.index,
      { timeout: 30000 },
    );
    const onwards = await readLog();
    const order = onwards
      .map((entry) => entry.index)
      .filter((index, i, all) => i === 0 || all[i - 1] !== index);
    ensure(
      "textbook: from a middle word the read-through turns to each word in order (DF-18)",
      order.slice(0, 3).join() ===
        [target.index, target.index + 1, target.index + 2].join() &&
        onwards.every((entry) => entry.shown === entry.page) &&
        onwards.some((entry) => entry.page > target.page),
      { target, onwards },
    );
    await readPage.locator("#mobileLessonMiniStop").click();
    await readPage
      .locator("#mobileLessonMiniPlayer")
      .waitFor({ state: "hidden" });
    ensure(
      "textbook: the word read-through stops from the player (DF-18)",
      (await readState()).mode === "" && readApp.errors.length === 0,
      readApp.errors.slice(0, 8),
    );
    await readPage.evaluate(() =>
      window.clearInterval(window.__readThroughTimer),
    );
  } finally {
    await readApp.page.close();
  }

  // Lesson grammar on a phone page (DF-03, DF-04): the section folds under
  // its heading, open by default; a point lists three examples and folds
  // the rest under 更多例句, one row on the page. KotobaFlow 3 lesson 1 has
  // points of 44, 3 and 2 examples (the 7th, 3rd and 4th).
  const foldApp = await openApp(browser, { width: 393, height: 844 });
  try {
    const foldPage = foldApp.page;
    await ready(foldPage);
    await switchModule(foldPage, "lesson");
    await filter(foldPage);
    await foldPage.evaluate(() => {
      const select = document.getElementById("tbBookSelect");
      select.value = "KotobaFlow3";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // The course list may sit folded in the sheet; the card is clicked as
    // the sheet's own list would.
    await foldPage.waitForFunction(
      () =>
        window.ModuleSwitcher.getTextbookModule().currentBookId ===
          "KotobaFlow3" &&
        document.querySelector(".tb-lesson-card[data-lesson-id='lesson_01']"),
    );
    await foldPage.evaluate(() =>
      document
        .querySelector(".tb-lesson-card[data-lesson-id='lesson_01']")
        .click(),
    );
    await foldPage.waitForFunction(() => {
      const textbook = window.ModuleSwitcher.getTextbookModule();
      return (
        textbook.currentBookId === "KotobaFlow3" &&
        textbook.currentLessonId === "lesson_01" &&
        document.querySelector("#tbReader .book-body .mobile-more-examples")
      );
    });
    await closeFilter(foldPage);
    const pagesNow = () =>
      foldPage.evaluate(
        () =>
          document.querySelector("#tbReader .book-frame")._mobilePager.spreads,
      );
    const examples = await foldPage.evaluate(() => {
      const points = document.querySelectorAll("#tbReader .tb-cgrammar");
      const shown = (list) =>
        [...list.children].filter((item) => item.getClientRects().length)
          .length;
      const point = (index) => {
        const list = points[index].querySelector(".tb-cgrammar-examples");
        const toggle = list.nextElementSibling?.matches(".mobile-more-examples")
          ? list.nextElementSibling
          : null;
        return {
          items: list.children.length,
          shown: shown(list),
          toggle: toggle && toggle.textContent,
          expanded: toggle && toggle.getAttribute("aria-expanded"),
          height: toggle && toggle.getBoundingClientRect().height,
        };
      };
      return { long: point(6), three: point(2), two: point(3) };
    });
    ensure(
      "lesson grammar: a point shows three examples and folds the rest in one row",
      examples.long.items === 44 &&
        examples.long.shown === 3 &&
        examples.long.toggle === "更多例句（41）" &&
        examples.long.expanded === "false" &&
        examples.long.height <= 56 &&
        examples.three.shown === 3 &&
        !examples.three.toggle &&
        examples.two.shown === 2 &&
        !examples.two.toggle,
      examples,
    );
    const foldedPages = await pagesNow();
    const more = foldPage
      .locator("#tbReader .tb-cgrammar")
      .nth(6)
      .locator(".mobile-more-examples");
    await foldPage.evaluate(() => {
      const toggle = document
        .querySelectorAll("#tbReader .tb-cgrammar")[6]
        .querySelector(".mobile-more-examples");
      const pager = document.querySelector(
        "#tbReader .book-frame",
      )._mobilePager;
      pager.goTo(Math.floor(pager.columnOf(toggle) / pager.perSpread), false);
    });
    await settle(foldPage);
    await more.click();
    await settle(foldPage);
    const opened = await foldPage.evaluate(() => {
      const point = document.querySelectorAll("#tbReader .tb-cgrammar")[6];
      const toggle = point.querySelector(".mobile-more-examples");
      const pager = document.querySelector(
        "#tbReader .book-frame",
      )._mobilePager;
      return {
        shown: [
          ...point.querySelector(".tb-cgrammar-examples").children,
        ].filter((item) => item.getClientRects().length).length,
        label: toggle.textContent,
        expanded: toggle.getAttribute("aria-expanded"),
        onPage:
          Math.floor(pager.columnOf(toggle) / pager.perSpread) === pager.page,
      };
    });
    const openedPages = await pagesNow();
    await more.click();
    await settle(foldPage);
    const refolded = await foldPage.evaluate(() => {
      const toggle = document
        .querySelectorAll("#tbReader .tb-cgrammar")[6]
        .querySelector(".mobile-more-examples");
      const pager = document.querySelector(
        "#tbReader .book-frame",
      )._mobilePager;
      return {
        label: toggle.textContent,
        onPage:
          Math.floor(pager.columnOf(toggle) / pager.perSpread) === pager.page,
      };
    });
    ensure(
      "lesson grammar: 更多例句 opens every example and folds them again",
      opened.shown === 44 &&
        opened.label === "收起例句" &&
        opened.expanded === "true" &&
        openedPages > foldedPages &&
        refolded.label === "更多例句（41）" &&
        refolded.onPage &&
        (await pagesNow()) === foldedPages,
      { opened, openedPages, foldedPages, refolded },
    );
    const head = foldPage.locator(
      "#tbReader .tb-section-grammar > .tb-section-head",
    );
    const headState = () =>
      foldPage.evaluate(() => {
        const heading = document.querySelector(
          "#tbReader .tb-section-grammar > .tb-section-head",
        );
        const pager = document.querySelector(
          "#tbReader .book-frame",
        )._mobilePager;
        return {
          role: heading.getAttribute("role"),
          expanded: heading.getAttribute("aria-expanded"),
          chevron: getComputedStyle(heading, "::after").content,
          points: [
            ...heading.parentElement.querySelectorAll(".tb-cgrammar"),
          ].filter((point) => point.getClientRects().length).length,
          pages: pager.spreads,
          onPage:
            Math.floor(pager.columnOf(heading) / pager.perSpread) ===
            pager.page,
        };
      });
    const openGrammar = await headState();
    await foldPage.evaluate(() => {
      const heading = document.querySelector(
        "#tbReader .tb-section-grammar > .tb-section-head",
      );
      const pager = document.querySelector(
        "#tbReader .book-frame",
      )._mobilePager;
      pager.goTo(Math.floor(pager.columnOf(heading) / pager.perSpread), false);
    });
    await settle(foldPage);
    await head.click();
    await settle(foldPage);
    const closedGrammar = await headState();
    await head.press("Enter");
    await settle(foldPage);
    const reopenedGrammar = await headState();
    ensure(
      "lesson grammar: the section folds under its heading, open by default",
      openGrammar.role === "button" &&
        openGrammar.expanded === "true" &&
        openGrammar.chevron === '"›"' &&
        openGrammar.points === 9 &&
        closedGrammar.expanded === "false" &&
        closedGrammar.points === 0 &&
        closedGrammar.pages < openGrammar.pages &&
        closedGrammar.onPage &&
        reopenedGrammar.expanded === "true" &&
        reopenedGrammar.points === 9 &&
        reopenedGrammar.pages === openGrammar.pages,
      { openGrammar, closedGrammar, reopenedGrammar },
    );
    ensure(
      "lesson grammar folds: runtime errors",
      foldApp.errors.length === 0,
      foldApp.errors.slice(0, 8),
    );
  } finally {
    await foldApp.page.close();
  }

  // Dogfood round two (2026-10-30): launch cover (DF-16), the vocabulary
  // card page's foot (DF-17), entry and module transitions (DF-20), the
  // calendar's weekday labels (DF-21) and the lesson 0 kana chart (DF-22).
  const roundApp = await openApp(browser, { width: 393, height: 844 });
  try {
    const roundPage = roundApp.page;
    await ready(roundPage);
    // DF-16: a browser has no native splash, so the cover leaves as soon as
    // the first screen is drawn; set again, it is the splash's picture.
    await roundPage.waitForFunction(
      () => !document.documentElement.hasAttribute("data-mobile-launch"),
      null,
      { timeout: 5000 },
    );
    const cover = await roundPage.evaluate(() => {
      const root = document.documentElement;
      root.setAttribute("data-mobile-launch", "dark");
      const sheet = getComputedStyle(root, "::after");
      const bar = getComputedStyle(root, "::before");
      const state = {
        position: sheet.position,
        background: sheet.backgroundColor,
        logo: /^url\("data:image\/svg\+xml/.test(sheet.backgroundImage),
        size: sheet.backgroundSize,
        bar: bar.animationName,
        barColor: bar.backgroundColor,
      };
      root.removeAttribute("data-mobile-launch");
      return state;
    });
    ensure(
      "launch cover: lifted after the first screen; repeats the dark splash (DF-16)",
      cover.position === "fixed" &&
        cover.background === "rgb(15, 15, 15)" &&
        cover.logo &&
        /^64px 64px/.test(cover.size) &&
        /mobile-launch-bar/.test(cover.bar) &&
        cover.barColor === "rgb(111, 179, 172)",
      cover,
    );

    // DF-21: the weekday labels carry the page colour, whatever the palette.
    const weekdays = [];
    for (const [preset, mode] of [
      ["plain", "light"],
      ["plain", "dark"],
      ["paper", "light"],
      ["paper", "dark"],
    ]) {
      weekdays.push(
        await roundPage.evaluate(
          async ([preset, mode]) => {
            const appearance = window.AppAppearance;
            const value = appearance.get();
            value.light = appearance.fromPreset(preset, "light");
            value.dark = appearance.fromPreset(preset, "dark");
            appearance.save(value);
            window.AppTheme.setMode(mode);
            await new Promise((resolve) => requestAnimationFrame(resolve));
            return {
              preset,
              mode,
              labels: getComputedStyle(document.querySelector(".cg-weekdays"))
                .backgroundColor,
              page: getComputedStyle(document.getElementById("dashboardMain"))
                .backgroundColor,
            };
          },
          [preset, mode],
        ),
      );
    }
    ensure(
      "today: weekday labels sit on the page colour in every palette (DF-21)",
      weekdays.every((entry) => entry.labels === entry.page) &&
        new Set(weekdays.map((entry) => entry.page)).size === 4,
      weekdays,
    );

    // DF-17: in dark 简洁 the module is the paper colour and the card list
    // behind it the canvas; nothing of the canvas shows above the navigation.
    await roundPage.evaluate(() => {
      const appearance = window.AppAppearance;
      const value = appearance.get();
      value.light = appearance.fromPreset("plain", "light");
      value.dark = appearance.fromPreset("plain", "dark");
      appearance.save(value);
    });
    await switchModule(roundPage, "vocab");
    await roundPage.waitForSelector("#card-container .book-frame");
    await settle(roundPage);
    const foot = await roundPage.evaluate(() => {
      const nav = document
        .getElementById("mobileBottomNav")
        .getBoundingClientRect();
      const module = getComputedStyle(
        document.getElementById("vocabMain"),
      ).backgroundColor;
      const strip = [];
      for (let y = nav.top - 12; y < nav.top; y += 2) {
        let node = document.elementFromPoint(nav.left + nav.width / 2, y);
        let colour = "rgba(0, 0, 0, 0)";
        while (
          node &&
          (colour = getComputedStyle(node).backgroundColor) ===
            "rgba(0, 0, 0, 0)"
        )
          node = node.parentElement;
        strip.push(colour);
      }
      return { module, strip };
    });
    ensure(
      "vocabulary: no bar of another colour between the pages and the navigation (DF-17)",
      foot.module === "rgb(26, 26, 26)" &&
        foot.strip.every((colour) => colour === foot.module),
      foot,
    );

    // DF-20: a module fades in; an entry slides in from the right and out
    // again on Back, then closes.
    const fade = await roundPage.evaluate(async () => {
      document
        .querySelector("#mobileBottomNav [data-mobile-module='grammar']")
        .click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const main = document.getElementById("grammarMain");
      const during = {
        marked: main.hasAttribute("data-mobile-enter"),
        opacity: Number(getComputedStyle(main).opacity),
      };
      await new Promise((resolve) => setTimeout(resolve, 400));
      return {
        during,
        after: {
          marked: main.hasAttribute("data-mobile-enter"),
          opacity: Number(getComputedStyle(main).opacity),
        },
      };
    });
    ensure(
      "transitions: a module fades in when the navigation switches to it (DF-20)",
      fade.during.marked &&
        fade.during.opacity < 1 &&
        !fade.after.marked &&
        fade.after.opacity === 1,
      fade,
    );
    await switchModule(roundPage, "vocab");
    await roundPage
      .locator("#card-container .cc-card .cc-word")
      .first()
      .click();
    const slideIn = await roundPage.evaluate(async () => {
      const panel = document.querySelector(
        ".detail-panel.anchored-detail-open",
      );
      const shift = () => new DOMMatrix(getComputedStyle(panel).transform).m41;
      const first = shift();
      await new Promise((resolve) => setTimeout(resolve, 320));
      return { first, settled: shift(), width: panel.offsetWidth };
    });
    await roundPage.dispatchEvent("body", "backbutton");
    const slideOut = await roundPage.evaluate(async () => {
      const panel = document.querySelector(
        ".detail-panel.anchored-detail-open",
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      const midway = {
        open: panel.classList.contains("anchored-detail-open"),
        shift: new DOMMatrix(getComputedStyle(panel).transform).m41,
        leaving: window.KotobaFlowMobileShell.getState().detailLeaving,
      };
      await new Promise((resolve) => setTimeout(resolve, 300));
      return {
        midway,
        closed: !panel.classList.contains("anchored-detail-open"),
        layer: document.documentElement.dataset.mobileTopLayer,
      };
    });
    ensure(
      "transitions: an entry slides in from the right and out on Back (DF-20)",
      slideIn.first > 0 &&
        slideIn.settled === 0 &&
        slideOut.midway.open &&
        slideOut.midway.leaving &&
        slideOut.midway.shift > 0 &&
        slideOut.closed &&
        slideOut.layer === "none",
      { slideIn, slideOut },
    );

    // DF-22: KotobaFlow 1 lesson 0. The chart starts a page and is cut
    // between whole rows into parts that each fill one page under their own
    // column header; a tap opens the detail as a card above the footer.
    await roundPage.evaluate(() =>
      window.ModuleSwitcher.openPlannedLesson({
        bookId: "KotobaFlow1",
        lessonId: "lesson_00",
      }),
    );
    await roundPage.waitForSelector(
      "#tbReader .tb-section-kana [data-mobile-kana-part]",
      { state: "attached" },
    );
    await settle(roundPage);
    const chart = await roundPage.evaluate(() => {
      const section = document.querySelector("#tbReader .tb-section-kana");
      const pager = section.closest(".book-frame")._mobilePager;
      const tables = Array.from(section.querySelectorAll(".tb-kana-table"));
      const before = section.previousElementSibling;
      return {
        sectionPage: pager.columnOf(section),
        before: before ? pager.columnOf(before) : -1,
        parts: tables.map((table) => {
          const rows = Array.from(table.tBodies[0].rows);
          return {
            header: table.tHead.rows[0].cells.length,
            rows: rows.length,
            pages: Array.from(new Set(rows.map((row) => pager.columnOf(row)))),
            headPage: pager.columnOf(table.tHead),
          };
        }),
        rows: tables.reduce(
          (sum, table) => sum + table.tBodies[0].rows.length,
          0,
        ),
      };
    });
    ensure(
      "lesson 0: the kana chart starts a page and fills whole pages under repeated headers (DF-22)",
      chart.sectionPage > chart.before &&
        chart.parts.length >= 2 &&
        chart.rows === 11 &&
        chart.parts.every(
          (part, index) =>
            part.header === 6 &&
            part.pages.length === 1 &&
            part.pages[0] === part.headPage &&
            part.headPage === chart.sectionPage + index,
        ),
      chart,
    );
    await roundPage.evaluate((page) => {
      const select = document.querySelector("#tbReader .book-page-select");
      select.value = String(page);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, chart.sectionPage);
    await settle(roundPage);
    await roundPage
      .locator("#tbReader .tb-section-kana .tb-kana-sound")
      .nth(7)
      .click();
    await settle(roundPage);
    const card = await roundPage.evaluate(() => {
      const detail = document.querySelector("#tbReader .tb-kana-detail");
      const box = detail.getBoundingClientRect();
      const footer = document
        .querySelector("#tbReader .book-footer")
        .getBoundingClientRect();
      return {
        open: detail.hasAttribute("data-mobile-kana-open"),
        position: getComputedStyle(detail).position,
        bottom: box.bottom,
        footer: footer.top,
        text: detail.textContent.trim().slice(0, 12),
      };
    });
    await back(roundPage);
    const cardClosed = await roundPage.evaluate(() => ({
      open: !!document.querySelector("[data-mobile-kana-open]"),
      module: window.ModuleSwitcher.getCurrentModule(),
    }));
    ensure(
      "lesson 0: a tapped kana opens its detail as a card above the footer; Back closes it (DF-22)",
      card.open &&
        card.position === "fixed" &&
        card.bottom <= card.footer &&
        /^く/.test(card.text) &&
        !cardClosed.open &&
        cardClosed.module === "lesson",
      { card, cardClosed },
    );
    ensure(
      "round two: runtime errors",
      roundApp.errors.length === 0,
      roundApp.errors.slice(0, 8),
    );
  } finally {
    await roundApp.page.close();
  }

  // Android's "remove animations" (here the reduced-motion preference):
  // nothing slides or fades (DF-20).
  const stillApp = await openApp(
    browser,
    { width: 393, height: 844 },
    { reducedMotion: "reduce" },
  );
  try {
    const stillPage = stillApp.page;
    await ready(stillPage);
    await switchModule(stillPage, "vocab");
    await stillPage.waitForSelector("#card-container .book-frame");
    await stillPage
      .locator("#card-container .cc-card .cc-word")
      .first()
      .click();
    const still = await stillPage.evaluate(() => ({
      motion: document.documentElement.dataset.mobileMotion,
      shift: new DOMMatrix(
        getComputedStyle(
          document.querySelector(".detail-panel.anchored-detail-open"),
        ).transform,
      ).m41,
      entering: !!document.querySelector("[data-mobile-enter]"),
    }));
    await stillPage.dispatchEvent("body", "backbutton");
    const stillClosed = await stillPage.evaluate(
      () => document.documentElement.dataset.mobileTopLayer,
    );
    ensure(
      "transitions: none with reduced motion; Back closes at once (DF-20)",
      still.motion === "reduce" &&
        still.shift === 0 &&
        !still.entering &&
        stillClosed === "none",
      { still, stillClosed },
    );
  } finally {
    await stillApp.page.close();
  }

  // WebView 83 has no color-mix(): apply the mobile fallbacks for it
  // directly (this Chromium has color-mix()) and measure Today's hero.
  const probeLegacyHero = (page) =>
    page.evaluate(async () => {
      // Let colour transitions (a look change, the probe itself) finish.
      const transitions = () => {
        document.body.getBoundingClientRect();
        return Promise.race([
          Promise.all(
            document
              .getAnimations()
              .filter((animation) => animation instanceof CSSTransition)
              .map((animation) => animation.finished.catch(() => {})),
          ),
          new Promise((resolve) => setTimeout(resolve, 1000)),
        ]);
      };
      await transitions();
      const fallback = [];
      const removedInsets = [];
      // DF-14b hides the hero on a phone page; a wider window still draws
      // it, so the probe shows it again while it measures.
      const shownCards = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if (
            rule.selectorText?.includes(".dashboard-start-card") &&
            rule.style?.getPropertyValue("display") === "none"
          ) {
            shownCards.push(rule.style);
            rule.style.removeProperty("display");
          }
          if (
            rule.selectorText ===
              ".dashboard-shell .dashboard-start-card::before" &&
            rule.style.getPropertyValue("inset")
          ) {
            removedInsets.push({
              style: rule.style,
              value: rule.style.getPropertyValue("inset"),
              priority: rule.style.getPropertyPriority("inset"),
            });
            rule.style.removeProperty("inset");
          }
          if (
            rule.conditionText?.includes("not") &&
            rule.conditionText.includes("color-mix")
          ) {
            for (const nested of rule.cssRules) {
              if (nested.selectorText?.includes(".dashboard-shell"))
                fallback.push(nested.cssText);
            }
          }
        }
      }
      const probe = document.createElement("style");
      probe.id = "legacyHeroProbe";
      probe.textContent = fallback.join("\n");
      document.head.appendChild(probe);
      await transitions();
      const card = document.querySelector(".dashboard-start-card");
      const swatch = (token) => {
        const sample = document.createElement("i");
        sample.style.color = `var(${token})`;
        document.body.appendChild(sample);
        const value = getComputedStyle(sample).color;
        sample.remove();
        return value;
      };
      const background = getComputedStyle(card).backgroundColor;
      const luminance = (value) => {
        const channels = value
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((v) => v / 255)
          .map((v) =>
            v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
          );
        return (
          channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
        );
      };
      const paper = luminance(background);
      const foregrounds = Array.from(
        card.querySelectorAll(
          "h2, .dashboard-start-meta, .dashboard-card-kicker",
        ),
      ).map((node) => {
        const color = getComputedStyle(node).color;
        const ink = luminance(color);
        return {
          color,
          contrast:
            (Math.max(ink, paper) + 0.05) / (Math.min(ink, paper) + 0.05),
        };
      });
      const wave = getComputedStyle(card, "::before");
      const result = {
        preset: document.documentElement.dataset.appearancePreset,
        rules: fallback.length,
        background,
        raised: swatch("--surface-raised"),
        accent: swatch("--c-primary"),
        foregrounds,
        primary: getComputedStyle(card.querySelector(".dashboard-primary"))
          .backgroundColor,
        seal: getComputedStyle(card, "::after").content,
        wave: {
          removedInsets: removedInsets.length,
          width: parseFloat(wave.width),
          height: parseFloat(wave.height),
          cardWidth: card.clientWidth,
          cardHeight: card.clientHeight,
          background: wave.backgroundImage,
        },
      };
      removedInsets.forEach(({ style, value, priority }) =>
        style.setProperty("inset", value, priority),
      );
      shownCards.forEach((style) => style.setProperty("display", "none"));
      result.hiddenOnPhone = shownCards.length;
      return result;
    });

  const app = await openApp(browser, { width: 393, height: 844 });
  const page = app.page;
  try {
    await ready(page);
    // 简洁, the web default since UI-ART-25, draws Today as a plain card from
    // palette values alone; the fallbacks belong to the other looks' ink desk.
    const plainHero = await probeLegacyHero(page);
    try {
      ensure(
        "legacy color mixing: 简洁 Today stays a plain legible card",
        plainHero.preset === "plain" &&
          plainHero.rules > 0 &&
          plainHero.background === plainHero.raised &&
          plainHero.foregrounds.length >= 3 &&
          plainHero.foregrounds.every((entry) => entry.contrast >= 4.5) &&
          plainHero.primary === plainHero.accent &&
          plainHero.seal === "none", // ART-13: no red seal on a phone page
        plainHero,
      );
      await screenshot(page, "393x844-legacy-color-plain");
    } finally {
      await page.evaluate(() =>
        document.getElementById("legacyHeroProbe")?.remove(),
      );
    }
    const savedAppearance = await page.evaluate(() => {
      const saved = window.AppAppearance.get();
      const next = window.AppAppearance.get();
      next.light = window.AppAppearance.fromPreset("paper", "light");
      next.dark = window.AppAppearance.fromPreset("paper", "dark");
      window.AppAppearance.save(next);
      return saved;
    });
    const legacyHero = await probeLegacyHero(page);
    try {
      ensure(
        "legacy color mixing: ink hero keeps legible text and vermilion action",
        legacyHero.preset === "paper" &&
          legacyHero.rules > 0 &&
          legacyHero.background === "rgb(34, 43, 44)" &&
          legacyHero.foregrounds.length >= 3 &&
          legacyHero.foregrounds.every((entry) => entry.contrast >= 4.5) &&
          legacyHero.primary === "rgb(178, 63, 42)" &&
          legacyHero.seal === "none", // ART-13: no red seal on a phone page
        legacyHero,
      );
      ensure(
        "legacy inset: branded wave fills the original right-hand area",
        legacyHero.wave.removedInsets === 1 &&
          Math.abs(legacyHero.wave.width - legacyHero.wave.cardWidth * 0.62) <
            2 &&
          Math.abs(legacyHero.wave.height - legacyHero.wave.cardHeight) < 2 &&
          legacyHero.wave.background.includes("radial-gradient"),
        legacyHero.wave,
      );
      await screenshot(page, "393x844-legacy-color-fallback");
    } finally {
      await page.evaluate((saved) => {
        document.getElementById("legacyHeroProbe")?.remove();
        window.AppAppearance.save(saved);
      }, savedAppearance);
    }
    await page.locator("[data-dashboard-action='open-plan']").first().click();
    await page.locator("#dashboardPlanMinutes").fill("35");
    await page.locator("#dashboardPlanWords").fill("10");
    await page
      .locator("[data-dashboard-plan-form] button[type='submit']")
      .click();
    const plan = await page.evaluate(() => window.ProgressStore.getPlan());
    ensure(
      "dashboard: saves local plan",
      plan.dailyMinutes === 35 && plan.dailyNewWords === 10,
      { minutes: plan.dailyMinutes, words: plan.dailyNewWords },
    );
    const cell = page.locator("#dashboardMain .cg-cell[tabindex='0']");
    await cell.click();
    const date = await cell.getAttribute("data-date");
    await cell.press("ArrowLeft");
    ensure(
      "dashboard: heatmap keyboard date",
      (await page
        .locator("#dashboardMain .cg-cell[tabindex='0']")
        .getAttribute("data-date")) !== date,
      date,
    );
    await page.locator("[data-dashboard-action='open-plan']").first().click();
    await back(page);
    ensure(
      "dashboard: native Back closes plan",
      !(await page.locator("[data-dashboard-plan-form]").isVisible()),
      "plan",
    );

    // The bars slide away on a touch scroll down and return on the way up and
    // at the top (phone shell, b569e23); app-made scrolls never hide them.
    const chromeAutoHide = await page.evaluate(async () => {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const chrome = () => document.documentElement.dataset.mobileChrome;
      const geometry = () => ({
        barBottom: document
          .getElementById("mobileAppBar")
          .getBoundingClientRect().bottom,
        navTop: document
          .getElementById("mobileBottomNav")
          .getBoundingClientRect().top,
        viewport: window.innerHeight,
      });
      const scroller = document.getElementById("dashboardMain");
      // The phone home (DF-14b) can be shorter than the scroll path below;
      // room at its end lets the touch scroll run its full length.
      const room = document.createElement("div");
      room.style.height = "1200px";
      scroller.appendChild(room);
      const touch = (type) =>
        scroller.dispatchEvent(new Event(type, { bubbles: true }));
      const scrollTo = async (from, to, step) => {
        for (let y = from; step > 0 ? y <= to : y >= to; y += step) {
          scroller.scrollTop = y;
          await pause(30);
        }
        await pause(350);
      };
      const result = { initial: chrome() };
      scroller.scrollTop = 300;
      await pause(150);
      result.programmatic = chrome();
      scroller.scrollTop = 0;
      await pause(350);
      touch("touchstart");
      await scrollTo(30, 330, 30);
      result.afterDown = chrome();
      result.hidden = geometry();
      await scrollTo(310, 270, -10);
      result.afterUp = chrome();
      result.shown = geometry();
      await scrollTo(300, 600, 30);
      result.hiddenAgain = chrome();
      scroller.scrollTop = 0;
      await pause(350);
      result.atTop = chrome();
      touch("touchend");
      room.remove();
      return result;
    });
    ensure(
      "dashboard: app-made scrolls keep the bars",
      chromeAutoHide.initial === "visible" &&
        chromeAutoHide.programmatic === "visible",
      chromeAutoHide,
    );
    ensure(
      "dashboard: bars hide on a touch scroll down",
      chromeAutoHide.afterDown === "hidden" &&
        chromeAutoHide.hidden.barBottom <= 0.5 &&
        chromeAutoHide.hidden.navTop >= chromeAutoHide.hidden.viewport - 0.5,
      chromeAutoHide,
    );
    ensure(
      "dashboard: bars return on the way up and at the top",
      chromeAutoHide.afterUp === "visible" &&
        chromeAutoHide.shown.barBottom >= 40 &&
        chromeAutoHide.hiddenAgain === "hidden" &&
        chromeAutoHide.atTop === "visible",
      chromeAutoHide,
    );
    // Let the post-touch fling window lapse before app-driven scrolls.
    await page.waitForTimeout(1600);

    await switchModule(page, "vocab");
    await exercisePager(page, "#card-container .book-frame", "vocabulary");
    // ART-12: the catalog opens at the plan's target level (N5 by default).
    // ART-17: the app bar counts entries, and a phone page is one screen.
    // ART-21: every row carries its level mark; the gloss leads, then the
    // part of speech, with the kana small beside the headword.
    const wordRows = await page.evaluate(() => {
      // Page-turn snapshots keep copies of rows with their tools removed.
      const cards = [
        ...document.querySelectorAll("#card-container .cc-book-body .cc-card"),
      ].filter(
        (card) =>
          card.style.display !== "none" &&
          card.querySelector(".cc-card-head")?.style.display !== "none",
      );
      const rect = (node) => node.getBoundingClientRect();
      const first = cards[0];
      const word = first.querySelector(".cc-word");
      const reading = first.querySelector(".cc-reading");
      const meaning = first.querySelector(".cc-meaning");
      const pos = first.querySelector(".cc-pos-badge");
      const visible = (node) => {
        const style = getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden";
      };
      return {
        levels: [...new Set(cards.map((card) => card.dataset.level))],
        firstLevel: first.dataset.level,
        marks: cards.filter((card) => {
          const mark = card.querySelector(".cc-level");
          return mark && visible(mark) && !mark.hasAttribute("aria-hidden");
        }).length,
        cards: cards.length,
        unmarked: cards
          .filter((card) => {
            const mark = card.querySelector(".cc-level");
            return !(
              mark &&
              visible(mark) &&
              !mark.hasAttribute("aria-hidden")
            );
          })
          .slice(0, 3)
          .map((card) => card.outerHTML.slice(0, 200)),
        aside: document.getElementById("mobileRunningAside").textContent.trim(),
        count: first.querySelector(".cc-meta-count")
          ? getComputedStyle(first.querySelector(".cc-meta-count")).display
          : "none",
        target: first.querySelector(".cc-card-primary")
          ? first.querySelector(".cc-card-primary").getClientRects().length
          : 0,
        meaningWeight: meaning
          ? Number(getComputedStyle(meaning).fontWeight)
          : 0,
        meaningFirst:
          !!meaning && (!pos || rect(meaning).left < rect(pos).left),
        readingBesideWord:
          !reading ||
          (Math.abs(rect(reading).bottom - rect(word).bottom) < 14 &&
            rect(reading).left >= rect(word).right - 1 &&
            parseFloat(getComputedStyle(reading).fontSize) <
              parseFloat(getComputedStyle(word).fontSize)),
      };
    });
    ensure(
      "vocabulary: the catalog opens at the plan's target level",
      wordRows.firstLevel === "N5",
      wordRows,
    );
    ensure(
      "vocabulary: the app bar counts entries, not groups",
      /^1–\d+ \/ [\d,]{2,} 词$/.test(wordRows.aside),
      wordRows.aside,
    );
    ensure(
      "vocabulary: every row carries its level mark",
      wordRows.cards > 3 && wordRows.marks === wordRows.cards,
      wordRows,
    );
    ensure(
      "vocabulary: a row reads gloss then part of speech, reading beside the word, no tag count or target",
      wordRows.meaningWeight >= 600 &&
        wordRows.meaningFirst &&
        wordRows.readingBesideWord &&
        wordRows.count === "none" &&
        wordRows.target === 0,
      wordRows,
    );
    ensure(
      "vocabulary: dictionary entries",
      (await page.locator(".cc-book-body .cc-word[lang='ja']").count()) > 0,
      await page.locator(".cc-book-body .cc-word").count(),
    );
    const entryRules = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.borderBottom = "1px solid var(--c-border-soft)";
      document.body.appendChild(probe);
      const hairline = getComputedStyle(probe).borderBottomColor;
      probe.remove();
      return {
        hairline,
        rules: [...document.querySelectorAll(".cc-book-body .cc-card")]
          .slice(0, 3)
          .map((card) => {
            const style = getComputedStyle(card);
            return `${style.borderBottomStyle} ${style.borderBottomWidth} ${style.borderBottomColor}`;
          }),
      };
    });
    ensure(
      "vocabulary: entries part with the grammar pages' hairline",
      entryRules.rules.length === 3 &&
        entryRules.rules.every(
          (rule) => rule === `solid 1px ${entryRules.hairline}`,
        ),
      entryRules,
    );
    const listHead = await page.locator("#mobileRunningTitle").textContent();
    await page.locator(".cc-book-body .cc-card-body").first().click();
    await page
      .locator("#detailPanel.anchored-detail-open")
      .waitFor({ state: "visible" });
    // An open entry is a page under the app bar: the running head names it
    // and Back closes it, so the panel's heading row and close button go.
    const namedEntry = () => {
      const word = document.querySelector(
        "#detailPanel .vocab-detail-title-row h3",
      );
      return (
        !!word &&
        document.getElementById("mobileRunningTitle").textContent.trim() ===
          word.textContent.trim()
      );
    };
    await page
      .waitForFunction(namedEntry, null, { timeout: 5000 })
      .catch(() => {});
    const wordHead = await page.evaluate(() => ({
      running: document.getElementById("mobileRunningTitle").textContent.trim(),
      aside: document.getElementById("mobileRunningAside").textContent.trim(),
      word:
        document
          .querySelector("#detailPanel .vocab-detail-title-row h3")
          ?.textContent.trim() || "",
      heading: getComputedStyle(
        document.querySelector("#detailPanel .detail-panel-header"),
      ).display,
      gap:
        document.getElementById("detailContent").getBoundingClientRect().top -
        document.getElementById("mobileAppBar").getBoundingClientRect().bottom,
    }));
    ensure(
      "vocabulary: an open entry is named in the running head, with no heading row",
      !!wordHead.word &&
        wordHead.running === wordHead.word &&
        wordHead.aside === "词汇详情" &&
        wordHead.heading === "none" &&
        Math.abs(wordHead.gap) <= 1,
      wordHead,
    );
    // ART-10: examples come before the folded word info, 收藏 is the app
    // bar's star, and the other study actions are plain 44 px rows.
    const entryLayout = await page.evaluate(() => {
      const entry = document.querySelector("#detailContent .vocab-detail");
      const examples = entry.querySelector(".vocab-detail-examples");
      const info = entry.querySelector("details.vocab-detail-info");
      const example = entry.querySelector(".vocab-detail-example");
      const row = entry.querySelector("#detailBtnSwitchList");
      const rowStyle = getComputedStyle(row);
      const source = entry.querySelector("#detailBtnFavorite");
      const star = document.getElementById("mobileDetailFavorite");
      const starBox = star.getBoundingClientRect();
      return {
        examplesFirst:
          !info ||
          !!(
            examples.compareDocumentPosition(info) &
            Node.DOCUMENT_POSITION_FOLLOWING
          ),
        infoClosed: !info || !info.open,
        exampleOnFirstScreen:
          !!example &&
          example.getBoundingClientRect().bottom <= window.innerHeight,
        starVisible:
          !star.hidden &&
          getComputedStyle(star).visibility === "visible" &&
          starBox.width >= 44 &&
          starBox.height >= 44 &&
          !!star.closest("#mobileAppBar"),
        starPressed: star.getAttribute("aria-pressed"),
        sourcePressed: source.getAttribute("aria-pressed"),
        sourceDisplay: getComputedStyle(source).display,
        rowBorder: rowStyle.borderTopWidth,
        rowHeight: row.getBoundingClientRect().height,
      };
    });
    ensure(
      "vocabulary: entry shows examples before the folded word info, with plain action rows",
      entryLayout.examplesFirst &&
        entryLayout.infoClosed &&
        entryLayout.exampleOnFirstScreen &&
        entryLayout.starVisible &&
        entryLayout.starPressed === entryLayout.sourcePressed &&
        entryLayout.sourceDisplay === "none" &&
        entryLayout.rowBorder === "0px" &&
        entryLayout.rowHeight >= 44,
      entryLayout,
    );
    const starWas = await page
      .locator("#mobileDetailFavorite")
      .getAttribute("aria-pressed");
    await page.locator("#mobileDetailFavorite").click();
    await page.waitForFunction(
      (was) =>
        document
          .getElementById("mobileDetailFavorite")
          .getAttribute("aria-pressed") !== was &&
        document
          .getElementById("detailBtnFavorite")
          .getAttribute("aria-pressed") ===
          document
            .getElementById("mobileDetailFavorite")
            .getAttribute("aria-pressed"),
      starWas,
    );
    // Put the entry back as it was.
    await page.locator("#mobileDetailFavorite").click();
    await page.waitForFunction(
      (was) =>
        document
          .getElementById("mobileDetailFavorite")
          .getAttribute("aria-pressed") === was,
      starWas,
    );
    ensure(
      "vocabulary: the app bar star toggles the entry's favourite",
      true,
      starWas,
    );
    await page.locator("#mobileAppBarBack").click();
    await page
      .locator("#detailPanel.anchored-detail-open")
      .waitFor({ state: "hidden" });
    ensure(
      "vocabulary: Back gives the running head back to the page",
      (await page.locator("#mobileRunningTitle").textContent()) === listHead,
      {
        listHead,
        now: await page.locator("#mobileRunningTitle").textContent(),
      },
    );
    ensure(
      "vocabulary: dictionary detail preserves page",
      (await page.locator("#card-container .book-page-select").inputValue()) ===
        "0",
      await page.locator("#card-container .book-page-select").inputValue(),
    );
    // ART-22: reading the page aloud starts from the sheet, and the bar
    // shows the read button only to stop it. DF-12: the sheet's 随机学 20 词
    // is the one study entry.
    ensure(
      "vocabulary: the bar shows the read button only to stop",
      await page.evaluate(
        () => document.getElementById("mobileVocabReadPage").hidden,
      ),
      "shown while not reading",
    );
    await filter(page);
    ensure(
      "vocabulary: the sheet offers 随机学 20 词",
      /^随机学 \d+ 词$/.test(
        (
          await page
            .locator(
              '#mobileSheetCurrent .mobile-sheet-action[data-sheet-action="study"]',
            )
            .textContent()
        ).trim(),
      ),
      await page.locator("#mobileSheetCurrent").textContent(),
    );
    await page
      .locator("#mobileSheetCurrent .mobile-sheet-action", {
        hasText: "顺序朗读本页",
      })
      .click();
    await page.waitForFunction(
      () =>
        window.VocabTTS?.isPlaying &&
        !document.querySelector("#mobileFilterSheet:not([hidden])") &&
        !document.querySelector("#mobileVocabReadPage").hidden &&
        document
          .querySelector("#mobileVocabReadPage")
          ?.getAttribute("aria-pressed") === "true",
    );
    await page.locator("#mobileVocabReadPage").click();
    await page.waitForFunction(
      () =>
        !window.VocabTTS?.isPlaying &&
        document.querySelector("#mobileVocabReadPage").hidden &&
        document
          .querySelector("#mobileVocabReadPage")
          ?.getAttribute("aria-pressed") === "false",
    );
    ensure(
      "vocabulary: page read starts from the sheet and stops from the bar",
      (await page
        .locator("#mobileVocabReadPage")
        .getAttribute("aria-pressed")) === "false",
      await page.locator("#mobileVocabReadPage").getAttribute("aria-pressed"),
    );
    await headingTools(page, "#vocabMain", "vocabulary");
    const vocabSheet = await page.evaluate(() => {
      const group = document.querySelector(
        "#mobileFilterContent .sidebar-view-group",
      );
      return {
        meta: document
          .querySelector("#mobileSheetCurrent .mobile-sheet-current-meta")
          ?.textContent.trim(),
        group: group ? getComputedStyle(group).display : "none",
        sort: [...document.querySelectorAll("#ccSortSelect option")].map(
          (option) => option.textContent,
        ),
        sortValue: document.querySelector("#ccSortSelect")?.value,
      };
    });
    ensure(
      "vocabulary: the sheet no longer counts groups as pages",
      !/第\s*\d+\s*\/\s*\d+\s*页/.test(vocabSheet.meta || "") &&
        vocabSheet.group === "none" &&
        vocabSheet.sort[0] === "按等级" &&
        vocabSheet.sortValue === "level",
      vocabSheet,
    );
    await filter(page);
    // DF-13: 高级筛选 and 当前视图工具 open in place; 词性, 领域 and 语义标签
    // are chips under a row naming the choice, not Android's select popup.
    await page.locator(".advanced-filters > summary").click();
    await settle(page);
    const advanced = await page.evaluate(() => ({
      open: document.querySelector("#mobileFilterContent .advanced-filters")
        .open,
      subpage: !document.getElementById("mobileFilterSubpage").hidden,
      heads: [
        ...document.querySelectorAll(
          "#mobileFilterContent .advanced-filters .mobile-choice-head",
        ),
      ].map((head) => head.querySelector(".mobile-choice-name").textContent),
      selects: [
        ...document.querySelectorAll("#mobileFilterContent select"),
      ].filter((select) => select.getBoundingClientRect().height > 0).length,
    }));
    ensure(
      "vocabulary: advanced filters open in place as choice rows",
      advanced.open &&
        !advanced.subpage &&
        advanced.heads.join() === "词性,领域,语义标签" &&
        advanced.selects === 0,
      advanced,
    );
    const allWords = await page.evaluate(
      () => window.appConfig.getCurrentWords().length,
    );
    await page
      .locator("#mobileFilterContent .advanced-filters .mobile-choice-head")
      .first()
      .click();
    await page
      .locator("#posSelectMobileChoices .mobile-choice-chip", {
        hasText: /^名词$/,
      })
      .click();
    await page.waitForFunction(
      (count) => window.appConfig.getCurrentWords().length < count,
      allWords,
    );
    const posChoice = await page.evaluate(() => ({
      value: document.getElementById("posSelect").value,
      pressed: [
        ...document.querySelectorAll(
          "#posSelectMobileChoices [aria-pressed='true']",
        ),
      ].map((chip) => chip.textContent),
      head: document.querySelector(
        "#mobileFilterContent .advanced-filters .mobile-choice-head .mobile-choice-value",
      ).textContent,
      expanded: document
        .querySelector(
          "#mobileFilterContent .advanced-filters .mobile-choice-head",
        )
        .getAttribute("aria-expanded"),
    }));
    ensure(
      "vocabulary: a part-of-speech chip filters and names the choice",
      posChoice.value === "noun" &&
        posChoice.pressed.join() === "名词" &&
        posChoice.head === "名词" &&
        posChoice.expanded === "true",
      posChoice,
    );
    await page
      .locator("#posSelectMobileChoices .mobile-choice-chip", {
        hasText: /^全部$/,
      })
      .click();
    await page.waitForFunction(
      (count) => window.appConfig.getCurrentWords().length === count,
      allWords,
    );
    await page.locator(".advanced-filters > summary").click();
    await page.locator(".sidebar-tool-section > summary").click();
    await settle(page);
    const cardTools = await page.evaluate(() => {
      const shown = (node) => !!node && node.getBoundingClientRect().height > 0;
      const meaning = document.getElementById("ccMeaningToggle");
      return {
        subpage: !document.getElementById("mobileFilterSubpage").hidden,
        sort: shown(document.getElementById("ccSortSelect")?.closest("label")),
        perPage: shown(
          document.getElementById("ccPerPageSelect")?.closest("label"),
        ),
        copies: ["ccStartStudy", "ccReadPage"].filter((id) =>
          shown(document.getElementById(id)),
        ),
        meaning: shown(meaning) && getComputedStyle(meaning, "::after").content,
        meaningWidth: Math.round(meaning.getBoundingClientRect().width),
        batchWidth: Math.round(
          document.getElementById("ccBatchToggle").getBoundingClientRect()
            .width,
        ),
      };
    });
    ensure(
      "vocabulary: card tools open in place, one row each, no 排序 or 每页",
      !cardTools.subpage &&
        !cardTools.sort &&
        !cardTools.perPage &&
        !cardTools.copies.length &&
        /释义/.test(cardTools.meaning) &&
        cardTools.meaningWidth > 280 &&
        cardTools.batchWidth === cardTools.meaningWidth,
      cardTools,
    );
    await page.locator("#ccBatchToggle").click();
    ensure(
      "vocabulary: 批量 lists its actions under its row",
      await page.evaluate(() => {
        const toggle = document
          .getElementById("ccBatchToggle")
          .getBoundingClientRect();
        const first = document
          .querySelector("#vocabViewTools .cc-batch-item")
          .getBoundingClientRect();
        return first.top >= toggle.bottom && first.height >= 44;
      }),
      "batch menu below its row",
    );
    await page.locator("#ccBatchToggle").click();
    await page.locator(".sidebar-tool-section > summary").click();
    await page.locator("#searchInput").fill("学校");
    await page.waitForFunction(
      () =>
        window.appConfig.getCurrentWords().length > 0 &&
        window.appConfig.getCurrentWords().length <
          window.taxonomyManager.allWords.length,
    );
    const found = await page.evaluate(
      () => window.appConfig.getCurrentWords().length,
    );
    await page.locator("#resetFiltersBtn").click();
    await page.waitForFunction(
      (count) => window.appConfig.getCurrentWords().length > count,
      found,
    );
    ensure(
      "vocabulary: search and clear controls",
      (await page.locator("#searchInput").inputValue()) === "",
      found,
    );
    await page.locator("[data-mobile-vocab-mode='list']").click();
    await page.waitForSelector("#listSortSelectMobileChoices", {
      state: "attached",
    });
    await page.locator(".sidebar-tool-section > summary").click();
    await settle(page);
    const listTools = await page.evaluate(() =>
      ["listSortSelect", "pageSizeSelect"].map((id) => {
        const track = document.getElementById(id + "MobileChoices");
        return {
          id,
          shown: !!track && track.getBoundingClientRect().height >= 44,
          chips: track ? track.children.length : 0,
          pressed: track
            ? [...track.querySelectorAll("[aria-pressed='true']")].map(
                (chip) => chip.textContent,
              )
            : [],
        };
      }),
    );
    ensure(
      "vocabulary: the list view's 排序 and 每页 are segmented tracks",
      listTools.every(
        (tool) => tool.shown && tool.chips >= 3 && tool.pressed.length === 1,
      ),
      listTools,
    );
    await page.locator(".sidebar-tool-section > summary").click();
    await closeFilter(page);
    await page.locator("#listTable .list-row").first().click();
    await page
      .locator("#detailPanel.anchored-detail-open")
      .waitFor({ state: "visible" });
    await back(page);
    ensure(
      "vocabulary: list detail Back",
      !(await page.locator("#detailPanel.anchored-detail-open").count()),
      "closed",
    );
    // Dictionary rows (phone shell, 516423f): readings under the word,
    // checkboxes only while selecting, a tap ticks instead of opening, and a
    // one-line pager that starts each page at the top.
    const listLayout = await page.evaluate(async () => {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const container = document.getElementById("list-container");
      const rows = () => [...container.querySelectorAll("tr.list-row")];
      const first = rows()[0];
      const result = {
        readings: rows().filter((row) =>
          row.querySelector(".mobile-list-reading"),
        ).length,
        checkHidden:
          getComputedStyle(first.querySelector(".col-check")).display ===
          "none",
        favTarget: (() => {
          const rect = first
            .querySelector(".list-fav-btn")
            .getBoundingClientRect();
          return rect.width >= 44 && rect.height >= 44;
        })(),
        pagerNumbersHidden: [
          ...container.querySelectorAll(".pagination .btn-page-num"),
        ].every((button) => getComputedStyle(button).display === "none"),
        pageStatus:
          container.querySelector(".mobile-page-status")?.textContent || "",
      };
      container.querySelector('[data-mobile-list-select="toggle"]').click();
      await pause(100);
      result.checkShown =
        getComputedStyle(rows()[0].querySelector(".col-check")).display !==
        "none";
      rows()[1].querySelector(".col-word").click();
      await pause(100);
      result.tickedByTap = window.appConfig.listView.selectedIndices.size;
      result.layerWhileSelecting =
        document.documentElement.dataset.mobileTopLayer || "none";
      container.querySelector('[data-mobile-list-select="toggle"]').click();
      await pause(150);
      result.clearedOnDone = window.appConfig.listView.selectedIndices.size;
      container.scrollTop = container.scrollHeight;
      await pause(100);
      document.getElementById("pageNext").click();
      await pause(150);
      result.nextPage = window.appConfig.listView.currentPage;
      result.nextScrollTop = container.scrollTop;
      document.getElementById("pagePrev").click();
      await pause(150);
      return result;
    });
    ensure(
      "vocabulary: list shows dictionary rows",
      listLayout.readings >= 1 &&
        listLayout.checkHidden &&
        listLayout.favTarget &&
        listLayout.pagerNumbersHidden &&
        /^第 1 \/ \d+ 页$/.test(listLayout.pageStatus),
      listLayout,
    );
    ensure(
      "vocabulary: list selection ticks rows and clears when done",
      listLayout.checkShown &&
        listLayout.tickedByTap === 1 &&
        listLayout.layerWhileSelecting === "none" &&
        listLayout.clearedOnDone === 0,
      listLayout,
    );
    ensure(
      "vocabulary: list pager opens the next page at its top",
      listLayout.nextPage === 2 && listLayout.nextScrollTop === 0,
      listLayout,
    );
    await filter(page);
    await page.locator("[data-mobile-vocab-mode='study']").click();
    await closeFilter(page);
    await page.locator("[data-practice-mode='classic']").click();
    await page.locator("#btnStartStudy").click();
    await page.locator("#flashcard").click();
    ensure(
      "study: public setup starts and flips",
      (await page.locator("#flashcard").getAttribute("aria-pressed")) ===
        "true",
      await page.locator("#flashcard").getAttribute("aria-pressed"),
    );
    const answered = await page.evaluate(
      () =>
        window.appConfig.studyMode.queue[
          window.appConfig.studyMode.currentIndex
        ].index,
    );
    await page.locator("[data-fb='known']").click();
    await page.waitForFunction(
      (index) => window.StudyStorage.getWordStatus(index).status === "known",
      answered,
    );
    ensure(
      "study: saves answer before advancing",
      await page.evaluate(
        (index) =>
          window.appConfig.studyMode.queue[
            window.appConfig.studyMode.currentIndex
          ].index !== index,
        answered,
      ),
      answered,
    );
    await page.locator("[data-study-exit]").click();
    await page
      .locator("#card-container .book-frame")
      .waitFor({ state: "visible" });

    await switchModule(page, "grammar");
    await exercisePager(page, "#gmGrammarList .book-frame", "grammar");
    // ART-12, ART-17, ART-18: N5 first, an entry range in the app bar, one
    // form per title and no repeated connection, several rows to a screen.
    const grammarRows = await page.evaluate(() => {
      // Page-turn snapshots keep empty shells of the rows.
      const cards = [
        ...document.querySelectorAll("#gmGrammarList .gm-card"),
      ].filter((card) => card.querySelector(".gm-card-title"));
      const body = document.querySelector("#gmGrammarList .book-body");
      const bounds = body.getBoundingClientRect();
      const onScreen = cards.filter((card) => {
        const rect = card.getBoundingClientRect();
        return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
      });
      const text = (card, selector) =>
        card.querySelector(selector)?.textContent.trim() || "";
      const plain = (value) =>
        value
          .replace(/\s+/g, "")
          .replace(/／/g, "/")
          .replace(/^[～〜]+/, "");
      return {
        firstLevel: cards[0].querySelector(".gm-card-level").textContent.trim(),
        aside: document.getElementById("mobileRunningAside").textContent.trim(),
        screen: onScreen.length,
        // A slash can stay inside a form: "お/ご～する", "「れる/られる」".
        slashTitles: cards.filter((card) => {
          const title =
            card.querySelector(".gm-card-title").firstChild.textContent;
          return (
            /[/／]/.test(title) &&
            !/「/.test(title) &&
            !/^[^～]*[/／][^～]*～/.test(title)
          );
        }).length,
        more: cards
          .map((card) => text(card, ".gm-card-title-more"))
          .filter(Boolean),
        repeated: cards.filter((card) => {
          const connection = card.querySelector(".gm-card-connection");
          if (!connection) return false;
          const title = card.querySelector(".gm-card-title").firstChild;
          return (
            plain(connection.lastChild.textContent) === plain(title.textContent)
          );
        }).length,
        clamp: onScreen.slice(0, 1).map((card) => {
          const style = getComputedStyle(
            card.querySelector(".gm-card-meaning"),
          );
          return style.webkitLineClamp;
        }),
      };
    });
    ensure(
      "grammar: the list opens at the plan's target level",
      grammarRows.firstLevel === "N5",
      grammarRows,
    );
    ensure(
      "grammar: the app bar counts entries, not groups",
      /^1–\d+ \/ [\d,]{2,} 条$/.test(grammarRows.aside),
      grammarRows.aside,
    );
    ensure(
      "grammar: a title is one form, the rest counted; a repeated connection is left out",
      grammarRows.slashTitles === 0 &&
        grammarRows.more.length > 0 &&
        grammarRows.more.every((label) => /^等 \d+ 种形式$/.test(label)) &&
        grammarRows.repeated === 0,
      grammarRows,
    );
    ensure(
      "grammar: a phone screen holds at least four entries, the gloss in two lines",
      grammarRows.screen >= 4 && grammarRows.clamp[0] === "2",
      grammarRows,
    );
    await headingTools(page, "#grammarMain", "grammar");
    await page.locator("#gmGrammarList .gm-card").first().click();
    await page
      .locator("#grammarDetailPanel.anchored-detail-open")
      .waitFor({ state: "visible" });
    // An open point keeps one bar of tabs above its sections: the running
    // head names it, and its level sits under the pattern; 开始练习, which
    // repeated the practice entry, is gone (DF-08). The app bar's Back, its
    // close, takes focus.
    await page
      .waitForFunction(
        () => {
          const title = document.querySelector(
            "#grammarDetailPanel .gm-detail-title",
          );
          return (
            !!title &&
            document.getElementById("mobileRunningTitle").textContent.trim() ===
              title.textContent.trim()
          );
        },
        null,
        { timeout: 5000 },
      )
      .catch(() => {});
    const pointHead = await page.evaluate(() => {
      const box = (selector) =>
        document.querySelector(selector).getBoundingClientRect();
      const header = box("#grammarDetailPanel .gm-detail-header");
      return {
        running: document
          .getElementById("mobileRunningTitle")
          .textContent.trim(),
        aside: document.getElementById("mobileRunningAside").textContent.trim(),
        title: document
          .querySelector("#grammarDetailPanel .gm-detail-title")
          .textContent.trim(),
        heading: getComputedStyle(
          document.querySelector("#grammarDetailPanel .detail-panel-header"),
        ).display,
        gap: header.top - box("#mobileAppBar").bottom,
        belowTitle:
          header.height - box("#grammarDetailPanel .gm-detail-title").height,
        tabs: box("#grammarDetailPanel .gm-detail-outline").height,
        study: getComputedStyle(document.getElementById("gmStartPractice"))
          .display,
        focus: document.activeElement?.id || "",
      };
    });
    ensure(
      "grammar: an open point is named in the running head over one bar of tabs",
      pointHead.running === pointHead.title &&
        pointHead.aside === "语法详情" &&
        pointHead.heading === "none" &&
        Math.abs(pointHead.gap) <= 1 &&
        pointHead.belowTitle <= 64 &&
        pointHead.tabs <= 46 &&
        pointHead.study === "none" &&
        pointHead.focus === "mobileAppBarBack",
      pointHead,
    );
    // ART-19: the tabs are the way between sections, so the headings are
    // anchors (open, no chevron, a tap changes nothing); the strip fades
    // toward the tabs still out of sight; example notes are folded.
    await page.locator("#gm-section-summary > summary").click();
    const anchors = await page.evaluate(() => {
      const sections = [
        ...document.querySelectorAll("#gmDetailContent .gm-detail-section"),
      ];
      const tabs = document.querySelector(
        "#grammarDetailPanel .gm-detail-outline",
      );
      return {
        sections: sections.length,
        allOpen: sections.every((section) => section.open),
        chevrons: sections.filter(
          (section) =>
            getComputedStyle(section.querySelector("summary"), "::after")
              .content !== "none",
        ).length,
        scrolls: tabs.scrollWidth > tabs.clientWidth,
        fade: getComputedStyle(tabs, "::after").position,
        notes: [...document.querySelectorAll("#gmDetailContent .gm-ex-notes")]
          .length,
        notesOpen: [
          ...document.querySelectorAll("#gmDetailContent .gm-ex-notes[open]"),
        ].length,
      };
    });
    ensure(
      "grammar: section headings are anchors, the tab bar fades, example notes fold",
      anchors.sections > 1 &&
        anchors.allOpen &&
        anchors.chevrons === 0 &&
        anchors.scrolls &&
        anchors.fade === "sticky" &&
        anchors.notesOpen === 0,
      anchors,
    );
    // A section tab focuses its summary; a tab is the point's first control.
    // WebView 83 rings both in orange even after a tap. With that
    // ring put back, a tap leaves neither ringed and a key press rings both.
    await page
      .locator(
        "#grammarDetailPanel .gm-detail-nav-btn[data-section-target='gm-section-confusable']",
      )
      .click();
    await page.waitForFunction(() =>
      document.activeElement?.matches("#gm-section-confusable > summary"),
    );
    const landing = await page.evaluate(() => {
      const content = document.getElementById("gmDetailContent");
      const tabs = document
        .querySelector("#grammarDetailPanel .gm-detail-outline")
        .getBoundingClientRect();
      return {
        gap: Math.round(
          document
            .getElementById("gm-section-confusable")
            .getBoundingClientRect().top - tabs.bottom,
        ),
        stuck: Math.round(tabs.top - content.getBoundingClientRect().top),
        atEnd:
          content.scrollTop + content.clientHeight >= content.scrollHeight - 1,
      };
    });
    ensure(
      "grammar: a section tab sets its section just under the tabs",
      landing.stuck === 0 && (Math.abs(landing.gap) <= 1 || landing.atEnd),
      landing,
    );
    // The last tab can be reached, and the active one is kept in view.
    await page
      .locator(
        "#grammarDetailPanel .gm-detail-nav-btn[data-section-target='gm-section-memory']",
      )
      .click();
    const lastTab = await page.evaluate(() => {
      const strip = document
        .querySelector("#grammarDetailPanel .gm-detail-outline")
        .getBoundingClientRect();
      const tab = document
        .querySelector(
          "#grammarDetailPanel .gm-detail-nav-btn[data-section-target='gm-section-memory']",
        )
        .getBoundingClientRect();
      return {
        active: document
          .querySelector("#grammarDetailPanel .gm-detail-nav-btn.active")
          ?.getAttribute("data-section-target"),
        inside: tab.left >= strip.left - 1 && tab.right <= strip.right + 1,
      };
    });
    ensure(
      "grammar: the active tab is scrolled into the tab bar",
      lastTab.active === "gm-section-memory" && lastTab.inside,
      lastTab,
    );
    // DF-09: the tabs follow the reader. Scrolled by hand, the tab of the
    // section under the bar is marked; a chosen tab keeps its mark.
    await settle(page);
    const followTab = async (section) => {
      if (section)
        await page.evaluate((id) => {
          const content = document.getElementById("gmDetailContent");
          const tabs = document.querySelector(
            "#grammarDetailPanel .gm-detail-outline",
          );
          const target = document.getElementById(id).querySelector("summary");
          content.scrollTop +=
            target.getBoundingClientRect().bottom -
            tabs.getBoundingClientRect().bottom +
            40;
        }, section);
      await settle(page);
      return page.evaluate(() => {
        const tabs = document.querySelector(
          "#grammarDetailPanel .gm-detail-outline",
        );
        const active = tabs.querySelector(".gm-detail-nav-btn.active");
        const strip = tabs.getBoundingClientRect();
        const tab = active.getBoundingClientRect();
        return {
          active: active.getAttribute("data-section-target"),
          marked: tabs.querySelectorAll(".gm-detail-nav-btn.active").length,
          inside: tab.left >= strip.left - 1 && tab.right <= strip.right + 1,
        };
      });
    };
    const tabOrder = await page.evaluate(() => {
      const by = (nodes, key, side) =>
        [...nodes]
          .sort(
            (a, b) =>
              a.getBoundingClientRect()[side] - b.getBoundingClientRect()[side],
          )
          .map(key)
          .join(" ");
      return {
        tabs: by(
          document.querySelectorAll("#grammarDetailPanel .gm-detail-nav-btn"),
          (tab) => tab.getAttribute("data-section-target"),
          "left",
        ),
        sections: by(
          document.querySelectorAll("#gmDetailContent .gm-detail-section"),
          (section) => section.id,
          "top",
        ),
      };
    });
    const chosenTab = await followTab();
    const intoExamples = await followTab("gm-section-examples");
    const intoConnection = await followTab("gm-section-connection");
    ensure(
      "grammar: the section tabs run in page order and follow the scrolling",
      tabOrder.tabs === tabOrder.sections &&
        chosenTab.active === "gm-section-memory" &&
        intoExamples.active === "gm-section-examples" &&
        intoExamples.inside &&
        intoExamples.marked === 1 &&
        intoConnection.active === "gm-section-connection" &&
        intoConnection.inside,
      { tabOrder, chosenTab, intoExamples, intoConnection },
    );
    // DF-04: each example list shows three; the rest fold under 更多例句
    // with their audio, and open in place.
    const detailExamples = await page.evaluate(() => {
      const body = document.querySelector(
        "#gm-section-examples .gm-detail-section-body",
      );
      const rows = [...body.children].filter((node) =>
        node.matches(".gm-ex-card, .gm-ex-simple"),
      );
      const toggles = [...body.querySelectorAll(".mobile-more-examples")];
      const folded = rows.filter((row) => row.hidden);
      return {
        rows: rows.length,
        shown: rows.filter((row) => row.getClientRects().length).length,
        toggles: toggles.map((toggle) => toggle.textContent),
        folded: folded.length,
        audio: folded.filter((row) =>
          row.querySelector("button[data-example-audio]"),
        ).length,
      };
    });
    const firstMore = page
      .locator("#gm-section-examples .mobile-more-examples")
      .first();
    let detailOpened = null;
    if (detailExamples.toggles.length) {
      await firstMore.click();
      detailOpened = await page.evaluate(() => {
        const toggle = document.querySelector(
          "#gm-section-examples .mobile-more-examples",
        );
        return {
          label: toggle.textContent,
          hidden: toggle.parentElement.querySelectorAll(
            "[data-mobile-more-example][hidden]",
          ).length,
          audio: [
            ...toggle.parentElement.querySelectorAll(
              "[data-mobile-more-example] button[data-example-audio]",
            ),
          ].filter((button) => button.getClientRects().length).length,
        };
      });
      await firstMore.click();
    }
    ensure(
      "grammar: a point's examples show three, the rest open under 更多例句",
      detailExamples.rows > 3 &&
        detailExamples.folded > 0 &&
        detailExamples.audio === detailExamples.folded &&
        detailExamples.toggles.every((label) =>
          /^更多例句（\d+）$/.test(label),
        ) &&
        detailOpened.label === "收起例句" &&
        detailOpened.hidden === 0 &&
        detailOpened.audio >= detailExamples.folded,
      { detailExamples, detailOpened },
    );
    const detailFocus = await page.evaluate(() => {
      const ring = document.createElement("style");
      ring.textContent =
        ":root :focus:focus { outline: 3px solid rgb(229, 151, 0); }";
      document.head.appendChild(ring);
      const summary = document.querySelector("#gm-section-memory > summary");
      const first = document.querySelector(
        "#grammarDetailPanel .gm-detail-nav-btn",
      );
      const ringOn = (node) => {
        node.focus({ preventScroll: true });
        return getComputedStyle(node).outlineStyle;
      };
      const result = { touch: [ringOn(first), ringOn(summary)] };
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
      result.keyboard = [ringOn(first), ringOn(summary)];
      window.dispatchEvent(new PointerEvent("pointerdown"));
      result.tapAgain = ringOn(summary);
      ring.remove();
      return result;
    });
    ensure(
      "grammar: detail focus shows no WebView ring after a tap, one after a key",
      detailFocus.touch.every((style) => style === "none") &&
        detailFocus.keyboard[0] === "solid" &&
        // The section heading is an anchor now (ART-19): script focuses it
        // for the screen reader, but Tab never lands there, so no ring.
        detailFocus.keyboard[1] === "none" &&
        detailFocus.tapAgain === "none",
      detailFocus,
    );
    const confTable = await page.evaluate(() => {
      const table = document.querySelector(
        "#gm-section-confusable .gm-conf-table",
      );
      if (!table) return { table: false };
      const cells = [...table.querySelector("tbody tr").children];
      return {
        table: true,
        display: getComputedStyle(cells[0]).display,
        grammarWidth: cells[0].getBoundingClientRect().width,
        tableWidth: table.getBoundingClientRect().width,
        headings: [...table.querySelectorAll("thead th")]
          .slice(1)
          .map((th) => th.textContent.trim()),
        names: cells
          .slice(1)
          .map((cell) =>
            getComputedStyle(cell, "::before").content.replace(/^"|"$/g, ""),
          ),
      };
    });
    ensure(
      "grammar: the comparison table reads as entries named by its headings",
      confTable.table &&
        confTable.display === "block" &&
        Math.abs(confTable.grammarWidth - confTable.tableWidth) <= 1 &&
        confTable.names.length === 3 &&
        confTable.names.join("|") === confTable.headings.join("|"),
      confTable,
    );
    await back(page);
    // DF-11a: the entry just closed keeps its tint, but no bar over its text.
    const closedEntry = await page.evaluate(() => {
      const card = document.querySelector("#gmGrammarList .gm-card-selected");
      return card
        ? {
            shadow: getComputedStyle(card).boxShadow,
            tint: getComputedStyle(card).backgroundColor,
          }
        : null;
    });
    ensure(
      "grammar: the entry closed last carries no bar over its text",
      !!closedEntry &&
        closedEntry.shadow === "none" &&
        closedEntry.tint !== "rgba(0, 0, 0, 0)",
      closedEntry,
    );
    await a11y(page, "grammar");

    // ART-15 and ART-B1 on the grammar reader: it is a reading page, so its
    // app bar button and sheet are 目录 and 本课与目录, and the sheet follows
    // a lesson shown while it is open.
    const readerLessons = await page.evaluate(async () =>
      (await window.GrammarLoader.getLessons()).map(
        (lesson) => lesson.lesson_id,
      ),
    );
    if (readerLessons.length > 1) {
      const readerState = () =>
        page.evaluate(() => {
          const button = document.getElementById("mobileAppContextButton");
          return {
            button: button.getAttribute("aria-label"),
            icon: button.dataset.mobileIcon,
            running: document
              .getElementById("mobileRunningTitle")
              .textContent.trim(),
            sheetTitle:
              document.getElementById("mobileFilterTitle").textContent,
            current: document
              .getElementById("mobileSheetCurrentTitle")
              ?.textContent.trim(),
            open: !document.getElementById("mobileFilterSheet").hidden,
            focusInside: document
              .getElementById("mobileFilterSheet")
              .contains(document.activeElement),
          };
        });
      await page.evaluate(
        (id) => window.grammarModule.showLessonReader(id),
        readerLessons[0],
      );
      await page.waitForFunction(
        () =>
          document.getElementById("mobileAppContextButton").dataset
            .mobileIcon === "list" &&
          !!document.getElementById("mobileRunningTitle").textContent.trim(),
      );
      const readerBefore = await readerState();
      await filter(page);
      const readerOpen = await readerState();
      ensure(
        "grammar reader: app bar 目录 opens 本课与目录",
        readerBefore.button === "目录" &&
          readerBefore.icon === "list" &&
          readerOpen.sheetTitle === "本课与目录" &&
          readerOpen.current === readerOpen.running,
        { readerBefore, readerOpen },
      );
      await page.evaluate(
        (id) => window.grammarModule.showLessonReader(id),
        readerLessons[1],
      );
      await page.waitForFunction((previous) => {
        const running = document
          .getElementById("mobileRunningTitle")
          .textContent.trim();
        return (
          running &&
          running !== previous &&
          document
            .getElementById("mobileSheetCurrentTitle")
            ?.textContent.trim() === running
        );
      }, readerOpen.running);
      const readerAfter = await readerState();
      ensure(
        "grammar reader: the open sheet follows a lesson shown meanwhile",
        readerAfter.open &&
          readerAfter.focusInside &&
          readerAfter.current === readerAfter.running &&
          readerAfter.running !== readerOpen.running,
        { readerOpen, readerAfter },
      );
      await closeFilter(page);
      await back(page);
      await page.waitForFunction(
        () =>
          document.getElementById("mobileAppContextButton").dataset
            .mobileIcon === "filter",
      );
      const listButton = await readerState();
      ensure(
        "grammar list: the button is 筛选 again after the reader closes",
        listButton.button === "筛选",
        listButton,
      );
    }

    await settings(page);
    await modal(page, "#mobileSettingsSheet", "settings");
    await a11y(page, "settings");
    await touch(page, "settings");
    ensure(
      "settings: default book layout",
      (await page.locator("#appReadingLayoutSelect").inputValue()) === "book",
      await page.locator("#appReadingLayoutSelect").inputValue(),
    );
    const settingsRows = await page.evaluate(() => {
      const shown = (selector) => {
        const element = document.querySelector(
          "#mobileSettingsContent " + selector,
        );
        return !!element && element.getBoundingClientRect().height > 0;
      };
      return {
        scale: shown(".app-scale-control"),
        theme: shown(".app-theme-control"),
        density: shown(".app-density-control:not(.app-reading-layout-control)"),
        layout: shown(".app-reading-layout-control"),
        appearance: shown("#appAppearanceOpen"),
      };
    });
    ensure(
      "settings: phone hides 页面缩放, 配色主题 and 布局密度 (DF-14)",
      !settingsRows.scale &&
        !settingsRows.theme &&
        !settingsRows.density &&
        settingsRows.layout &&
        settingsRows.appearance,
      settingsRows,
    );
    // 简洁 (plain) joined the presets as the web default (UI-ART-25).
    const presets = [
      "plain",
      "paper",
      "original",
      "ink",
      "nord",
      "catppuccin",
      "gruvbox",
      "ai",
      "konpeki",
      "matcha",
      "sakura",
      "kaki",
    ];
    // DF-14: the page theme is chosen at the top of 配色与字体; it applies
    // and saves at once, and the palette editor follows it.
    const pickTheme = async (mode) => {
      await page
        .locator(`#mobileAppearanceTheme [data-theme-choice='${mode}']`)
        .click();
      return page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        mode: document.documentElement.dataset.themeMode,
        saved: localStorage.getItem("jp_learning_theme"),
        select: document.getElementById("appThemeSelect").value,
        pressed: [
          ...document.querySelectorAll(
            "#mobileAppearanceTheme [aria-pressed='true']",
          ),
        ].map((button) => button.dataset.themeChoice),
        edit: document.getElementById("appearanceEditMode").value,
        dialog: document.getElementById("appearanceDialog").dataset.theme,
      }));
    };
    for (const mode of ["light", "dark"]) {
      await settings(page);
      await page.locator("#appAppearanceOpen").click();
      const picked = await pickTheme(mode);
      ensure(
        `theme: ${mode}`,
        picked.theme === mode &&
          picked.saved === mode &&
          picked.select === mode &&
          picked.pressed.join() === mode &&
          picked.edit === mode &&
          picked.dialog === mode,
        picked,
      );
      if (mode === "light") await screenshot(page, "393x844-appearance");
      ensure(
        `appearance: twelve ${mode} presets`,
        (await page.locator("#appearancePresets [data-preset]").count()) === 12,
        await page.locator("#appearancePresets [data-preset]").count(),
      );
      const before = await page.evaluate(() =>
        localStorage.getItem("jp_learning_appearance_v1"),
      );
      for (const preset of presets) {
        await page.locator(`[data-preset='${preset}']`).click();
        const state = await page
          .locator("#appearancePreview")
          .evaluate((preview) => ({
            width: Math.round(preview.getBoundingClientRect().width),
            selected: document.querySelector(
              "#appearancePresets [aria-pressed='true']",
            )?.dataset.preset,
            apply: !document.querySelector("#appearanceApply").disabled,
          }));
        ensure(
          `appearance: ${mode}/${preset} preview`,
          state.selected === preset && state.apply && state.width > 100,
          state,
        );
      }
      await page.locator("#appearanceCancel").click();
      ensure(
        `appearance: ${mode} cancel preserves saved preferences`,
        before ===
          (await page.evaluate(() =>
            localStorage.getItem("jp_learning_appearance_v1"),
          )),
        mode,
      );
      await settings(page);
      await page.locator("#appAppearanceOpen").click();
      await page.locator("#appearanceEditMode").selectOption(mode);
      await page.locator("[data-preset='paper']").click();
      await page.locator("#appearanceApply").click();
      const saved = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("jp_learning_appearance_v1")),
      );
      ensure(
        `appearance: ${mode} apply`,
        saved[mode].preset === "paper",
        saved[mode].preset,
      );
      if (mode === "dark") {
        if (await page.locator("#mobileSettingsSheet").isVisible())
          await back(page);
        for (const module of ["dashboard", "vocab", "lesson"]) {
          await switchModule(page, module);
          if (module === "lesson") await openBook(page, "KotobaFlow1");
          await screenshot(page, `393x844-${module}-dark`);
        }
      }
    }
    await settings(page);
    await page.locator("#appAppearanceOpen").click();
    const pickedAuto = await pickTheme("auto");
    ensure(
      "theme: 跟随系统 from 配色与字体",
      pickedAuto.mode === "auto" &&
        pickedAuto.saved === "auto" &&
        pickedAuto.pressed.join() === "auto",
      pickedAuto,
    );
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "dark",
    );
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "light",
    );
    ensure(
      "theme: auto follows system change",
      (await page.locator("html").getAttribute("data-theme-mode")) === "auto",
      "auto",
    );
    await back(page);
    ensure(
      "appearance: native Back closes dialog",
      !(await page.locator("#appearanceDialog").isVisible()),
      "closed",
    );
    await settings(page);
    ensure(
      "settings: desktop sidebar toggle stays hidden on mobile",
      !(await page.locator("#statusBarHideBtn").isVisible()),
      "hidden",
    );
    await page.locator("#mobileSettingsDataButton").click();
    const dataActions = await page.evaluate(() => {
      const backup = getComputedStyle(
        document.getElementById("appArchiveOpen"),
      );
      const clear = getComputedStyle(
        document.getElementById("appClearStudyData"),
      );
      return {
        backup: backup.color,
        clear: clear.color,
        summary: document.querySelector(
          "#mobileSettingsDataPage .mobile-sheet-summary",
        ).textContent,
      };
    });
    ensure(
      "data management: backup is neutral and clearing remains distinct",
      dataActions.backup !== dataActions.clear &&
        /备份.*恢复.*清除/.test(dataActions.summary),
      dataActions,
    );
    await page.locator("#appArchiveOpen").click();
    await page.locator("#archiveDialog").waitFor({ state: "visible" });
    ensure(
      "archive: offline backup controls",
      (await page.locator("#archiveExport").isVisible()) &&
        (await page.locator("#archiveChooseFile").isVisible()) &&
        (await page.locator("#archiveChooseFile").textContent()).trim() ===
          "选择备份文件" &&
        !(await page.locator("#archiveFile").isVisible()),
      "export / Chinese file-picker button / hidden input",
    );
    ensure(
      "archive: cloud unavailable",
      !(await page.locator("#cloudArchiveOpen").isVisible()),
      "offline",
    );
    await back(page);
    ensure(
      "archive: native Back closes dialog",
      !(await page.locator("#archiveDialog").isVisible()),
      "closed",
    );
    for (
      let i = 0;
      i < 3 && (await page.locator("#mobileSettingsSheet").isVisible());
      i++
    )
      await back(page);

    await page.locator("#mobileAppSearchButton").click();
    await page.locator("#globalSearchInput").fill("学");
    await page
      .locator("#globalSearchResults [data-search-index]")
      .first()
      .waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const results = document.getElementById("globalSearchResults");
      return (
        results.scrollHeight > results.clientHeight &&
        !document
          .getElementById("globalSearchStatus")
          .textContent.includes("正在读取更多索引")
      );
    });
    await page.locator("#globalSearchResults").hover();
    await page.mouse.wheel(0, 120);
    await page.waitForFunction(
      () => document.getElementById("globalSearchResults").scrollTop > 0,
    );
    const searchReturnScroll = await page
      .locator("#globalSearchResults")
      .evaluate((element) => element.scrollTop);
    await page
      .locator("#globalSearchResults .global-search-group")
      .first()
      .locator("[data-search-index]")
      .last()
      .click();
    await page
      .locator(".detail-panel.anchored-detail-open")
      .waitFor({ state: "visible" });
    // A search result remains the return destination for the whole reading
    // visit, including after the previous five-second handoff timeout.
    await page.waitForTimeout(6200);
    await page.locator("#mobileAppBarBack").click();
    await page.waitForFunction((top) => {
      const results = document.getElementById("globalSearchResults");
      return (
        !document.getElementById("globalSearchOverlay").hidden &&
        Math.abs(results.scrollTop - top) <= 2
      );
    }, searchReturnScroll);
    ensure(
      "search: reading longer than five seconds preserves query and scroll on Back",
      (await page.locator("#globalSearchOverlay").isVisible()) &&
        (await page.locator("#globalSearchInput").inputValue()) === "学" &&
        searchReturnScroll > 0,
      {
        query: await page.locator("#globalSearchInput").inputValue(),
        scrollTop: searchReturnScroll,
      },
    );
    await back(page);
    await page.locator("#card-container .cc-card-body").first().click();
    await page
      .locator("#detailPanel.anchored-detail-open")
      .waitFor({ state: "visible" });
    await page.locator("#mobileAppBarBack").click();
    ensure(
      "search: ordinary detail does not reopen consumed search context",
      !(await page.locator("#globalSearchOverlay").isVisible()),
      "closed",
    );

    await switchModule(page, "lesson");
    const allBooks = profile.books;
    await filter(page);
    const offered = await page
      .locator("#tbBookSelect option")
      .evaluateAll((options) =>
        options.map((option) => option.value).filter(Boolean),
      );
    ensure(
      `textbooks: exactly the ${allBooks.length} ${profile.edition} edition books`,
      offered.length === allBooks.length &&
        allBooks.every((book) => offered.includes(book)),
      offered,
    );
    // ART-16: the picker is list rows named by the book's title, grouped by
    // series (none in the public edition), one per option; the native select
    // is kept for the web but never shown, so no system dialog opens. The
    // rows fold under 教材册 (DF-07); open it to measure them.
    await page
      .locator("#mobileFilterContent .mobile-book-fold > summary")
      .click();
    const picker = await page.evaluate(() => {
      const select = document.getElementById("tbBookSelect");
      const rows = [
        ...document.querySelectorAll("#mobileFilterContent .mobile-book-row"),
      ];
      const probe = document.createElement("span");
      probe.style.color = "var(--c-primary)";
      document.body.appendChild(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      const checked = rows.filter(
        (row) => row.getAttribute("aria-checked") === "true",
      );
      return {
        rows: rows.map((row) => row.dataset.bookId),
        names: rows.map((row) => row.textContent.trim()),
        options: [...select.options].map((option) => option.textContent),
        optgroups: select.querySelectorAll("optgroup").length,
        groups: [
          ...document.querySelectorAll(
            "#mobileFilterContent .mobile-book-group-name",
          ),
        ].map((group) => group.textContent.trim()),
        checked: checked.map((row) => row.dataset.bookId),
        checkedColor: checked[0] && getComputedStyle(checked[0]).color,
        accent,
        shortest: Math.min(...rows.map((row) => row.offsetHeight)),
        selectShown: getComputedStyle(select).display !== "none",
        selectValue: select.value,
        summary: document.getElementById("mobileFilterSummary").textContent,
        meta: getComputedStyle(
          document.querySelector("#mobileFilterContent .tb-book-picker-meta"),
        ).display,
      };
    });
    ensure(
      `textbooks: the sheet lists the ${allBooks.length} books as rows`,
      picker.rows.length === allBooks.length &&
        allBooks.every((book) => picker.rows.includes(book)) &&
        picker.names.join() === picker.options.join() &&
        picker.names.every((text) => !/[/单元]/.test(text)) &&
        picker.optgroups === (profile.books.includes("XinBian1") ? 2 : 0) &&
        picker.groups.join() ===
          (profile.books.includes("XinBian1")
            ? ["新编日语", "KotobaFlow"].join()
            : "") &&
        picker.checked.join() === picker.selectValue &&
        picker.checkedColor === picker.accent &&
        picker.shortest >= 44 &&
        !picker.selectShown &&
        picker.meta === "none" &&
        !/第 \d 册|新课程|新编 \d/.test(picker.summary),
      picker,
    );
    await closeFilter(page);
    for (const id of allBooks) {
      const lesson = await openBook(page, id);
      const modes = [];
      for (const mode of ["normal", "chunks", "plain"]) {
        await filter(page);
        if (
          !(await page
            .locator("#tbSidebarReadingControls [data-display-mode='normal']")
            .isVisible())
        ) {
          await page.locator(".tb-sidebar-reading-group > summary").click();
        }
        const control = page.locator(
          `#tbSidebarReadingControls [data-display-mode='${mode}']`,
        );
        if (await control.isDisabled()) {
          ensure(
            `${id}: only unavailable chunks may be disabled`,
            mode === "chunks",
            mode,
          );
          modes.push(`${mode}: unavailable in lesson`);
        } else {
          await control.click();
          await closeFilter(page);
          await bookGeometry(page, "#tbReader .book-frame", `${id}/${mode}`);
          const state = await page.evaluate(() => ({
            mode: window.ModuleSwitcher.getTextbookModule().textDisplayMode,
            text:
              document.querySelector("#tbReader .book-body")?.textContent
                .length || 0,
          }));
          ensure(
            `${id}/${mode}: reader content`,
            state.mode === mode && state.text > 100,
            state,
          );
          modes.push(mode);
        }
        await closeFilter(page);
      }
      results.books.push({ book: id, lesson, modes });
    }
    await openBook(page, "KotobaFlow1");
    // ART-B1, ART-B2, ART-B4: switching the textbook from inside the open
    // sheet redraws the heading, the outline and the sidebar; the sheet's
    // page block, its order and its focus follow, and coming back to the
    // first book reopens the lesson last read there.
    {
      const lessonBefore = await page.evaluate(
        () => window.ModuleSwitcher.getTextbookModule().currentLessonId,
      );
      const otherBook = allBooks.find((id) => id !== "KotobaFlow1");
      const sheetState = () =>
        page.evaluate(() => {
          const module = window.ModuleSwitcher.getTextbookModule();
          const block = document.getElementById("mobileSheetCurrent");
          const sheet = document.getElementById("mobileFilterSheet");
          const sourceDetail = (id) => {
            const button = document.querySelector(
              `#tbLessonHeading [data-heading-action='${id}']`,
            );
            const label =
              (button && (button.getAttribute("aria-label") || button.title)) ||
              "";
            const colon = label.indexOf("：");
            return colon > -1 ? label.slice(colon + 1).trim() : "";
          };
          const proxies = [
            ...block.querySelectorAll(
              ".mobile-sheet-action[data-sheet-action]",
            ),
          ].filter((proxy) =>
            ["previous", "next"].includes(proxy.dataset.sheetAction),
          );
          const picker = document.querySelector(
            "#mobileFilterContent .tb-book-picker",
          );
          return {
            book: module.currentBookId,
            lesson: module.currentLessonId,
            open: !sheet.hidden,
            title: document
              .getElementById("mobileSheetCurrentTitle")
              ?.textContent.trim(),
            running: document
              .getElementById("mobileRunningTitle")
              .textContent.trim(),
            text: block.textContent,
            sheetTitle:
              document.getElementById("mobileFilterTitle").textContent,
            proxies: proxies.map((proxy) => ({
              id: proxy.dataset.sheetAction,
              detail: proxy.querySelector("small")?.textContent.trim() || "",
              source: sourceDetail(proxy.dataset.sheetAction),
              live:
                !!proxy._mobileSource &&
                !!proxy._mobileSource.closest("#tbLessonHeading"),
            })),
            links: block.querySelectorAll(".mobile-sheet-outline-link").length,
            actions: [
              ...block.querySelectorAll(
                ".mobile-sheet-action[data-sheet-action]",
              ),
            ].map((proxy) => proxy.dataset.sheetAction),
            outlineFold: (() => {
              const fold = block.querySelector(".mobile-sheet-outline-fold");
              return (
                fold && {
                  open: fold.open,
                  note: fold.querySelector(":scope > summary > small")
                    ?.textContent,
                  current: fold
                    .querySelector(".mobile-sheet-outline-link[aria-current]")
                    ?.firstChild.textContent.trim(),
                }
              );
            })(),
            bookFold: (() => {
              const fold = picker?.querySelector(".mobile-book-fold");
              return (
                fold && {
                  open: fold.open,
                  note: fold.querySelector(":scope > summary > small")
                    ?.textContent,
                  label: !!picker
                    .querySelector(":scope > label")
                    ?.getClientRects().length,
                }
              );
            })(),
            sources: document.querySelectorAll("#tbReader .tb-outline nav a")
              .length,
            directoryNext: picker?.nextElementSibling?.classList.contains(
              "tb-lesson-directory",
            ),
            checked: [
              ...document.querySelectorAll(
                "#mobileFilterContent .mobile-book-row[aria-checked='true']",
              ),
            ].map((row) => row.dataset.bookId),
            checkedName: document
              .querySelector(
                "#mobileFilterContent .mobile-book-row[aria-checked='true']",
              )
              ?.textContent.trim(),
            summary: document.getElementById("mobileFilterSummary").textContent,
            focusInside: sheet.contains(document.activeElement),
            stored: JSON.parse(
              localStorage.getItem("kotobaflow_last_lesson_by_book") || "{}",
            ),
          };
        });
      await filter(page);
      const before = await sheetState();
      // DF-07: no 继续本课 proxy; 本课目录 and 教材册 open folded, the
      // summaries naming the current section and the open book.
      ensure(
        "sheet: 本课目录 and 教材册 start folded, without 继续本课",
        !before.actions.includes("continue") &&
          before.outlineFold?.open === false &&
          !!before.outlineFold.note &&
          before.outlineFold.note === before.outlineFold.current &&
          before.bookFold?.open === false &&
          before.bookFold.label === false &&
          before.bookFold.note === before.checkedName,
        before,
      );
      await pickBook(page, otherBook);
      await page.waitForFunction((book) => {
        const module = window.ModuleSwitcher.getTextbookModule();
        const title = document.getElementById("mobileSheetCurrentTitle");
        const running = document.getElementById("mobileRunningTitle");
        return (
          module.currentBookId === book &&
          !!module.currentLesson &&
          !!title &&
          !!running.textContent.trim() &&
          title.textContent.trim() === running.textContent.trim()
        );
      }, otherBook);
      await settle(page);
      const after = await sheetState();
      ensure(
        "sheet: switching the textbook updates the page block in place",
        after.open &&
          after.book === otherBook &&
          after.text !== before.text &&
          after.title === after.running &&
          after.sheetTitle === "本课与目录" &&
          after.proxies.length === 2 &&
          after.proxies.every(
            (proxy) => proxy.live && proxy.detail === proxy.source,
          ) &&
          after.links > 1 &&
          after.links === after.sources &&
          after.checked.join() === otherBook &&
          after.summary.startsWith(after.checkedName + " · "),
        { before, after },
      );
      ensure(
        "sheet: the course directory stays under the textbook picker",
        after.directoryNext === true,
        after,
      );
      ensure(
        "sheet: focus stays inside the sheet after the switch",
        after.focusInside,
        after,
      );
      await pickBook(page, "KotobaFlow1");
      await page.waitForFunction((book) => {
        const module = window.ModuleSwitcher.getTextbookModule();
        const title = document.getElementById("mobileSheetCurrentTitle");
        const running = document.getElementById("mobileRunningTitle");
        return (
          module.currentBookId === book &&
          !!module.currentLesson &&
          !!title &&
          title.textContent.trim() === running.textContent.trim()
        );
      }, "KotobaFlow1");
      await settle(page);
      const returned = await sheetState();
      ensure(
        "textbook: switching away and back returns to the lesson last read",
        returned.lesson === lessonBefore &&
          returned.stored.KotobaFlow1 === lessonBefore &&
          returned.stored[otherBook] === after.lesson &&
          returned.directoryNext === true &&
          returned.title === returned.running &&
          returned.checked.join() === "KotobaFlow1",
        { lessonBefore, returned },
      );
      await closeFilter(page);
    }
    const legacyHeading = await page.evaluate(() => {
      const removed = [];
      try {
        // Reproduce WebView 83 rejecting each selector list that uses :is():
        // the folded heading and the running head must not depend on one.
        for (const sheet of document.styleSheets) {
          for (let index = sheet.cssRules.length - 1; index >= 0; index--) {
            const rule = sheet.cssRules[index];
            if (rule.selectorText?.includes(":is(")) {
              removed.push({ sheet, index, css: rule.cssText });
              sheet.deleteRule(index);
            }
          }
        }
        return {
          removed: removed.length,
          // The outline sits in the heading in book view, beside it in scroll
          // view: neither may draw a box.
          heading: document.getElementById("tbLessonHeading").getClientRects()
            .length,
          outline: document
            .querySelector("#tbReader .tb-outline-slot")
            .getClientRects().length,
          running: getComputedStyle(
            document.getElementById("mobileRunningHead"),
          ).display,
          title: document
            .getElementById("mobileRunningTitle")
            .textContent.trim(),
          aside: document
            .getElementById("mobileRunningAside")
            .textContent.trim(),
          barTitle: document
            .getElementById("mobileAppBarTitle")
            .getBoundingClientRect().width,
        };
      } finally {
        removed
          .reverse()
          .forEach(({ sheet, index, css }) => sheet.insertRule(css, index));
      }
    });
    ensure(
      "legacy selectors: lesson heading and outline fold into the running head",
      legacyHeading.removed > 0 &&
        legacyHeading.heading === 0 &&
        legacyHeading.outline === 0 &&
        legacyHeading.running === "block" &&
        !!legacyHeading.title &&
        !!legacyHeading.aside &&
        legacyHeading.barTitle <= 1,
      legacyHeading,
    );
    await screenshot(page, "393x844-textbook-book");
    // DF-02: the lesson's words read as a two-column index of hairline rows,
    // no boxes, so a long word list takes about half the pages.
    await revealInBook(page, "#tbReader .tb-reading-vocab-row");
    const wordIndex = await page.evaluate(() => {
      const rows = [
        ...document.querySelectorAll("#tbReader .tb-reading-vocab-row"),
      ];
      const column = document.querySelector("#tbReader .book-body").clientWidth;
      const [a, b] = rows.slice(0, 2).map((row) => {
        const rect = row.getBoundingClientRect();
        const style = getComputedStyle(row);
        return {
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          radius: style.borderTopLeftRadius,
          sides: [style.borderBottomWidth, style.borderLeftWidth],
          rule: style.borderTopWidth,
          padding: getComputedStyle(row.querySelector(".tb-reading-vocab-open"))
            .paddingTop,
        };
      });
      return { count: rows.length, column, a, b };
    });
    ensure(
      "textbook: lesson words form a two-column hairline index (DF-02)",
      wordIndex.count > 1 &&
        wordIndex.a.top === wordIndex.b.top &&
        Math.abs(wordIndex.a.width * 2 - wordIndex.column) <= 2 &&
        Math.abs(wordIndex.b.left - wordIndex.a.left - wordIndex.a.width) <=
          1 &&
        [wordIndex.a, wordIndex.b].every(
          (row) =>
            row.radius === "0px" &&
            row.sides.every((side) => side === "0px") &&
            row.rule === "1px" &&
            row.padding === "6px",
        ),
      wordIndex,
    );
    await exercisePager(page, "#tbReader .book-frame", "textbook");
    await headingTools(page, "#tbReader", "textbook", "toc");
    // 本课目录 sits in the sheet on a phone, below the page's actions.
    await filter(page);
    const outline = await page.evaluate(() => {
      const links = [
        ...document.querySelectorAll(
          "#mobileSheetCurrent .mobile-sheet-outline-link",
        ),
      ];
      return {
        links: links.map((link) => link.textContent.trim()),
        current: links
          .filter((link) => link.getAttribute("aria-current"))
          .map((link) => link.textContent.trim()),
        sources: document.querySelectorAll("#tbReader .tb-outline nav a")
          .length,
      };
    });
    ensure(
      "textbook: sheet lists the lesson sections and marks the current one",
      outline.links.length > 1 &&
        outline.links.length === outline.sources &&
        outline.current.length === 1,
      outline,
    );
    await page
      .locator("#mobileSheetCurrent .mobile-sheet-outline-fold > summary")
      .click();
    await page
      .locator("#mobileSheetCurrent .mobile-sheet-outline-link")
      .last()
      .click();
    await page.locator("#mobileFilterSheet").waitFor({ state: "hidden" });
    ensure(
      "textbook: outline navigates book",
      Number(await page.locator("#tbReader .book-page-select").inputValue()) >
        0,
      await page.locator("#tbReader .book-page-select").inputValue(),
    );
    // The jump focuses the section (tabindex="-1"). WebView 83 has no
    // :focus-visible and rings any focus; with that ring put back (above
    // the page's own :focus resets), the section still shows none, while
    // an ordinary focusable element does once a key press brings rings
    // back.
    const jumpFocus = await page.evaluate(() => {
      const ring = document.createElement("style");
      ring.textContent =
        ":root :focus:focus { outline: 3px solid rgb(229, 151, 0); }";
      document.head.appendChild(ring);
      const target = document.activeElement;
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
      const probe = document.createElement("span");
      probe.tabIndex = 0;
      document.body.appendChild(probe);
      probe.focus();
      const probeOutline = getComputedStyle(probe).outlineStyle;
      probe.remove();
      target.focus({ preventScroll: true });
      const result = {
        target: target.id || target.tagName,
        tabindex: target.getAttribute("tabindex"),
        outline: getComputedStyle(target).outlineStyle,
        probeOutline,
      };
      window.dispatchEvent(new PointerEvent("pointerdown"));
      ring.remove();
      return result;
    });
    ensure(
      "textbook: the section an outline jump focuses draws no WebView ring",
      jumpFocus.tabindex === "-1" &&
        jumpFocus.outline === "none" &&
        jumpFocus.probeOutline === "solid",
      jumpFocus,
    );
    await page.locator("#tbReader .book-page-select").selectOption("3");
    await settle(page);
    await page.evaluate(() => window.ProgressStore.save());
    const beforeReload = await page
      .locator("#tbReader .book-page-select")
      .inputValue();
    await page.reload();
    await ready(page);
    await switchModule(page, "lesson");
    await page
      .locator("#tbReader .book-page-select")
      .waitFor({ state: "visible" });
    await page.waitForFunction(
      (value) =>
        document.querySelector("#tbReader .book-page-select")?.value === value,
      beforeReload,
    );
    ensure(
      "textbook: page restored after reload",
      (await page.locator("#tbBookSelect").inputValue()) === "KotobaFlow1",
      await page.locator("#tbBookSelect").inputValue(),
    );
    // ART-B3: no heading closes a page while its text starts on the next.
    // Chromium honours break-after: avoid by itself; WebView 83 relies on the
    // shell's measured breaks, which android-device-check covers.
    const strandedHeads = await page.evaluate(() => {
      const body = document.querySelector("#tbReader .book-body");
      const bounds = body.getBoundingClientRect();
      const scale = body.clientWidth / bounds.width;
      const column =
        body.clientWidth + (parseFloat(getComputedStyle(body).columnGap) || 0);
      const columnOf = (rect) =>
        Math.floor(
          ((rect.left - bounds.left) * scale + body.scrollLeft + 2) / column,
        );
      const range = document.createRange();
      return Array.from(
        body.querySelectorAll(
          ".tb-section-head, .tb-cgrammar-head, .tb-cgrammar-subhead",
        ),
      )
        .map((head) => {
          const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
          walker.currentNode = head.lastChild || head;
          let text = walker.nextNode();
          while (text && (head.contains(text) || !text.textContent.trim()))
            text = walker.nextNode();
          if (!text) return null;
          range.selectNodeContents(text);
          const rect = range.getClientRects()[0];
          const start = columnOf(head.getClientRects()[0]);
          return rect && columnOf(rect) > start
            ? head.textContent.trim().slice(0, 20) + " @" + start
            : null;
        })
        .filter(Boolean);
    });
    ensure(
      "textbook: phone headings share a page with their first line",
      strandedHeads.length === 0,
      strandedHeads,
    );
    // ART-20: a long scene note folds to two lines and opens on a tap. The
    // display-mode loop above leaves the reader in plain text, which shows
    // no notes; check in the normal mode and put plain back afterwards.
    const setDisplayMode = async (mode) => {
      await filter(page);
      if (
        !(await page
          .locator("#tbSidebarReadingControls [data-display-mode='normal']")
          .isVisible())
      ) {
        await page.locator(".tb-sidebar-reading-group > summary").click();
      }
      await page
        .locator(`#tbSidebarReadingControls [data-display-mode='${mode}']`)
        .click();
      await closeFilter(page);
      await settle(page);
    };
    const modeBeforeNotes = await page.evaluate(
      () => window.ModuleSwitcher.getTextbookModule().textDisplayMode,
    );
    if (modeBeforeNotes !== "normal") await setDisplayMode("normal");
    const sceneNote = await page.evaluate(async () => {
      const note = document.querySelector(
        '#tbReader .book-body .tb-scene-note[aria-expanded="false"]',
      );
      if (!note) return null;
      const folded = note.getBoundingClientRect().height;
      note.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const opened = note.getBoundingClientRect().height;
      const expanded = note.getAttribute("aria-expanded");
      note.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        folded,
        opened,
        expanded,
        refolded: note.getAttribute("aria-expanded"),
        role: note.getAttribute("role"),
      };
    });
    ensure(
      "textbook: phone scene note folds and opens on a tap",
      !!sceneNote &&
        sceneNote.role === "button" &&
        sceneNote.expanded === "true" &&
        sceneNote.refolded === "false" &&
        sceneNote.opened > sceneNote.folded,
      sceneNote,
    );
    if (modeBeforeNotes !== "normal") await setDisplayMode(modeBeforeNotes);
    const savedPhoneAnchor = await page.evaluate(
      () =>
        window.ModuleSwitcher.getTextbookModule().exportNavigation().bookAnchor,
    );
    ensure(
      "textbook: saved phone anchor identifies reading unit",
      !!savedPhoneAnchor?.target?.text,
      savedPhoneAnchor?.key,
    );
    await page.evaluate(() => window.ProgressStore.save());
    // Restore the exact native archive into a fresh WebView-sized context.
    // Isolation avoids inventing a two-tab native app with competing saves.
    const savedNativeArchive = await page.evaluate(() =>
      localStorage.getItem("kotobaflow_android_progress_v1"),
    );
    const wideReader = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      hasTouch: true,
    });
    const wideErrors = [];
    wideReader.on("pageerror", (error) => wideErrors.push(error.message));
    try {
      // 1280x720 is tablet-sized and would load the web layout; this check
      // restores the phone shell's anchor at another viewport size.
      await wideReader.addInitScript((archive) => {
        localStorage.setItem("kotobaflow_android_progress_v1", archive);
        localStorage.setItem("kotobaflow_form_factor", "phone");
      }, savedNativeArchive);
      await wideReader.goto(page.url());
      await ready(wideReader);
      await switchModule(wideReader, "lesson");
      await wideReader.waitForFunction(() => {
        const image = document.querySelector("#tbReader .tb-book-cover img");
        return image?.complete && image.naturalWidth > 0;
      });
      await wideReader.waitForFunction((anchor) => {
        const body = document.querySelector("#tbReader .book-body");
        if (!body) return false;
        const bounds = body.getBoundingClientRect();
        const elements = body.querySelectorAll(
          ".tb-section-head, .tb-unit, .tb-dialogue-turn, .tb-reading-vocab-row, .tb-item, .tb-exercise, .tb-kana-table tr, .tb-paragraph, .tb-cgrammar-head, .tb-cgrammar-text > p, .tb-cgrammar-subhead, .tb-cgrammar-points > li, .tb-cgrammar-examples > li",
        );
        return Array.from(elements).some(
          (element) =>
            element.textContent.replace(/\s+/g, " ").trim().slice(0, 160) ===
              anchor.target.text &&
            Array.from(element.getClientRects()).some(
              (rect) =>
                rect.left >= bounds.left - 1 && rect.left < bounds.right - 1,
            ),
        );
      }, savedPhoneAnchor);
      await bookGeometry(
        wideReader,
        "#tbReader .book-frame",
        "phone anchor restored at 1280",
      );
      ensure(
        "textbook: saved phone reading unit survives wide reload and cover decode",
        wideErrors.length === 0,
        wideErrors,
      );
      await screenshot(wideReader, "1280x720-phone-anchor-restored");
    } finally {
      await wideReader.close();
    }
    const image = await revealInBook(page, "#tbReader .tb-book-cover img");
    const imagePage = await page
      .locator("#tbReader .book-page-select")
      .inputValue();
    await image.click();
    await page.locator("#mobileImageViewer").waitFor({ state: "visible" });
    await back(page);
    ensure(
      "textbook: touch image and Back",
      !(await page.locator("#mobileImageViewer").isVisible()),
      "closed",
    );
    ensure(
      "textbook: image overlay preserves spread",
      (await page.locator("#tbReader .book-page-select").inputValue()) ===
        imagePage,
      {
        before: imagePage,
        after: await page.locator("#tbReader .book-page-select").inputValue(),
      },
    );
    const word = await revealInBook(
      page,
      "#tbReader [data-vocab-detail-index]",
    );
    // Two words share a line now (DF-02); let the jump to their page
    // settle before the tap, or it can land while the page still moves.
    await settle(page);
    await word.click();
    await page
      .locator("#textbookDetailPanel.anchored-detail-open")
      .waitFor({ state: "visible" });
    await back(page);
    ensure(
      "textbook: touch vocabulary detail",
      !(await page
        .locator("#textbookDetailPanel.anchored-detail-open")
        .count()),
      "closed",
    );
    // ART-11: a kana-only word names itself once, and the app bar names it.
    const kanaWord = await page.evaluate(() => {
      const textbook = window.ModuleSwitcher.getTextbookModule();
      const index = textbook.currentVocab.findIndex(
        (row) => row.word === "おはようございます",
      );
      if (index >= 0) textbook._showVocabDetail(index);
      return {
        book: textbook.currentBookId,
        lesson: textbook.currentLessonId,
        index,
      };
    });
    await page
      .locator("#textbookDetailPanel.anchored-detail-open")
      .waitFor({ state: "visible" });
    await page.waitForFunction(
      () =>
        document.getElementById("mobileRunningTitle").textContent.trim() ===
        "おはようございます",
    );
    const kanaEntry = await page.evaluate(() => {
      const entry = document.querySelector(
        "#textbookDetailPanel .tb-vocab-popup-entry",
      );
      const audio = entry.querySelector(
        ".tb-vocab-popup-head .tb-vocab-audio-btn",
      );
      const box = audio && audio.getBoundingClientRect();
      return {
        running: document
          .getElementById("mobileRunningTitle")
          .textContent.trim(),
        aside: document.getElementById("mobileRunningAside").textContent.trim(),
        headwordLines: [
          ...entry.querySelectorAll("h3, p, .tb-detail-value"),
        ].filter((node) => node.textContent.trim() === "おはようございます")
          .length,
        readingRow: [...entry.querySelectorAll(".tb-detail-label")].some(
          (node) => node.textContent.trim() === "读音",
        ),
        collocations: [...entry.querySelectorAll(".tb-subtitle")].some((node) =>
          node.textContent.includes("常用搭配"),
        ),
        metaLines: entry.querySelectorAll(".tb-vocab-meta-line").length,
        audioBorder: audio ? getComputedStyle(audio).borderTopColor : "",
        audioBox: box ? [box.width, box.height] : [],
      };
    });
    ensure(
      "textbook: kana-only word detail names the word once, folds repeats and plays from the header",
      kanaWord.index >= 0 &&
        kanaEntry.running === "おはようございます" &&
        kanaEntry.aside === "课文词汇" &&
        kanaEntry.headwordLines === 1 &&
        !kanaEntry.readingRow &&
        !kanaEntry.collocations &&
        kanaEntry.metaLines === 1 &&
        kanaEntry.audioBox[0] >= 44 &&
        kanaEntry.audioBox[1] >= 44 &&
        kanaEntry.audioBorder === "rgba(0, 0, 0, 0)",
      { kanaWord, kanaEntry },
    );
    await back(page);
    await filter(page);
    if (
      !(await page
        .locator("#tbSidebarReadingControls [data-display-mode='normal']")
        .isVisible())
    )
      await page.locator(".tb-sidebar-reading-group > summary").click();
    await page
      .locator("#tbSidebarReadingControls [data-display-mode='chunks']")
      .click();
    await closeFilter(page);
    const chunk = await revealInBook(page, "#tbReader [data-text-chunk]");
    await chunk.click();
    await page.locator("#tbChunkDetail").waitFor({ state: "visible" });
    await back(page);
    ensure(
      "textbook: touch chunk and Back",
      !(await page.locator("#tbChunkDetail").isVisible()),
      "closed",
    );
    ensure(
      "textbook: offline audio controls available",
      (await page.locator("#tbReader [data-tts-mode]").count()) > 0,
      await page.locator("#tbReader [data-tts-mode]").count(),
    );
    const audioButton = await revealInBook(
      page,
      "#tbReader button[data-tts-mode^='reading:']:not([disabled])",
    );
    await audioButton.click();
    await page.waitForFunction(
      () => {
        const state = window.ModuleSwitcher.getTextbookModule().ttsState;
        return (
          state.audio &&
          !state.audio.paused &&
          state.audio.currentTime > 0 &&
          !document.querySelector("#mobileLessonMiniPlayer").hidden
        );
      },
      null,
      { timeout: 20000 },
    );
    ensure(
      "textbook: audio updates mini-player",
      (await page.locator("#mobileLessonMiniStatus").textContent()).length > 0,
      await page.locator("#mobileLessonMiniStatus").textContent(),
    );
    // DF-06: a section recording pauses where it is, resumes from there
    // and seeks by dragging the track; 停止 is an icon that cannot wrap.
    const tts = () =>
      page.evaluate(() => {
        const state = window.ModuleSwitcher.getTextbookModule().ttsState;
        const audio = state.audio;
        const mini = document.getElementById("mobileLessonMiniPlayer");
        const box = (id) => {
          const rect = document.getElementById(id).getBoundingClientRect();
          return [Math.round(rect.width), Math.round(rect.height)];
        };
        return {
          mode: state.mode,
          paused: !!audio && audio.paused,
          time: audio ? audio.currentTime : -1,
          duration: audio ? audio.duration : 0,
          shown: !mini.hidden,
          seek: !document.getElementById("mobileLessonMiniSeek").hidden,
          seekValue: Number(
            document.getElementById("mobileLessonMiniSeek").value,
          ),
          toggle: document
            .getElementById("mobileLessonMiniPause")
            .getAttribute("aria-label"),
          status: document.getElementById("mobileLessonMiniStatus").textContent,
          stop: box("mobileLessonMiniStop"),
          pause: box("mobileLessonMiniPause"),
        };
      });
    await page.locator("#mobileLessonMiniPause").click();
    await page.waitForTimeout(400);
    const paused = await tts();
    await page.waitForTimeout(500);
    const stillPaused = await tts();
    ensure(
      "textbook: mini-player pauses in place (DF-06)",
      paused.paused &&
        paused.shown &&
        paused.seek &&
        paused.toggle === "继续" &&
        paused.status.startsWith("已暂停") &&
        stillPaused.time === paused.time &&
        paused.time > 0 &&
        paused.stop.every((side) => side >= 44 && side <= 48) &&
        paused.pause.every((side) => side >= 44 && side <= 48),
      { paused, stillPaused },
    );
    // Seek while paused: drag the track to the middle and let go.
    await page.evaluate(() => {
      const seek = document.getElementById("mobileLessonMiniSeek");
      seek.value = "500";
      seek.dispatchEvent(new Event("input", { bubbles: true }));
      seek.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.locator("#mobileLessonMiniPause").click();
    await page.waitForFunction(
      () => {
        const audio = window.ModuleSwitcher.getTextbookModule().ttsState.audio;
        return (
          audio &&
          !audio.paused &&
          audio.currentTime > audio.duration * 0.5 + 0.2
        );
      },
      null,
      { timeout: 15000 },
    );
    const resumed = await tts();
    ensure(
      "textbook: mini-player seeks and resumes from there (DF-06)",
      !resumed.paused &&
        resumed.mode === paused.mode &&
        resumed.toggle === "暂停" &&
        resumed.seekValue >= 500 &&
        resumed.time < resumed.duration * 0.6,
      { paused, resumed },
    );
    // The page's own button resumes a paused section instead of restarting.
    await page.locator("#mobileLessonMiniPause").click();
    await page.waitForTimeout(300);
    const before = await tts();
    await page.evaluate((mode) => {
      window.ModuleSwitcher.getTextbookModule()._handleTtsButtonClick(mode);
    }, before.mode);
    await page.waitForTimeout(400);
    const pageResumed = await tts();
    ensure(
      "textbook: the section button resumes a paused section (DF-06)",
      before.paused && !pageResumed.paused && pageResumed.time >= before.time,
      { before, pageResumed },
    );
    await page.locator("#mobileLessonMiniStop").click();
    await page.locator("#mobileLessonMiniPlayer").waitFor({ state: "hidden" });
    ensure(
      "textbook: mini-player stop halts audio",
      await page.evaluate(
        () =>
          !window.ModuleSwitcher.getTextbookModule().ttsState.audio ||
          window.ModuleSwitcher.getTextbookModule().ttsState.audio.paused,
      ),
      "stopped",
    );
    await a11y(page, "textbook");
    await touch(page, "textbook");

    // Legacy reading remains an explicit preference and still uses the mobile
    // chapter navigation. Restore the default after exercising it.
    await settings(page);
    await page.locator("#appReadingLayoutSelect").selectOption("scroll");
    await back(page);
    await switchModule(page, "lesson");
    await page.locator("#mobileLessonSectionNav").waitFor({ state: "visible" });
    const sectionButton = page
      .locator("#mobileLessonSectionNav [data-mobile-lesson-section-target]")
      .last();
    const sectionId = await sectionButton.getAttribute(
      "data-mobile-lesson-section-target",
    );
    await sectionButton.click();
    await page.waitForFunction((id) => {
      const target = document.getElementById(id);
      const reader = document.getElementById("tbReader");
      const a = target.getBoundingClientRect();
      const b = reader.getBoundingClientRect();
      return a.top < b.bottom && a.bottom > b.top;
    }, sectionId);
    ensure(
      "legacy scroll: chapter navigation",
      (await page.locator("#tbReader .book-frame").count()) === 0,
      sectionId,
    );
    await settings(page);
    await page.locator("#appReadingLayoutSelect").selectOption("book");
    await back(page);
    await switchModule(page, "lesson");
    await page.locator("#tbReader .book-frame").waitFor({ state: "visible" });
    ensure(
      "book: legacy chapter navigation removed",
      (await page.locator("#mobileLessonSectionNav").count()) === 0,
      "book default restored",
    );

    // Upstream 2026-10-20 (web 77180b1). Example sentences play packed clips
    // read by byte range; on a touch screen the button grows a little and
    // its tap area reaches 44 px without moving the sentence.
    await switchModule(page, "vocab");
    await page.locator(".cc-book-body .cc-card-body").first().click();
    await page
      .locator("#detailPanel.anchored-detail-open")
      .waitFor({ state: "visible" });
    await detailSlidIn(page);
    const exampleButton = page
      .locator("#detailPanel .example-audio-btn")
      .first();
    await exampleButton.waitFor({ state: "visible" });
    const exampleTarget = await exampleButton.evaluate((button) => {
      button.scrollIntoView({ block: "center" });
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      return {
        width: rect.width,
        height: rect.height,
        // 5 px outside the drawn button, inside the 6 px tap margin.
        hits: [
          [rect.left - 5, y],
          [rect.right + 5, y],
          [x, rect.top - 5],
          [x, rect.bottom + 5],
        ].map(([left, top]) => {
          const hit = document.elementFromPoint(left, top);
          return hit === button || button.contains(hit);
        }),
      };
    });
    ensure(
      "example audio: 32 px button with a 44 px tap area",
      exampleTarget.width === 32 &&
        exampleTarget.height === 32 &&
        exampleTarget.hits.every(Boolean),
      exampleTarget,
    );
    const packResponses = [];
    const recordPack = (response) => {
      if (response.url().includes("/data/example_audio_v1/packs/"))
        packResponses.push(response.status());
    };
    page.on("response", recordPack);
    try {
      await exampleButton.click();
      await page.waitForFunction(() => {
        const state = document.querySelector("#detailPanel .example-audio-btn")
          ?.dataset.state;
        return state && state !== "idle" && state !== "loading";
      });
    } finally {
      page.off("response", recordPack);
    }
    const exampleState = await exampleButton.getAttribute("data-state");
    ensure(
      "example audio: a packed clip plays from a byte range",
      exampleState === "playing" &&
        packResponses.length > 0 &&
        packResponses.every((status) => status === 206),
      { exampleState, packResponses },
    );
    await page.evaluate(() => window.JPLearn.exampleAudio.stop());
    await back(page);

    if (profile.classics) {
      // 拓展阅读 (web a4e01af's 古典, renamed on the phone by DF-15): the fifth
      // tab once the local library has loaded, with a drawer of works and the
      // open work's directory.
      await switchModule(page, "classics");
      await page.locator("#clReader .book-frame").waitFor({ state: "visible" });
      await page.waitForFunction(
        () =>
          !["", "-"].includes(
            document.getElementById("statusClassicsPart")?.textContent.trim(),
          ),
      );
      const classicsChrome = await page.evaluate(() => ({
        hash: window.location.hash,
        title: document.getElementById("mobileAppBarTitle").textContent,
        subtitle: document.getElementById("mobileAppBarSubtitle").textContent,
        context: document
          .getElementById("mobileAppContextButton")
          .textContent.trim(),
        tab: (() => {
          const label = document.querySelector(
            '#mobileBottomNav [data-mobile-module="classics"] span',
          );
          const lineHeight = parseFloat(getComputedStyle(label).lineHeight);
          return {
            text: label.textContent,
            height: label.getBoundingClientRect().height,
            lineHeight,
          };
        })(),
        oldName: document
          .getElementById("mobileAppShell")
          .innerText.includes("古典"),
      }));
      ensure(
        "classics: the module is called 拓展阅读 in the app bar and bottom navigation",
        classicsChrome.tab.text === "拓展阅读" &&
          classicsChrome.tab.height < classicsChrome.tab.lineHeight * 1.5 &&
          !classicsChrome.oldName,
        classicsChrome,
      );
      ensure(
        "classics: fifth tab opens the reader at its work and part",
        classicsChrome.hash === "#classics" &&
          classicsChrome.title === "拓展阅读" &&
          classicsChrome.subtitle.includes(" · ") &&
          classicsChrome.context === "目录",
        classicsChrome,
      );
      // DF-15: a narrated work's player floats where the lesson's reading
      // player does, above the bottom bar, and the page ends above it.
      const narration = await page.evaluate(() => {
        const audio = document.querySelector("#clReader .cl-audio");
        const rect = (element) => {
          const box = element.getBoundingClientRect();
          return { top: Math.round(box.top), bottom: Math.round(box.bottom) };
        };
        return {
          audio: audio && {
            ...rect(audio),
            position: getComputedStyle(audio).position,
          },
          marked: document
            .getElementById("classicsMain")
            .classList.contains("mobile-cl-narrated"),
          frame: rect(document.querySelector("#clReader .book-frame")),
          nav: rect(document.getElementById("mobileBottomNav")),
        };
      });
      ensure(
        "classics: narration floats above the bottom bar, below the page (DF-15)",
        narration.marked === !!narration.audio &&
          (!narration.audio ||
            (narration.audio.position === "fixed" &&
              narration.audio.bottom <= narration.nav.top &&
              narration.nav.top - narration.audio.bottom <= 12 &&
              narration.audio.top >= narration.frame.bottom)),
        narration,
      );
      await screenshot(page, "393x844-classics-book");
      await exercisePager(page, "#clReader .book-frame", "classics");
      await headingTools(page, "#clReader", "classics", "toc");
      await filter(page);
      const classicsDrawer = await page.evaluate(() => ({
        title: document.getElementById("mobileFilterTitle").textContent,
        works: document.querySelectorAll("#mobileFilterContent [data-cl-work]")
          .length,
        directoryOpen: !!document.querySelector(
          "#mobileFilterContent .cl-directory[open]",
        ),
        parts: document.querySelectorAll("#mobileFilterContent .cl-part-card")
          .length,
      }));
      ensure(
        "classics: drawer lists the works and the open directory",
        classicsDrawer.title === "作品与目录" &&
          classicsDrawer.works === 6 &&
          classicsDrawer.directoryOpen &&
          classicsDrawer.parts > 1,
        classicsDrawer,
      );
      await screenshot(page, "393x844-classics-drawer");
      const partBefore = await page
        .locator("#statusClassicsPart")
        .textContent();
      await page
        .locator(
          "#mobileFilterContent .cl-part-card:not([aria-current='page'])",
        )
        .first()
        .click();
      await page.locator("#mobileFilterSheet").waitFor({ state: "hidden" });
      await page.waitForFunction(
        (before) =>
          document.getElementById("statusClassicsPart").textContent !== before,
        partBefore,
      );
      ensure(
        "classics: choosing a part closes the drawer onto it",
        !(await page.locator("#mobileFilterSheet").isVisible()),
        {
          before: partBefore,
          after: await page.locator("#statusClassicsPart").textContent(),
        },
      );
      await filter(page);
      const workBefore = await page
        .locator("#statusClassicsBook")
        .textContent();
      await page
        .locator(
          "#mobileFilterContent [data-cl-work]:not([aria-current='page'])",
        )
        .first()
        .click();
      await page.locator("#mobileFilterSheet").waitFor({ state: "hidden" });
      await page.waitForFunction(
        (before) =>
          document.getElementById("statusClassicsBook").textContent !== before,
        workBefore,
      );
      ensure(
        "classics: choosing a work closes the drawer onto it",
        (await page.locator("#mobileAppBarSubtitle").textContent()).startsWith(
          await page.locator("#statusClassicsBook").textContent(),
        ),
        {
          before: workBefore,
          subtitle: await page.locator("#mobileAppBarSubtitle").textContent(),
        },
      );
      await a11y(page, "classics");
      await touch(page, "classics");

      // The app starts at its root; the classics keep no study navigation, so
      // mobile-native.js notes them and mobile-platform.js restores their
      // address. Choosing a study module ends that.
      const appRoot = new URL("/", page.url()).href;
      const restartInto = async (expected) => {
        await page.goto(appRoot);
        await ready(page);
        await page.waitForFunction(
          (name) =>
            window.ModuleSwitcher.getCurrentModule() === name &&
            document.querySelector("#mobileBottomNav [aria-current='page']")
              ?.dataset.mobileModule === name,
          expected,
        );
        await settle(page);
        return page.evaluate(() => ({
          hash: window.location.hash,
          module: window.ModuleSwitcher.getCurrentModule(),
          note: localStorage.getItem("kotobaflow_mobile_last_view"),
        }));
      };
      const classicsRestart = await restartInto("classics");
      ensure(
        "classics: reopened at the next start",
        classicsRestart.hash === "#classics" &&
          classicsRestart.note === "classics",
        classicsRestart,
      );
      await switchModule(page, "grammar");
      await page.evaluate(() => window.ProgressStore.save());
      const studyRestart = await restartInto("grammar");
      ensure(
        "classics: a study module replaces them at the next start",
        studyRestart.hash === "" && studyRestart.note === null,
        studyRestart,
      );
    } else {
      // An edition without the classics library: no fifth tab, and the
      // web's own content switch keeps the module off.
      const classicsOff = await page.evaluate(() => ({
        offered: window.JPLearn.textbooks.classicsOffered(),
        tab: !!document.querySelector(
          '#mobileBottomNav [data-mobile-module="classics"]:not([hidden])',
        ),
      }));
      ensure(
        "classics: absent from an edition without the library",
        classicsOff.offered === false && classicsOff.tab === false,
        classicsOff,
      );
    }

    // The web's 关于本站 opens privacy.html about the hosted site; the app
    // opens its own sheet from the same settings row.
    await settings(page);
    const aboutTrigger = page.locator("#mobileSettingsSheet #appAboutLink");
    await aboutTrigger.scrollIntoViewIfNeeded();
    await aboutTrigger.click();
    await page.locator("#mobileAboutDialog").waitFor({ state: "visible" });
    await settle(page);
    const about = await page.evaluate(() => {
      const dialog = document.getElementById("mobileAboutDialog");
      return {
        modal: dialog.matches(":modal"),
        focus: dialog.contains(document.activeElement),
        layer: document.documentElement.dataset.mobileTopLayer,
        title: document.getElementById("mobileAboutTitle").textContent,
        links: dialog.querySelectorAll("a[href]").length,
        privacy: document.querySelectorAll("a[href*='privacy']").length,
      };
    });
    ensure(
      "about: in-app sheet replaces the website page",
      about.modal &&
        about.focus &&
        about.layer === "dialog" &&
        about.title === "关于词基流动" &&
        about.links === 0 &&
        about.privacy === 0,
      about,
    );
    await touch(page, "about");
    await back(page);
    ensure(
      "about: native Back closes it and returns to the settings row",
      !(await page.locator("#mobileAboutDialog").isVisible()) &&
        (await page.evaluate(() => document.activeElement?.id)) ===
          "appAboutLink",
      await page.evaluate(() => document.activeElement?.id),
    );
    await back(page);

    await switchModule(page, "dashboard");
    await page.evaluate(() => {
      window.KotobaFlowMobileShell.init();
      window.KotobaFlowMobileShell.init();
    });
    const counts = await page.evaluate(() =>
      [
        "mobileAppShell",
        "mobileFilterSheet",
        "mobileSettingsSheet",
        "mobileBottomNav",
      ].map((id) => document.querySelectorAll(`#${id}`).length),
    );
    ensure(
      "shell: repeated init idempotent",
      counts.every((count) => count === 1),
      counts,
    );
    await page.evaluate(() => {
      window.KotobaFlowMobileShell.destroy();
      window.KotobaFlowMobileShell.init();
    });
    await settings(page);
    ensure(
      "shell: destroy/init restores settings owner",
      (await page
        .locator("#mobileSettingsContent #appSettingsPanel")
        .count()) === 1,
      await page.locator("#mobileSettingsContent #appSettingsPanel").count(),
    );
    await back(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const animations = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll(
          "#mobileAppShell, .mobile-layer-backdrop, #mobileFilterSheet",
        ),
      )
        .map((node) => ({
          animation: getComputedStyle(node).animationDuration,
          transition: getComputedStyle(node).transitionDuration,
        }))
        .filter((entry) =>
          [entry.animation, entry.transition].some((value) =>
            value.split(",").some((part) => {
              const seconds =
                parseFloat(part) / (part.trim().endsWith("ms") ? 1000 : 1);
              return seconds > 0.001;
            }),
          ),
        ),
    );
    ensure("shell: reduced motion", animations.length === 0, animations);
    await page.addInitScript(() => {
      window.mobileSmokeNativeDark = true;
      window.KotobaFlowNativeTheme = {
        isDark: () => window.mobileSmokeNativeDark,
      };
    });
    await page.reload();
    await ready(page);
    ensure(
      "theme: native auto overrides light WebView media",
      (await page.locator("html").getAttribute("data-theme")) === "dark",
      await page.locator("html").getAttribute("data-theme"),
    );
    await page.evaluate(() => {
      window.mobileSmokeNativeDark = false;
      window.__KOTOBAFLOW_APPLY_NATIVE_THEME__();
    });
    ensure(
      "theme: native theme refresh",
      (await page.locator("html").getAttribute("data-theme")) === "light",
      await page.locator("html").getAttribute("data-theme"),
    );
    await page.addInitScript(() => {
      HTMLDialogElement.prototype.showModal = undefined;
      HTMLDialogElement.prototype.close = undefined;
    });
    await page.reload();
    await ready(page);
    await settings(page);
    await page.locator("#appAppearanceOpen").click();
    await page
      .locator("#appearanceDialog[open][data-mobile-dialog-fallback]")
      .waitFor({ state: "visible" });
    await modal(page, "#appearanceDialog", "legacy WebView appearance");
    await back(page);
    ensure(
      "legacy WebView: appearance closes with native Back",
      !(await page.locator("#appearanceDialog").isVisible()),
      "closed",
    );
    await settings(page);
    await page.locator("#mobileSettingsDataButton").click();
    await page.locator("#appArchiveOpen").click();
    await page
      .locator("#archiveDialog[open][data-mobile-dialog-fallback]")
      .waitFor({ state: "visible" });
    await back(page);
    ensure(
      "legacy WebView: archive closes with native Back",
      !(await page.locator("#archiveDialog").isVisible()),
      "closed",
    );
    ensure(
      "functional: runtime errors",
      app.errors.length === 0,
      app.errors.slice(0, 10),
    );
  } catch (error) {
    await screenshot(page, "functional-failure").catch(() => {});
    fs.writeFileSync(
      path.join(screenshotDirectory, "partial-ui-report.json"),
      JSON.stringify(results, null, 2),
    );
    error.message += `; last checks: ${results.checks.slice(-4).join("; ")}`;
    throw error;
  } finally {
    await page.close();
  }
  return results;
}

module.exports = { runCurrentUiSmoke };
