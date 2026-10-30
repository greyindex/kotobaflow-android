// Old Android WebViews (Chrome 83 on API 30) drop every rule whose selector
// uses :is() or :where(), ignore the inset shorthand, and lay out flex
// containers without their gap. The packaged stylesheets keep every original
// rule byte for byte and add, right after each affected rule, an equivalent
// that such engines understand, inside a condition only they match. Modern
// engines skip the additions, and the additions keep their original place in
// the cascade.
//
//   .a :is(.b, .c) { … }  →  …and then
//   @supports not selector(:is(a)) { .a .b, .a .c { … } }
//
// Expansion is textual: :is(A, B) becomes one selector per argument. A
// :where() list is expanded only when it holds type selectors, because a
// :where() of classes or pseudo-classes is meant to lose to everything and
// its expansion would not. Rules that :has() or an unsafe expansion would
// change (a complex argument attached to a compound) are left alone.
//
// Flex gap arrived in Chrome 84 together with the unprefixed appearance
// property, so "not (appearance: none)" picks out exactly the engines that
// lay flex items out without it. Their additions space the items with
// margins instead:
//
//   .row { display: flex; gap: 8px }  →  …and then
//   @supports not (appearance: none) { .row > * + * { margin-left: 8px; } }
//
// Whether an element is a flex row or column is a cascade question a text
// pass cannot settle, so the pass looks up every rule in the related
// stylesheets that names the same subject (its first class, else id, else
// type) and adds margins only when they agree: flex and nothing but flex,
// one direction. Wrapping rows space every item on its trailing and bottom
// edges, the pre-gap idiom, since a row's first item cannot be selected.
"use strict";

const IS_CONDITION = "@supports not selector(:is(a))";
const INSET_CONDITION = "@supports not (inset: 0)";
const FLEX_GAP_CONDITION = "@supports not (appearance: none)";
const GROUP_RULES = new Set(["media", "supports", "layer", "document"]);

function skipComment(css, at) {
  const end = css.indexOf("*/", at + 2);
  return end < 0 ? css.length : end + 2;
}

function skipString(css, at) {
  const quote = css[at];
  let i = at + 1;
  while (i < css.length && css[i] !== quote) i += css[i] === "\\" ? 2 : 1;
  return i + 1;
}

// Index of the brace closing the block that opens at `open`.
function blockEnd(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") i = skipComment(css, i) - 1;
    else if (c === '"' || c === "'") i = skipString(css, i) - 1;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  throw new Error(`Unclosed CSS block at ${open}`);
}

// Splits at top-level separators, outside brackets, parentheses and strings.
function splitTop(text, separator) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") i = skipString(text, i) - 1;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && c === separator) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

// The first :is( or :where( outside any other parentheses.
function firstFunctional(selector) {
  let depth = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === '"' || c === "'") i = skipString(selector, i) - 1;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && c === ":") {
      const kind = /^:(is|where)\(/.exec(selector.slice(i));
      if (kind)
        return { start: i, open: i + kind[0].length - 1, kind: kind[1] };
    }
  }
  return null;
}

function closingParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") i = skipString(text, i) - 1;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  throw new Error(`Unclosed selector function: ${text}`);
}

