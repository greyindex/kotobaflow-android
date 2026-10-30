const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  IS_CONDITION,
  INSET_CONDITION,
  FLEX_GAP_CONDITION,
  compatCss,
  expandSelectorList,
  insetLonghands,
  subjectKey,
} = require("./css-compat");

// The additions only: what an old WebView reads beyond the original rules.
function additions(css, options) {
  return compatCss(css, options).insertions.map(([, text]) => text.trim());
}

function withoutAdditions(css, options) {
  const result = compatCss(css, options);
  let out = result.css;
  for (const [, text] of result.insertions) out = out.replace(text, "");
  return out;
}

test(":is() lists expand into plain selectors; :where() only for types", () => {
  assert.equal(
    expandSelectorList(".a :is(.b, .c) > p"),
    ".a .b > p, .a .c > p",
  );
  assert.equal(expandSelectorList(":where(h1, h2) + p"), "h1 + p, h2 + p");
  assert.equal(expandSelectorList(":where(.quiet) p"), null);
  // A complex argument attached to a compound would change the match.
  assert.equal(expandSelectorList(".a:is(.b .c)"), null);
  assert.deepEqual(additions(".a :is(.b, .c) { color: red; }"), [
    `${IS_CONDITION} { .a .b, .a .c { color: red; } }`,
  ]);
  assert.deepEqual(additions(".a:has(.b) :is(.c, .d) { color: red; }"), []);
});

test("inset becomes its four sides for engines without the shorthand", () => {
  assert.deepEqual(insetLonghands("0 auto"), [
    "top: 0",
    "right: auto",
    "bottom: 0",
    "left: auto",
  ]);
  assert.deepEqual(insetLonghands("4px !important"), [
    "top: 4px !important",
    "right: 4px !important",
    "bottom: 4px !important",
    "left: 4px !important",
  ]);
  assert.deepEqual(additions(".x { position: absolute; inset: 0; }"), [
    `${INSET_CONDITION} { .x { top: 0; right: 0; bottom: 0; left: 0; } }`,
  ]);
});

test("flex gap becomes margins along the flex direction", () => {
  assert.deepEqual(additions(".row { display: flex; gap: 8px; }"), [
    `${FLEX_GAP_CONDITION} { .row > * + * { margin-left: 8px; } }`,
  ]);
  assert.deepEqual(
    additions(".col { display: flex; flex-direction: column; gap: 4px 0; }"),
    [`${FLEX_GAP_CONDITION} { .col > * + * { margin-top: 4px; } }`],
  );
  assert.deepEqual(
    additions(
      ".back { display: inline-flex; flex-flow: row-reverse; column-gap: var(--g); }",
    ),
    [`${FLEX_GAP_CONDITION} { .back > * + * { margin-right: var(--g); } }`],
  );
  // A wrapping row cannot select the first item of its later lines, so every
  // item keeps the gap on its trailing and bottom edges.
  assert.deepEqual(
    additions(".chips { display: flex; flex-wrap: wrap; gap: 6px 8px; }"),
    [
      `${FLEX_GAP_CONDITION} { .chips > * { margin-right: 8px; margin-bottom: 6px; } }`,
    ],
  );
  // Grids keep their gap in every engine.
  assert.deepEqual(additions(".grid { display: grid; gap: 8px; }"), []);
});

test("flex gap margins wait for the cascade to agree", () => {
  // Another rule can turn the row into a column: no margins guessed.
  assert.deepEqual(
    additions(
      ".x { display: flex; gap: 8px; } .x.is-stacked { flex-direction: column; }",
    ),
    [],
  );
  // The related stylesheet makes the same element a grid on a phone.
  assert.deepEqual(
    additions(".y { display: flex; gap: 8px; }", {
      related: ["html[data-mobile] .y { display: grid; }"],
    }),
    [],
  );
  // display: none is not a different layout.
  assert.equal(
    additions(".z { display: flex; gap: 8px; } .z[hidden] { display: none; }")
      .length,
    1,
  );
  // A pseudo-element subject has no children to space.
  assert.deepEqual(additions(".a::before { display: flex; gap: 8px; }"), []);
});

test("gap overrides follow the rule that made the element flex", () => {
  const web =
    ".stack { display: flex; flex-direction: column; gap: 4px; } .row { display: flex; gap: 8px; }";
  const mobile =
    "html[data-m] .stack { gap: 12px; } html[data-m] .row { gap: 0; } html[data-m] .free { gap: 6px; }";
  assert.deepEqual(additions(mobile, { related: [web] }), [
    `${FLEX_GAP_CONDITION} { html[data-m] .stack > * + * { margin-top: 12px; } }`,
    // A zero gap undoes the margins added for the wider one.
    `${FLEX_GAP_CONDITION} { html[data-m] .row > * + * { margin-left: 0; } }`,
  ]);
  // A zero gap with nothing to undo adds nothing.
  assert.deepEqual(additions(".q { display: flex; gap: 0; }"), []);
});

test("additions sit after their rule and keep every original byte", () => {
  const css = [
    "/* head */",
    "@media (max-width: 600px) { .a :is(.b, .c) { inset: 0; } .row { display: flex; gap: 2px; } }",
    ".tail { color: red; }",
    "",
  ].join("\n");
  assert.equal(withoutAdditions(css), css);
  const out = compatCss(css).css;
  assert.ok(
    out.indexOf(FLEX_GAP_CONDITION) < out.indexOf(".tail"),
    "the row's margins stay inside its media block, ahead of later rules",
  );
});

test("subjects are named by their first class, else id, else type", () => {
  assert.equal(subjectKey("html[data-a] #main .card.is-open:hover"), ".card");
  assert.equal(subjectKey(".list > #only"), "#only");
  assert.equal(subjectKey(".list > li:not(.x)"), "li");
  assert.equal(subjectKey(".a::after"), null);
});

test("the packaged stylesheets compile with balanced additions", (t) => {
  const mobileRoot = path.resolve(__dirname, "..");
  const webRoot = path.resolve(
    process.env.KOTOBAFLOW_WEB_ROOT ||
      path.join(mobileRoot, "web-source-backup"),
  );
  const webCss = path.join(webRoot, "style.css");
  if (!fs.existsSync(webCss)) {
    t.skip("web copy not present");
    return;
  }
  const web = fs.readFileSync(webCss, "utf8");
  const mobile = fs.readFileSync(
    path.join(mobileRoot, "runtime", "mobile-layout.css"),
    "utf8",
  );
  for (const [css, related] of [
    [web, [mobile]],
    [mobile, [web]],
  ]) {
    const result = compatCss(css, { related });
    assert.equal(withoutAdditions(css, { related }), css);
    for (const [, text] of result.insertions) {
      assert.match(
        text.trim(),
        /^@supports not (selector\(:is\(a\)\)|\(inset: 0\)|\(appearance: none\)) \{/,
      );
      const opens = (text.match(/\{/g) || []).length;
      assert.equal(opens, (text.match(/\}/g) || []).length, text);
    }
  }
});
