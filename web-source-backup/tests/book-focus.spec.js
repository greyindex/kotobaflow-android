// BOOK-FIX-01: native keyboard focus must remain on the visible book spread.
const { test, expect } = require('@playwright/test');
const {
  DEFAULT_LAYOUT_STORAGE,
  openReadyApp,
  revealControl,
  selectTextbook,
  settleBook,
} = require('./helpers');

test.use({ serviceWorkers: 'block', storageState: DEFAULT_LAYOUT_STORAGE });
test.beforeEach(async ({ page }) => {
  await page.route('**/js/storage-config.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: "window.JPLearnStorageConfig = Object.freeze({ mode: 'browser' });",
    }),
  );
});

async function openBook(page, kind) {
  const errors = await openReadyApp(page, {
    module: kind === 'vocab' ? 'vocab' : kind === 'lesson' ? 'lesson' : 'grammar',
  });
  if (kind === 'reader') {
    await revealControl(page.locator('#gmSideNavLesson'));
    await page.locator('#gmSideNavLesson').click();
    await revealControl(page.locator('.gm-lesson-card').first());
    await page.locator('.gm-lesson-card').first().click();
  } else if (kind === 'lesson') {
    await selectTextbook(page, 'KotobaFlow1');
    const lesson = page.locator('.tb-lesson-card[data-lesson-id="lesson_01"]');
    await revealControl(lesson);
    await lesson.click();
    // A book from the previous lesson can stay visible while the new body loads.
    await expect(page.locator('#tbLessonHeading')).toContainText('こんにちは');
    await expect(page.locator('#tbLoading')).toHaveClass(/hidden/);
  }
  if ((await page.locator('#statusBarShowBtn').getAttribute('aria-expanded')) === 'true')
    await page.keyboard.press('Escape');
  const selector = {
    vocab: '#card-container',
    grammar: '#gmGrammarList',
    reader: '#gmLessonReader',
    lesson: '#tbReader',
  }[kind];
  const book = page.locator(`${selector} .book-frame`);
  await expect(book).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return { book, errors };
}

async function middleSpread(book, withControls) {
  return book.evaluate((frame, withControls) => {
    const body = frame.querySelector('.book-body');
    const bounds = body.getBoundingClientRect();
    const scale = body.clientWidth / bounds.width;
    const stride = body.clientWidth + parseFloat(getComputedStyle(body).columnGap);
    const counts = Array(frame.querySelector('.book-page-select').options.length).fill(0);
    for (const control of body.querySelectorAll(
      'a[href], button, input, select, textarea, summary, [tabindex]',
    )) {
      if (control.tabIndex < 0 || control.disabled || getComputedStyle(control).visibility !== 'visible')
        continue;
      const rect = control.getClientRects()[0];
      if (!rect || !rect.width || !rect.height) continue;
      const spread = Math.floor(((rect.left - bounds.left) * scale + body.scrollLeft + 2) / stride);
      if (spread >= 0 && spread < counts.length) counts[spread]++;
    }
    const candidates = counts
      .map((count, spread) => ({ count, spread }))
      .filter(({ count, spread }) => spread > 0 && spread < counts.length - 1 && count > 0 === withControls)
      .sort((a, b) => Math.abs(a.spread - counts.length / 2) - Math.abs(b.spread - counts.length / 2));
    return candidates[0] || null;
  }, withControls);
}

async function focusState(book) {
  return book.evaluate((frame) => {
    const body = frame.querySelector('.book-body');
    const active = document.activeElement;
    if (!body.contains(active)) return null;
    const bounds = body.getBoundingClientRect();
    const visible = [...active.getClientRects()].some(
      (rect) =>
        rect.width > 0 &&
        rect.height > 0 &&
        rect.left >= bounds.left - 2 &&
        rect.right <= bounds.right + 2 &&
        rect.top >= Math.max(bounds.top, 0) - 2 &&
        rect.bottom <= Math.min(bounds.bottom, innerHeight) + 2,
    );
    return {
      visible,
      text: active.getAttribute('aria-label') || active.textContent.trim().slice(0, 70),
      page: Number(frame.querySelector('.book-page-select').value),
    };
  });
}

