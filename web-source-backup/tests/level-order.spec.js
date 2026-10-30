const { test, expect } = require('@playwright/test');
const { DEFAULT_LAYOUT_STORAGE, openReadyApp, revealControl } = require('./helpers');

test.use({ serviceWorkers: 'block', storageState: DEFAULT_LAYOUT_STORAGE });

test.beforeEach(async ({ page }) => {
  await page.route('**/js/storage-config.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: "window.JPLearnStorageConfig = Object.freeze({ mode: 'browser' });",
    }),
  );
});

// The levels of a list in the order they first appear, e.g. N5, N4, N3.
const levelRuns = () => {
  const levels = window.grammarModule.grammarList.filtered.map((item) => item.level);
  return levels.filter((level, index) => index === 0 || level !== levels[index - 1]);
};

test('ART-12 level order starts at the target, goes up, then down; unknown levels go last, ties stay put', async ({
  page,
}) => {
  const errors = await openReadyApp(page, { module: 'dashboard' });
  const order = await page.evaluate(() => {
    const items = ['N1', 'N5', '', 'N3', 'N2', 'N4', undefined, 'N5', 'N1'].map((level, id) => ({
      level,
      id,
    }));
    const ids = (target) =>
      window.JPLearn.levelOrder.sort(items, null, target).map((item) => `${item.level || '-'}:${item.id}`);
    return { n5: ids('N5'), n3: ids('N3'), n1: ids('N1'), stored: window.JPLearn.levelOrder.target() };
  });
  expect(order.stored).toBe('N5');
  expect(order.n5).toEqual(['N5:1', 'N5:7', 'N4:5', 'N3:3', 'N2:4', 'N1:0', 'N1:8', '-:2', '-:6']);
  expect(order.n3).toEqual(['N3:3', 'N2:4', 'N1:0', 'N1:8', 'N4:5', 'N5:1', 'N5:7', '-:2', '-:6']);
  expect(order.n1).toEqual(['N1:0', 'N1:8', 'N2:4', 'N3:3', 'N4:5', 'N5:1', 'N5:7', '-:2', '-:6']);
  expect(errors).toEqual([]);
});

test('ART-12 grammar list opens at N5 and follows the learning plan target', async ({ page }) => {
  const errors = await openReadyApp(page, { module: 'grammar' });
  const list = page.locator('#gmGrammarList');
  await expect(list.locator('.gm-card').first().locator('.gm-card-level')).toHaveText('N5');
  expect(await page.evaluate(levelRuns)).toEqual(['N5', 'N4', 'N3', 'N2', 'N1']);

  await page.evaluate(() =>
    window.ProgressStore.updatePlan({ ...window.ProgressStore.getPlan(), jlptTarget: 'N3' }),
  );
  await page.locator('#modBtnVocab').click();
  await page.locator('#modBtnGrammar').click();
  await expect(list.locator('.gm-card').first().locator('.gm-card-level')).toHaveText('N3');
  expect(await page.evaluate(levelRuns)).toEqual(['N3', 'N2', 'N1', 'N4', 'N5']);

  // A level filter still shows only that level, in the index order of the data.
  const indexes = await page.evaluate(() => {
    const view = window.grammarModule.grammarList;
    view.levelFilter = 'N2';
    view._applyFilters();
    return view.filtered.map((item) => item.index);
  });
  expect(indexes.length).toBeGreaterThan(10);
  expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
  expect(errors).toEqual([]);
});

test('ART-12 vocabulary opens sorted by level and keeps the data order inside a level', async ({ page }) => {
  const errors = await openReadyApp(page, { module: 'vocab' });
  const book = page.locator('#card-container .book-frame');
  await expect(book.locator('.cc-card').first()).toHaveAttribute('data-level', 'N5');
  const state = await page.evaluate(() => {
    const mode = window.appConfig.cardMode;
    const words = mode.displayWords;
    return {
      sortMode: mode.sortMode,
      runs: words
        .map((word) => word.level)
        .filter((level, index, all) => index === 0 || level !== all[index - 1]),
      n5: words.filter((word) => word.level === 'N5').map((word) => word.index),
      source: mode.filteredWords.filter((word) => word.level === 'N5').map((word) => word.index),
      total: words.length,
      filtered: mode.filteredWords.length,
    };
  });
  expect(state.sortMode).toBe('level');
  expect(state.runs).toEqual(['N5', 'N4', 'N3', 'N2', 'N1']);
  expect(state.n5).toEqual(state.source);
  expect(state.total).toBe(state.filtered);

  await revealControl(page.locator('#ccSortSelect'));
  await expect(page.locator('#ccSortSelect')).toHaveValue('level');
  await expect(page.locator('#ccSortSelect option').first()).toHaveText('按等级');
  // Another sort leaves the level order and the book returns to its first spread.
  await book.locator('.book-page-select').selectOption('1');
  await page.locator('#ccSortSelect').selectOption('alpha');
  await expect(book.locator('.book-page-select')).toHaveValue('0');
  await page.locator('#ccSortSelect').selectOption('level');
  await expect(book.locator('.cc-card').first()).toHaveAttribute('data-level', 'N5');
  expect(errors).toEqual([]);
});

test('ART-18 a grammar title shows its first form, counts the rest and drops a repeated connection', async ({
  page,
}) => {
  const errors = await openReadyApp(page, { module: 'grammar' });
  await page.evaluate(() => {
    const view = window.grammarModule.grammarList;
    view.searchQuery = 'いかん';
    view._applyFilters();
    view._render();
  });
  const card = page.locator('#gmGrammarList .gm-card', { hasText: 'いかんで' }).first();
  await expect(card.locator('.gm-card-title')).toContainText('～いかんで');
  await expect(card.locator('.gm-card-title')).not.toContainText('いかんでは');
  await expect(card.locator('.gm-card-title-more')).toHaveText(/^等 \d+ 种形式$/);
  await expect(card).toHaveAttribute('aria-label', /いかんでは/);

  const forms = await page.evaluate(() => ({
    prefix: grammarTitleForms('お/ご～する'),
    brackets: grammarTitleForms('可能助动词「れる/られる」'),
    pair: grammarTitleForms('たとえ/たとい～ても'),
    plain: grammarTitleForms('～あっての'),
    two: grammarTitleForms('～（よ）うが/（よ）うと'),
  }));
  expect(forms).toEqual({
    prefix: ['お/ご～する'],
    brackets: ['可能助动词「れる/られる」'],
    pair: ['たとえ/たとい～ても'],
    plain: ['～あっての'],
    two: ['～（よ）うが', '（よ）うと'],
  });

  // A connection equal to the title (without its leading ～) is not repeated.
  await page.evaluate(() => {
    const view = window.grammarModule.grammarList;
    view.searchQuery = '（よ）うが/（よ）うと';
    view._applyFilters();
    view._render();
  });
  const repeated = page.locator('#gmGrammarList .gm-card', { hasText: '（よ）うが' }).first();
  await expect(repeated.locator('.gm-card-title-more')).toHaveText('等 2 种形式');
  await expect(repeated.locator('.gm-card-connection')).toHaveCount(0);
  expect(errors).toEqual([]);
});
