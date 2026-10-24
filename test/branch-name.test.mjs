// Tests of the pure branch-name functions, with Abastio's cases from scripts/issue.test.sh.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  branchProblem,
  branchType,
  hasBranchBlock,
  isSlug,
  renderBranch,
  suggestedBranch,
  suggestedSlug,
  titleSlug,
  withSlugBlock,
} from "../dist/branch-name.js";
import { DEFAULT_CONFIG } from "../dist/config.js";

const RULES = DEFAULT_CONFIG.branch.types;

test("suggestedBranch: the backticks after the heading, on its line or the next non-empty one", () => {
  const block = "Cabecera.\n\n**Rama sugerida**\n\n`feat/214-odoo-return-refund-notice`\n\n**Detalle**";

  assert.equal(suggestedBranch(block), "feat/214-odoo-return-refund-notice");
  assert.equal(suggestedBranch("**Rama sugerida:** `fix/7-cart`"), "fix/7-cart");
  assert.equal(suggestedBranch("**Rama sugerida**\r\n`fix/9-a-b`\r\n"), "fix/9-a-b");
  assert.equal(suggestedBranch("Solo texto con `feat/1-x`."), null);
  assert.equal(suggestedBranch("**Rama sugerida**\nsin backticks\n`fix/1-x`"), null);
  assert.equal(suggestedBranch("**Rama sugerida**"), null);
});

test("suggestedSlug reads only the slug block, and hasBranchBlock sees either block", () => {
  assert.equal(suggestedSlug("H.\n\n**Slug de rama**\n\n`cart-total`\n\n**Detalle**"), "cart-total");
  assert.equal(suggestedSlug("**Slug de rama:** `cart`"), "cart");
  assert.equal(suggestedSlug("**Rama sugerida**\n`fix/7-cart`"), null);
  assert.equal(suggestedBranch("**Slug de rama**\n`cart`"), null);
  assert.equal(hasBranchBlock("**Slug de rama**\n`cart`"), true);
  assert.equal(hasBranchBlock("**Rama sugerida:** `fix/7-cart`"), true);
  assert.equal(hasBranchBlock("Header.\n\n**Detalle**"), false);
});

test("isSlug: lowercase words and single dashes, at most 40, no dash at the ends", () => {
  assert.equal(isSlug("cart-total-2"), true);
  assert.equal(isSlug("a".repeat(40)), true);
  for (const bad of ["Cart", "cart total", "fix/cart", "-cart", "cart-", "cart--total", "a".repeat(41), "", 7, null])
    assert.equal(isSlug(bad), false, String(bad));
});

test("branchProblem: <prefix>/<n>-<slug> of this issue, lowercase", () => {
  assert.equal(branchProblem("feat/214-odoo-return", 214), null);
  assert.equal(branchProblem("214-odoo-return", 214), null);
  assert.equal(branchProblem("ramon/sub/214-x", 214), null);
  assert.match(branchProblem(null, 214), /no "Rama sugerida" block/);
  assert.match(branchProblem("feat/api-formato-de-venta", 266), /is not <prefix>\/266-<slug>/);
  assert.match(branchProblem("feat/21-odoo", 214), /is not/);
  assert.match(branchProblem("feat/2140-odoo", 214), /is not/);
  assert.match(branchProblem("feat/214_Odoo", 214), /is not/);
  for (const unsafe of ["../../214-x", "-x/214-y", ".x/214-y", "a..b/214-x", "fix/214-a..b"])
    assert.match(branchProblem(unsafe, 214), /is not/, unsafe);
});

test("titleSlug: no type prefix, phase tag, accents or symbols, cut by whole words at 40", () => {
  assert.equal(
    titleSlug("bug: start-issue cuenta dos PRs al reempezar una issue con la misma rama"),
    "start-issue-cuenta-dos-prs-al-reempezar",
  );
  assert.equal(titleSlug("[F0-09] Transferencia confirmada a mano en el Admin"), "transferencia-confirmada-a-mano-en-el");
  assert.equal(titleSlug("mejora: Diseño del carro (año 2026) & más"), "diseno-del-carro-ano-2026-mas");
  assert.equal(titleSlug("a".repeat(60)), "a".repeat(40));
  assert.equal(titleSlug("bug: ¿?"), "issue");
  assert.equal(titleSlug("Tarea: algo nuevo", ["tarea:"]), "algo-nuevo");
});

test("branchType: a label wins over the title prefix, which ignores case", () => {
  assert.equal(branchType(RULES, ["docs-site", "bug"], "Mejora: x"), "fix");
  assert.equal(branchType(RULES, [], "Mejora: x"), "feat");
  assert.equal(branchType(RULES, ["P2: major"], "Algo"), null);
});

test("renderBranch: the template, and without a type no separator is left over", () => {
  assert.equal(renderBranch("{type}/{number}-{slug}", "fix", 42, "cart"), "fix/42-cart");
  assert.equal(renderBranch("{type}/{number}-{slug}", null, 42, "cart"), "42-cart");
  assert.equal(renderBranch("ramon/{type}-{number}-{slug}", null, 7, "x"), "ramon/7-x");
});

test("withSlugBlock: after the first paragraph, or alone in an empty body", () => {
  assert.equal(
    withSlugBlock("Header line.\nSecond line.\n\n**Detalle**\nText.", "x"),
    "Header line.\nSecond line.\n\n**Slug de rama**\n`x`\n\n**Detalle**\nText.",
  );
  assert.equal(withSlugBlock("Only a header.", "x"), "Only a header.\n\n**Slug de rama**\n`x`");
  assert.equal(withSlugBlock("  \n", "x"), "**Slug de rama**\n`x`");
  assert.equal(withSlugBlock("Only a header.\n", "x"), "Only a header.\n\n**Slug de rama**\n`x`");
});

test("withSlugBlock: never inside a code block, and the rest of the body unchanged", () => {
  assert.equal(
    withSlugBlock("```\ncode\n\nmore\n```\n\nText.", "x"),
    "**Slug de rama**\n`x`\n\n```\ncode\n\nmore\n```\n\nText.",
  );
  assert.equal(
    withSlugBlock("Header.\r\n\r\nDetail.\r\n  ", "x"),
    "Header.\n\n**Slug de rama**\n`x`\r\n\r\nDetail.\r\n  ",
  );
});