function hasCombinator(selector) {
  const flat = selector
    .replace(/\([^()]*\)/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .trim();
  return /[\s>+~]/.test(flat);
}

// All plain selectors one complex selector stands for, or null if unsafe.
function expandComplex(selector) {
  const found = firstFunctional(selector);
  if (!found) return [selector.trim()];
  const close = closingParen(selector, found.open);
  const args = splitTop(selector.slice(found.open + 1, close), ",").map((arg) =>
    arg.trim(),
  );
  if (args.some((arg) => !arg)) return null;
  if (
    found.kind === "where" &&
    !args.every((arg) => /^[a-z][a-z0-9-]*$/i.test(arg))
  )
    return null;
  const before = selector.slice(0, found.start);
  const after = selector.slice(close + 1);
  const attached = before.length > 0 && !/[\s>+~,(]$/.test(before);
  const result = [];
  for (const arg of args) {
    if (hasCombinator(arg) && attached) return null;
    const expanded = expandComplex(before + arg + after);
    if (!expanded) return null;
    result.push(...expanded);
  }
  return result;
}

function expandSelectors(selectorText) {
  const selectors = [];
  for (const complex of splitTop(selectorText, ",")) {
    const expanded = expandComplex(complex.trim());
    if (!expanded) return null;
    for (const selector of expanded)
      if (!selectors.includes(selector)) selectors.push(selector);
  }
  return selectors;
}

function expandSelectorList(selectorText) {
  const selectors = expandSelectors(selectorText);
  return selectors && selectors.join(", ");
}

const INSET_SIDES = ["top", "right", "bottom", "left"];

// top/right/bottom/left for an inset value, as the shorthand assigns them.
function insetLonghands(value) {
  const important = /\s*!important\s*$/i.exec(value);
  const core = important ? value.slice(0, important.index) : value;
  const parts = splitTop(core.trim(), " ").filter(Boolean);
  if (!parts.length || parts.length > 4) return null;
  const [t, r = t, b = t, l = r] = parts;
  const suffix = important ? " !important" : "";
  return [t, r, b, l].map((part, i) => `${INSET_SIDES[i]}: ${part}${suffix}`);
}

// The declarations with every inset written as its four sides. `only`
// returns just those sides (for an engine that applies the rest already).
function rewriteInset(declarations, only) {
  const out = [];
  let changed = false;
  for (const declaration of splitTop(stripComments(declarations), ";")) {
    const match = /^\s*inset\s*:([\s\S]*)$/i.exec(declaration);
    const sides = match && insetLonghands(match[1].trim());
    if (sides) {
      out.push(...sides);
      changed = true;
    } else if (!only && declaration.trim()) out.push(declaration.trim());
  }
  if (!changed && only) return null;
  return out.length ? ` ${out.join("; ")}; ` : null;
}

// ─── Flex gap ──────────────────────────────────────────────────────────────

const DIRECTIONS = new Set(["row", "row-reverse", "column", "column-reverse"]);
const WRAPS = new Set(["nowrap", "wrap", "wrap-reverse"]);

function isFlexDisplay(value) {
  return value === "flex" || value === "inline-flex";
}

function isZeroGap(value) {
  return value === "normal" || /^0(?:\.0+)?(?:[a-z%]+)?$/i.test(value);
}

// The flex-relevant declarations of one block, last one winning.
function flexDeclarations(declarations) {
  const found = {};
  for (const declaration of splitTop(stripComments(declarations), ";")) {
    const match = /^\s*([a-z-]+)\s*:([\s\S]*)$/i.exec(declaration);
    if (!match) continue;
    const name = match[1].toLowerCase();
    const raw = match[2].trim();
    const important = /\s*!important$/i.test(raw);
    const value = raw.replace(/\s*!important$/i, "").trim();
    const lower = value.toLowerCase();
    if (name === "display") found.display = lower;
    else if (name === "flex-direction") found.direction = lower;
    else if (name === "flex-wrap") found.wrap = lower;
    else if (name === "flex-flow") {
      for (const part of lower.split(/\s+/)) {
        if (DIRECTIONS.has(part)) found.direction = part;
        else if (WRAPS.has(part)) found.wrap = part;
      }
    } else if (name === "gap" || name === "row-gap" || name === "column-gap") {
      const parts = splitTop(value, " ").filter(Boolean);
      const gap = found.gap || { row: "normal", column: "normal" };
      if (name === "gap") {
        if (!parts.length || parts.length > 2) continue;
        gap.row = parts[0];
        gap.column = parts[1] || parts[0];
      } else gap[name === "row-gap" ? "row" : "column"] = value;
      gap.important = gap.important || important;
      found.gap = gap;
    }
  }
  return found;
}

// The element a selector styles, by its first class, else id, else type.
function subjectKey(selector) {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === '"' || c === "'") i = skipString(selector, i) - 1;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && /[\s>+~]/.test(c)) start = i + 1;
  }
  let compound = selector.slice(start).trim();
  if (!compound || compound.includes("::")) return null;
  for (let previous = ""; previous !== compound;) {
    previous = compound;
    compound = compound.replace(/\([^()]*\)/g, "").replace(/\[[^\]]*\]/g, "");
  }
  const named =
    /\.(-?[_a-z][\w-]*)/i.exec(compound) || /#(-?[_a-z][\w-]*)/i.exec(compound);
  if (named) return named[0];
  const type = /^[a-z][a-z0-9-]*/i.exec(compound);
  return type ? type[0].toLowerCase() : null;
}

// Every style rule in [start, end), with its prelude and declarations.
function walkRules(css, start, end, visit) {
  let i = start;
  while (i < end) {
    const c = css[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "/" && css[i + 1] === "*") {
      i = skipComment(css, i);
      continue;
    }
    let k = i;
    let depth = 0;
    while (k < end) {
      const d = css[k];
      if (d === "/" && css[k + 1] === "*") {
        k = skipComment(css, k);
        continue;
      }
      if (d === '"' || d === "'") {
        k = skipString(css, k);
        continue;
      }
      if (d === "(") depth++;
      else if (d === ")") depth--;
      else if (depth === 0 && (d === "{" || d === ";")) break;
      k++;
    }
    if (k >= end) break;
    const prelude = css.slice(i, k);
    if (css[k] === ";") {
      i = k + 1;
      continue;
    }
    const close = blockEnd(css, k);
    const trimmed = stripComments(prelude).trim();
    if (trimmed.startsWith("@")) {
      const name = /^@([a-z-]+)/i.exec(trimmed)[1].toLowerCase();
      if (GROUP_RULES.has(name)) walkRules(css, k + 1, close, visit);
    } else visit(trimmed, css.slice(k + 1, close), close);
    i = close + 1;
  }
}