async function walkFocus(page, book, reverse) {
  const count = await book.locator('.book-body').evaluate((body, reverse) => {
    const controls = [...body.querySelectorAll('button, a[href], input, select, summary, [tabindex]')].filter(
      (element) => element.tabIndex >= 0 && !element.disabled && element.getClientRects().length,
    );
    const first = reverse ? controls[controls.length - 1] : controls[0];
    first.focus();
    return controls.length;
  }, reverse);
  expect(count).toBeGreaterThan(3);
  const visited = new Set();
  for (let index = 0; index < Math.min(count, 120); index++) {
    if (index) await page.keyboard.press(reverse ? 'Shift+Tab' : 'Tab');
    // Include native scroll settling, which used to move the focused control
    // back outside the clipped spread after the browser had revealed it.
    await page.waitForTimeout(180);
    const state = await focusState(book);
    expect(state, `focus left the body at ${index}/${count}`).not.toBeNull();
    expect(state.visible, `offscreen ${reverse ? 'reverse ' : ''}focus: ${state.text}`).toBe(true);
    visited.add(state.page);
  }
  expect(visited.size).toBeGreaterThan(1);
}

for (const kind of ['vocab', 'grammar', 'reader', 'lesson']) {
  test(`book focus: ${kind} native Tab and Shift+Tab reveal focused controls across spreads`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { book, errors } = await openBook(page, kind);
    await walkFocus(page, book, false);
    await walkFocus(page, book, true);
    expect(errors).toEqual([]);
  });
}

test('book focus: single-page vocabulary layout follows Tab in both directions', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 768, height: 1024 });
  const { book, errors } = await openBook(page, 'vocab');
  await expect(book).toHaveClass(/is-single/);
  await walkFocus(page, book, false);
  await walkFocus(page, book, true);
  expect(errors).toEqual([]);
});

test('book focus: same-spread focus keeps the open dictionary and keyboard layers stay isolated', async ({
  page,
}) => {
  const { book, errors } = await openBook(page, 'vocab');
  const pages = book.locator('.book-page-select');
  const firstCard = book.locator('.cc-card-body').first();
  await firstCard.click();
  const detail = page.locator('#detailPanel');
  await expect(detail).toHaveClass(/anchored-detail-open/);
  await firstCard.focus();
  await expect(pages).toHaveValue('0');
  await expect(detail).toHaveClass(/anchored-detail-open/);
  await page.keyboard.press('PageDown');
  await expect(pages).toHaveValue('0');
  await expect(detail).toHaveClass(/anchored-detail-open/);
  await page.keyboard.press('Escape');
  await expect(detail).not.toHaveClass(/anchored-detail-open/);

  await firstCard.focus();
  await page.keyboard.press('ArrowRight');
  await expect(pages).toHaveValue('1');
  expect((await focusState(book)).visible).toBe(true);
  await page.keyboard.press('Tab');
  await expect(pages).toHaveValue('1');
  expect((await focusState(book)).visible).toBe(true);
  await page.locator('#statusBarShowBtn').click();
  await page.locator('#searchInput').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('PageDown');
  await expect(pages).toHaveValue('1');
  await page.locator('#modBtnVocab').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(pages).toHaveValue('1');
  await page.keyboard.press('Escape');
  // Escape closes the sidebar and then returns focus to its button.
  await expect(page.locator('#statusBarShowBtn')).toBeFocused();

  await page.keyboard.press('Control+k');
  await expect(page.locator('#globalSearchInput')).toBeFocused();
  await page.keyboard.press('PageDown');
  await page.keyboard.press('ArrowLeft');
  await expect(pages).toHaveValue('1');
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

for (const kind of ['vocab', 'lesson']) {
  test(`book focus: ${kind} layout changes and delayed settling preserve visible focus`, async ({ page }) => {
    const { book, errors } = await openBook(page, kind);
    const target =
      kind === 'vocab' ? book.locator('.cc-card-body').nth(8) : book.locator('.book-body button').nth(65);
    await target.focus();
    await expect.poll(async () => (await focusState(book)).visible).toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(300);
    await expect(target).toBeFocused();
    expect((await focusState(book)).visible).toBe(true);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    const state = await focusState(book);
    expect(state.visible).toBe(true);
    await page.waitForTimeout(300);
    expect(await focusState(book)).toEqual(state);
    expect(errors).toEqual([]);
  });
}

// A short reader shows the top of a taller frame. Pressing a control focuses
// it on pointerdown; following that focus must not scroll the reader and move
// the control from under the pointer before the click lands.
test('book focus: pressing a word in a frame taller than the reader keeps the click on it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 540 });
  const { book, errors } = await openBook(page, 'lesson');
  const point = await book.evaluate((frame) => {
    const reader = document.getElementById('tbReader');
    const body = frame.querySelector('.book-body');
    const limits = reader.getBoundingClientRect();
    const bounds = body.getBoundingClientRect();
    const control = [...body.querySelectorAll('button')].find((element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.width > 4 &&
        rect.left >= bounds.left &&
        rect.right <= bounds.right &&
        rect.top >= limits.top + 8 &&
        rect.bottom <= Math.min(limits.bottom, bounds.bottom) - 8
      );
    });
    control.setAttribute('data-press-target', '');
    window.__pressClicks = [];
    document.addEventListener(
      'click',
      (event) => window.__pressClicks.push(!!event.target.closest('[data-press-target]')),
      true,
    );
    const rect = control.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      overflows: frame.getBoundingClientRect().bottom > limits.bottom + 1,
    };
  });
  expect(point.overflows).toBe(true);
  const scrollTop = () => page.locator('#tbReader').evaluate((reader) => reader.scrollTop);
  const before = await scrollTop();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  expect(await scrollTop()).toBe(before);
  await page.mouse.up();
  expect(await page.evaluate(() => window.__pressClicks)).toEqual([true]);
  expect(errors).toEqual([]);
});

