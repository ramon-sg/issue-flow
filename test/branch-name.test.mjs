// Tests of the pure branch-name functions, with Abastio's cases from scripts/issue.test.sh.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  branchProblem,
  branchType,
  renderBranch,
  suggestedBranch,
  titleSlug,
  withBranchBlock,
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

test("branchProblem: <prefix>/<n>-<slug> of this issue, lowercase", () => {
  assert.equal(branchProblem("feat/214-odoo-return", 214), null);
  assert.equal(branchProblem("214-odoo-return", 214), null);
  assert.equal(branchProblem("ramon/sub/214-x", 214), null);
  assert.match(branchProblem(null, 214), /no "Rama sugerida" block/);
  assert.match(branchProblem("feat/api-formato-de-venta", 266), /is not <prefix>\/266-<slug>/);
  assert.match(branchProblem("feat/21-odoo", 214), /is not/);
  assert.match(branchProblem("feat/2140-odoo", 214), /is not/);
  assert.match(branchProblem("feat/214_Odoo", 214), /is not/);
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

test("withBranchBlock: after the first paragraph, or alone in an empty body", () => {
  assert.equal(
    withBranchBlock("Header line.\nSecond line.\n\n**Detalle**\nText.", "fix/1-x"),
    "Header line.\nSecond line.\n\n**Rama sugerida**\n`fix/1-x`\n\n**Detalle**\nText.",
  );
  assert.equal(withBranchBlock("Only a header.", "fix/1-x"), "Only a header.\n\n**Rama sugerida**\n`fix/1-x`");
  assert.equal(withBranchBlock("  \n", "fix/1-x"), "**Rama sugerida**\n`fix/1-x`");
});