function plainSelectors(selectorText) {
  if (/:has\(/.test(selectorText)) return null;
  return /:(is|where)\(/.test(selectorText)
    ? expandSelectors(selectorText)
    : splitTop(selectorText, ",").map((selector) => selector.trim());
}

// What the related stylesheets say about each subject's flex layout. A rule
// that makes the subject flex contributes its direction and wrap, or the
// initial row and nowrap; any other rule only what it declares.
function flexRegistry(sheets) {
  const registry = new Map();
  for (const css of sheets)
    walkRules(css, 0, css.length, (selectorText, declarations) => {
      const found = flexDeclarations(declarations);
      if (!found.display && !found.direction && !found.wrap && !found.gap)
        return;
      const selectors =
        plainSelectors(selectorText) ||
        splitTop(selectorText, ",").map((selector) => selector.trim());
      for (const selector of selectors) {
        const key = subjectKey(selector);
        if (!key) continue;
        if (!registry.has(key))
          registry.set(key, {
            displays: new Set(),
            directions: new Set(),
            wraps: new Set(),
            gapped: false,
          });
        const entry = registry.get(key);
        const establishes = isFlexDisplay(found.display);
        if (found.display) entry.displays.add(found.display);
        if (found.direction || establishes)
          entry.directions.add(found.direction || "row");
        if (found.wrap || establishes) entry.wraps.add(found.wrap || "nowrap");
        if (
          found.gap &&
          (!isZeroGap(found.gap.row) || !isZeroGap(found.gap.column))
        )
          entry.gapped = true;
      }
    });
  return registry;
}

// Margins standing in for a rule's flex gap, keyed by the child selector.
function gapMargins(selector, found, registry) {
  if (/::/.test(selector)) return null;
  const key = subjectKey(selector);
  const entry = key && registry.get(key);
  if (!entry) return null;
  const displays = [...entry.displays].filter((value) => value !== "none");
  if (found.display ? !isFlexDisplay(found.display) : !displays.length)
    return null;
  if (!displays.every(isFlexDisplay)) return null;
  if (entry.directions.size !== 1) return null;
  const [direction] = entry.directions;
  const wrapping = entry.wraps.has("wrap") || entry.wraps.has("wrap-reverse");
  const { row, column, important } = found.gap;
  const zero = isZeroGap(row) && isZeroGap(column);
  if (zero && !entry.gapped) return null;
  const length = (value) => (isZeroGap(value) ? "0" : value);
  const suffix = important ? " !important" : "";
  const declare = (side, value) => `margin-${side}: ${length(value)}${suffix}`;
  if (direction === "column" || direction === "column-reverse")
    return isZeroGap(row) && !zero
      ? null
      : {
          child: "> * + *",
          body: declare(direction === "column" ? "top" : "bottom", row),
        };
  if (wrapping) {
    const parts = [];
    if (!isZeroGap(column) || zero)
      parts.push(declare(direction === "row" ? "right" : "left", column));
    if (!isZeroGap(row) || zero) parts.push(declare("bottom", row));
    return { child: "> *", body: parts.join("; ") };
  }
  return isZeroGap(column) && !zero
    ? null
    : {
        child: "> * + *",
        body: declare(direction === "row" ? "left" : "right", column),
      };
}

function gapFallback(selectors, declarations, registry) {
  const found = flexDeclarations(declarations);
  if (!found.gap) return "";
  const groups = new Map();
  for (const selector of selectors) {
    const margins = gapMargins(selector, found, registry);
    if (!margins) continue;
    if (!groups.has(margins.body)) groups.set(margins.body, []);
    groups.get(margins.body).push(`${selector} ${margins.child}`);
  }
  let out = "";
  for (const [body, children] of groups)
    out += `\n${FLEX_GAP_CONDITION} { ${children.join(", ")} { ${body}; } }`;
  return out;
}

function compatBlock(selectorText, declarations, registry) {
  let out = "";
  if (/:(is|where)\(/.test(selectorText)) {
    if (/:has\(/.test(selectorText)) return "";
    const expanded = expandSelectors(selectorText);
    const body = rewriteInset(declarations, false);
    if (!expanded || !body) return "";
    out += `\n${IS_CONDITION} { ${expanded.join(", ")} {${body}} }`;
  } else {
    const sides = rewriteInset(declarations, true);
    if (sides) out += `\n${INSET_CONDITION} { ${selectorText} {${sides}} }`;
  }
  const selectors = plainSelectors(selectorText);
  if (selectors) out += gapFallback(selectors, declarations, registry);
  return out;
}

// `related` lists the other stylesheets the same document loads, whose rules
// can turn this sheet's flex rows into columns or grids.
function compatCss(css, { related = [] } = {}) {
  const registry = flexRegistry([css, ...related]);
  const edits = [];
  walkRules(css, 0, css.length, (selectorText, declarations, close) => {
    const text = compatBlock(selectorText, declarations, registry);
    if (text) edits.push([close + 1, text]);
  });
  let out = "";
  let last = 0;
  for (const [at, text] of edits) {
    out += css.slice(last, at) + text;
    last = at;
  }
  return { css: out + css.slice(last), insertions: edits };
}

module.exports = {
  IS_CONDITION,
  INSET_CONDITION,
  FLEX_GAP_CONDITION,
  compatCss,
  expandSelectorList,
  flexRegistry,
  insetLonghands,
  subjectKey,
};