// Native order would enter at the first or last control of the whole content,
// turning to the opposite end of the book. Keyboard entry starts on the shown spread.
for (const kind of ['vocab', 'lesson']) {
  test(`book focus: ${kind} Tab and Shift+Tab from outside enter the shown spread`, async ({ page }) => {
    const { book, errors } = await openBook(page, kind);
    if (kind === 'vocab') {
      // Word-book entries fit a 24-word group on two spreads; a larger group has a middle one.
      await revealControl(page.locator('#ccPerPageSelect'));
      await page.locator('#ccPerPageSelect').selectOption('96');
      if ((await page.locator('#statusBarShowBtn').getAttribute('aria-expanded')) === 'true')
        await page.keyboard.press('Escape');
      await expect(book.locator('.book-status-extra')).toContainText('1–96 词');
    }
    const pages = book.locator('.book-page-select');
    const spreads = await pages.locator('option').count();
    // A middle spread, so entering at either end of the content would turn it.
    expect(spreads).toBeGreaterThan(2);
    // Typography can put only prose on the mathematical middle spread. This
    // case verifies entry into controls; text-only spreads have their own case.
    const candidate = await middleSpread(book, true);
    expect(candidate).not.toBeNull();
    const spread = String(candidate.spread);
    await pages.selectOption(spread);
    for (const [from, key] of [
      ['.book-edge.is-prev', 'Tab'],
      ['.book-edge.is-next', 'Shift+Tab'],
    ]) {
      await book.locator(from).focus();
      await page.keyboard.press(key);
      await page.waitForTimeout(180);
      await expect(pages).toHaveValue(spread);
      const state = await focusState(book);
      expect(state, `${key} did not enter the book`).not.toBeNull();
      expect(state.visible, `${key} focused ${state.text}`).toBe(true);
    }
    expect(errors).toEqual([]);
  });
}

