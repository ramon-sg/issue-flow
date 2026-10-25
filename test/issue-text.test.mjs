// Tests of the pure text of starting an issue, with Abastio's cases from scripts/issue.test.sh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyToPartOf, dirName, fill, issueColor, issueHeader, nextBranch, prBody, sessionName } from "../dist/issue-text.js";
import { DEFAULT_CONFIG } from "../dist/config.js";
import { isStale, LOCK_REASON } from "../dist/session-lock.js";
import { branchPr, workState } from "../dist/work-state.js";

const COLORS = DEFAULT_CONFIG.colors;

test("issueHeader: the first paragraph, before any branch block, wrapped at 80 and cut at 6 lines", () => {
  assert.deepEqual(issueHeader("\n\nQué se pide.\nSegunda línea.\n\nDetalle."), ["Qué se pide.", "Segunda línea."]);
  assert.deepEqual(issueHeader("Uno.\n**Slug de rama**\n`x`"), ["Uno."]);
  assert.deepEqual(issueHeader("**Rama sugerida**\n`fix/1-x`"), []);
  const long = issueHeader(Array.from({ length: 60 }, () => "palabra").join(" "));
  assert.equal(long.length, 6);
  assert.ok(long.every((line) => line.length <= 80));
  assert.equal(issueHeader(`${"x".repeat(90)} y`)[0], "x".repeat(90));
});

test("issueColor: the first prefix of the map that starts a label, so critical-path wins over P3", () => {
  assert.deepEqual(issueColor(["P3: minor", "critical-path"], COLORS), { label: "critical-path", color: "red" });
  assert.deepEqual(issueColor(["area:api", "P2: important"], COLORS), { label: "P2: important", color: "orange" });
  assert.equal(issueColor(["bug"], COLORS), null);
});

test("names: w- for a worktree session, + for each / in the folder", () => {
  assert.equal(sessionName("feat/42-x", "worktree"), "w-feat/42-x");
  assert.equal(sessionName("feat/42-x", "branch"), "feat/42-x");
  assert.equal(dirName("ramon/feat/42-x"), "ramon+feat+42-x");
});

test("nextBranch: the proposed one if unused, or -2, -3 until it is free", () => {
  assert.equal(nextBranch("feat/42-x", ["fix/42-y"]), "feat/42-x");
  assert.equal(nextBranch("feat/42-x", ["feat/42-x", "feat/42-x-2"]), "feat/42-x-3");
});

test("fill and prBody: one pass, so a title with {plan} is not filled again", () => {
  assert.equal(fill("{title} en {plan} {other}", { title: "Usa {plan}", plan: "docs/x.md" }), "Usa {plan} en docs/x.md {other}");
  assert.equal(prBody("{keyword} #{number}\n\nEn progreso.", 4, "closes"), "Closes #4\n\nEn progreso.");
  assert.equal(prBody("{keyword} #{number}", 4, "part"), "Part of #4");
});

test("bodyToPartOf: every closing word for this issue, and no other number", () => {
  assert.equal(bodyToPartOf("Closes #214\n\nEn progreso.", 214), "Part of #214\n\nEn progreso.");
  assert.equal(bodyToPartOf("fixes: #214, resolved #214.", 214), "Part of #214, Part of #214.");
  assert.equal(bodyToPartOf("Closes #2140 and closes #21", 214), "Closes #2140 and closes #21");
  assert.equal(bodyToPartOf("Issue: #214 (encloses #214)", 214), "Issue: #214 (encloses #214)");
});

test("workState: live branches are in origin, local or with an open PR, never merged", () => {
  const work = workState({
    number: 7,
    work: {
      prs: [
        { number: 1, state: "MERGED", branch: "feat/7-a", head: "h1", fork: false },
        { number: 2, state: "OPEN", branch: "feat/7-b", head: "h2", fork: false },
        { number: 3, state: "OPEN", branch: "feat/7-f", head: "h3", fork: true },
      ],
      branches: [
        { name: "feat/7-a", remote: false, merged: true },
        { name: "feat/7-b", remote: true, merged: false },
        { name: "feat/7-c", remote: false, merged: false },
      ],
    },
    local: { branches: ["feat/7-a", "feat/7-d"], worktrees: [] },
  });

  assert.deepEqual(work.candidates, ["feat/7-b", "feat/7-d"]);
  assert.deepEqual(work.known, ["feat/7-a", "feat/7-b", "feat/7-c", "feat/7-d"]);
  assert.deepEqual(work.mergedPrs, [1]);
  assert.deepEqual(work.forks, [3]);
  assert.deepEqual(workState({ number: 7, local: { branches: ["7-x"], worktrees: [] } }).candidates, ["7-x"]);
});

test("branchPr: the open PR of the branch, or else a closed one that was not merged", () => {
  const prs = [
    { number: 1, branch: "a", state: "CLOSED" },
    { number: 2, branch: "a", state: "OPEN" },
    { number: 3, branch: "b", state: "MERGED" },
    { number: 4, branch: "c", state: "CLOSED" },
  ];

  assert.deepEqual(branchPr(prs, "a"), { number: 2, state: "OPEN" });
  assert.equal(branchPr(prs, "b"), null);
  assert.deepEqual(branchPr(prs, "c"), { number: 4, state: "CLOSED" });
});

test("isStale: only a lock of issue-flow whose process is gone", () => {
  assert.equal(isStale(`${LOCK_REASON} 99999999`), true);
  assert.equal(isStale(`${LOCK_REASON} ${process.pid}`), false);
  assert.equal(isStale("claude session 99999999"), false);
  assert.equal(isStale(`${LOCK_REASON} abc`), false);
});