for (const viewport of [
  { width: 1600, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`book focus: a text-only lesson spread keeps its page and lets Tab leave at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const { book, errors } = await openBook(page, 'lesson');
    const candidate = await middleSpread(book, false);
    expect(candidate).not.toBeNull();
    expect(candidate.count).toBe(0);
    const spread = String(candidate.spread);
    const pages = book.locator('.book-page-select');
    const previous = book.locator('.book-edge.is-prev');
    const next = book.locator('.book-edge.is-next');
    const footerPrevious = book.locator('.book-turn.is-prev');
    // The lesson directory sits in the heading row, so the heading's last
    // action is the stop just before the book.
    const headingActions = page.locator('#tbLessonHeading .page-heading-action');
    const lastAction = headingActions.last();
    const phone = viewport.width === 390;
    if (phone) {
      await expect(previous).toBeHidden();
      await expect(next).toBeHidden();
    }
    for (const [from, key, expected, afterNextTab] of [
      [phone ? lastAction : previous, 'Tab', phone ? footerPrevious : next, phone ? pages : footerPrevious],
      [
        phone ? footerPrevious : next,
        'Shift+Tab',
        phone ? lastAction : previous,
        phone ? headingActions.nth(-2) : lastAction,
      ],
    ]) {
      await pages.selectOption(spread);
      await from.focus();
      await page.keyboard.press(key);
      await expect(expected).toBeFocused();
      await expect(expected).toBeInViewport();
      // Include native scroll settling and the page-turn animation, then keep
      // walking in the same direction to rule out a focus loop.
      await page.waitForTimeout(300);
      await expect(pages).toHaveValue(spread);
      await page.keyboard.press(key);
      await expect(afterNextTab).toBeFocused();
      await page.waitForTimeout(300);
      await expect(pages).toHaveValue(spread);
      await settleBook(book);
      expect(
        await book.locator('.book-body').evaluate((body) => {
          const stride = body.clientWidth + parseFloat(getComputedStyle(body).columnGap);
          return Math.abs(
            body.scrollLeft - Number(body.parentElement.querySelector('.book-page-select').value) * stride,
          );
        }),
      ).toBeLessThanOrEqual(1);
    }
    expect(errors).toEqual([]);
  });
}

// DF-18 (phone dogfood 2026-10-30): the word read-through turned the book
// back and seemed to read out of order. The phone draws 顺序朗读 6px left of
// its page, so focusing it on a tap counted it on the page before; and a turn
// left focus on the old page while the page change laid the book out again
// (the phone shell does on every change), which turned straight back to it.
async function readThroughBook(page, viewport) {
  const { silentOgg } = require('./audio-fixtures');
  const word = silentOgg(0.4);
  await page.route(/\.ogg(?:\?|$)/, (route) =>
    route.fulfill({ status: 200, contentType: 'audio/ogg', body: word }),
  );
  await page.setViewportSize(viewport);
  const { book, errors } = await openBook(page, 'lesson');
  await book.evaluate((frame) => {
    const textbook = ModuleSwitcher.getTextbookModule();
    const pager = textbook._bookPager;
    textbook.vocabLoopRepeatCount = 1;
    textbook.vocabLoopDelayMs = 50;
    // A page change that lays the book out again, as the phone shell does.
    const onChange = pager.options.onChange;
    let relaying = false;
    pager.options.onChange = function (changed) {
      if (onChange) onChange.apply(this, arguments);
      if (relaying) return;
      relaying = true;
      try {
        changed.refresh();
      } finally {
        relaying = false;
      }
    };
    const style = document.createElement('style');
    style.textContent = '#tbReader .tb-vocab-loop-btn { margin-left: -6px; }';
    document.head.appendChild(style);
    // Each word read: its place in the list, the page shown, and its page.
    window.__readThrough = [];
    const sync = textbook._syncActiveVocabState;
    textbook._syncActiveVocabState = function () {
      const result = sync.apply(this, arguments);
      const index = this.ttsState.activeVocabIndex;
      const log = window.__readThrough;
      if (this.ttsState.mode === 'vocab-loop' && index >= 0 && (!log.length || log.at(-1).index !== index)) {
        const row = frame.querySelector(`.book-body .tb-reading-vocab-row[data-vocab-index="${index}"]`);
        log.push({ index, shown: pager.page, page: Math.floor(pager.columnOf(row) / pager.perSpread) });
      }
      return result;
    };
    frame.closest('#tbReader').querySelector('.book-body').focus({ preventScroll: true });
  });
  return { book, errors };
}

async function showSpreadOf(book, selector) {
  // Late fonts and the cover can lay the book out again; turn after them.
  await settleBook(book);
  await book.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  return book.evaluate((frame, selector) => {
    const pager = ModuleSwitcher.getTextbookModule()._bookPager;
    const element = frame.querySelector(selector);
    pager.goTo(
      Math.floor(
        pager.columnOf(element.closest('.tb-section-head, .tb-vocab-loop-bar, .tb-reading-vocab-row')) /
          pager.perSpread,
      ),
      false,
    );
    return pager.page;
  }, selector);
}

test('book focus: the word read-through starts on its page and reads the first words there (DF-18)', async ({
  page,
}) => {
  const { book, errors } = await readThroughBook(page, { width: 390, height: 844 });
  const button = book.locator('.book-body .tb-vocab-loop-btn');
  const shown = await showSpreadOf(book, '.tb-vocab-loop-btn');
  // A control a few pixels into the gap before its page is on that page.
  expect(
    await button.evaluate((element) => {
      const pager = ModuleSwitcher.getTextbookModule()._bookPager;
      return pager.columnOf(element) === pager.columnOf(element.closest('.tb-vocab-loop-bar'));
    }),
  ).toBe(true);
  await button.click();
  await expect(button).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.__readThrough.length)).toBeGreaterThanOrEqual(3);
  const log = await page.evaluate(() => window.__readThrough.slice(0, 3));
  expect(log.map((entry) => entry.index)).toEqual([0, 1, 2]);
  for (const entry of log) expect(entry).toEqual({ index: entry.index, shown, page: shown });
  await page.evaluate(() => ModuleSwitcher.getTextbookModule()._stopTtsPlayback());
  expect(errors).toEqual([]);
});

test('book focus: the word read-through from a middle word turns to each word in order (DF-18)', async ({
  page,
}) => {
  // Two pages a spread, as on a tablet or desktop.
  const { book, errors } = await readThroughBook(page, { width: 1600, height: 900 });
  // The last word of a spread with words after it: reading from it turns.
  const start = await book.evaluate((frame) => {
    const pager = ModuleSwitcher.getTextbookModule()._bookPager;
    const rows = [...frame.querySelectorAll('.book-body .tb-reading-vocab-row')];
    const pageOf = (row) => Math.floor(pager.columnOf(row) / pager.perSpread);
    const index = rows.findIndex(
      (row, i) => i > 0 && i + 2 < rows.length && pageOf(rows[i + 1]) > pageOf(row),
    );
    return Number(rows[index].getAttribute('data-vocab-index'));
  });
  expect(start).toBeGreaterThan(0);
  const word = book.locator(
    `.book-body .tb-reading-vocab-row[data-vocab-index="${start}"] .tb-reading-vocab-open`,
  );
  const shown = await showSpreadOf(book, `.tb-reading-vocab-row[data-vocab-index="${start}"]`);
  // Focus stays on the word the reader pressed (the phone's player seeks
  // here; the web's 从此朗读 sits in the same row).
  await word.focus();
  await page.evaluate(
    (index) => ModuleSwitcher.getTextbookModule()._handleTtsButtonClick(`vocab-loop-from:${index}`),
    start,
  );
  await expect.poll(() => page.evaluate(() => window.__readThrough.length)).toBeGreaterThanOrEqual(3);
  const log = await page.evaluate(() => window.__readThrough.slice(0, 3));
  expect(log.map((entry) => entry.index)).toEqual([start, start + 1, start + 2]);
  expect(log[0].shown).toBe(shown);
  expect(log[1].page).toBeGreaterThan(shown);
  for (const entry of log) expect(entry.shown).toBe(entry.page);
  // Nothing turns back after the word: the shown page stays on it.
  await page.waitForTimeout(300);
  const settled = await page.evaluate(() => {
    const textbook = ModuleSwitcher.getTextbookModule();
    const pager = textbook._bookPager;
    const row = document.querySelector(
      `#tbReader .book-body .tb-reading-vocab-row[data-vocab-index="${textbook.ttsState.activeVocabIndex}"]`,
    );
    return { shown: pager.page, page: Math.floor(pager.columnOf(row) / pager.perSpread) };
  });
  expect(settled.shown).toBe(settled.page);
  await page.evaluate(() => ModuleSwitcher.getTextbookModule()._stopTtsPlayback());
  expect(errors).toEqual([]);
});
