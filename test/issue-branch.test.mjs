// Tests of `issue-flow issue branch` against the fake gh and the fake claude.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CLAUDE_ARGS } from "../dist/claude-namer.js";
import { ISSUES, issue, sandbox } from "./helpers.mjs";

const MISSING_LIST = `GET ${ISSUES}?state=open&per_page=100&page=1`;

const answer = (items) => JSON.stringify(items);

test("a block that fits is used as is and Claude is not called", () => {
  const s = sandbox();
  s.route(`GET ${ISSUES}/42`, issue(42, { body: "H.\n\n**Rama sugerida**\n`fix/42-cart`", labels: [{ name: "bug" }] }));

  const r = s.run(["issue", "branch", "42", "--json"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.json(), [{ number: 42, branch: "fix/42-cart", source: "suggested", warnings: [] }]);
  assert.deepEqual(s.claudeCalls(), []);
});

test("issues without a block are named in one Claude call and rendered with the template", () => {
  const s = sandbox();
  s.route(`GET ${ISSUES}/5`, issue(5, { title: "bug: el carro suma mal", labels: [{ name: "bug" }] }));
  s.route(`GET ${ISSUES}/6`, issue(6, { title: "Otra cosa" }));

  const r = s.run(["issue", "branch", "5", "6"], {
    claude: answer([
      { number: 5, type: "feat", slug: "cart-total" },
      { number: 6, type: "docs", slug: "other-thing" },
    ]),
  });

  assert.equal(r.status, 0, r.err);
  assert.equal(r.out, "#5 fix/5-cart-total (claude)\n#6 docs/6-other-thing (claude)\n");
  const calls = s.claudeCalls();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, [...CLAUDE_ARGS, "--model", "haiku"]);
  assert.ok(calls[0].args.includes("--safe-mode") && calls[0].args[calls[0].args.indexOf("--tools") + 1] === "");
  assert.match(calls[0].input, /"number": 5[\s\S]*"number": 6/);
});

test("a bad or partial Claude answer falls back to the title, with a warning per issue", () => {
  const s = sandbox();
  s.route(`GET ${ISSUES}/5`, issue(5, { title: "bug: el carro suma mal", labels: [{ name: "bug" }] }));

  const r = s.run(["issue", "branch", "5", "--json"], { claude: answer([{ number: 5, slug: "Bad Slug" }]) });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.json()[0], {
    number: 5,
    branch: "fix/5-el-carro-suma-mal",
    source: "title",
    warnings: ["#5: Claude gave no valid name; using the title."],
  });
});

test("without claude in the PATH, or if it fails, one warning and the title for every issue", () => {
  const s = sandbox();
  s.route(`GET ${ISSUES}/5`, issue(5, { title: "Uno" }));
  s.route(`GET ${ISSUES}/6`, issue(6, { title: "Dos" }));

  const missing = s.run(["issue", "branch", "5", "6"], { withoutClaude: true });
  const failing = s.run(["issue", "branch", "5"], { claudeExit: 1 });

  assert.equal(missing.status, 0, missing.err);
  assert.equal(missing.out, "#5 5-uno (title)\n#6 6-dos (title)\n");
  assert.equal(missing.err, "issue-flow: claude is not in the PATH; naming 2 issue(s) from the title.\n");
  assert.equal(failing.out, "#5 5-uno (title)\n");
  assert.match(failing.err, /claude exited with 1/);
});

test("--namer title and branch.namer title in the config never call Claude", () => {
  const s = sandbox();
  s.route(`GET ${ISSUES}/5`, issue(5, { title: "Uno" }));

  const flag = s.run(["issue", "branch", "5", "--namer", "title"]);
  const fromFlag = s.claudeCalls();
  s.config({ branch: { namer: "title", template: "{number}-{slug}" } });
  const config = s.run(["issue", "branch", "5"]);

  assert.equal(flag.out, "#5 5-uno (title)\n");
  assert.deepEqual(fromFlag, []);
  assert.equal(config.out, "#5 5-uno (title)\n");
  assert.deepEqual(s.claudeCalls(), []);
});

test("a block that does not fit is replaced, and a prefix that is not the type only warns", () => {
  const s = sandbox();
  s.route(`GET ${ISSUES}/7`, issue(7, { body: "**Rama sugerida**\n`feat/70-x`" }));
  s.route(`GET ${ISSUES}/8`, issue(8, { body: "**Rama sugerida**\n`feat/8-x`", labels: [{ name: "bug" }] }));

  const r = s.run(["issue", "branch", "7", "8", "--json"], { claude: answer([{ number: 7, type: "fix", slug: "real" }]) });

  assert.equal(r.status, 0, r.err);
  const [replaced, kept] = r.json();
  assert.equal(replaced.branch, "fix/7-real");
  assert.match(replaced.warnings[0], /"feat\/70-x" is not <prefix>\/7-<slug>; proposing another/);
  assert.equal(kept.branch, "feat/8-x");
  assert.match(kept.warnings[0], /does not start with fix\//);
});

test("an issue that does not exist exits with 1 and the others are still named", () => {
  const s = sandbox();
  s.route(`GET ${ISSUES}/5`, issue(5, { title: "Uno" }));

  const r = s.run(["issue", "branch", "5", "99", "--namer", "title"]);

  assert.equal(r.status, 1);
  assert.equal(r.out, "#5 5-uno (title)\n");
  assert.match(r.err, /issue #99 does not exist in acme\/widgets/);
});

test("--missing --dry-run: one Claude call for every issue without a block, nothing written", () => {
  const s = sandbox();
  s.route(MISSING_LIST, [
    issue(3, { title: "Tres", body: "Header.\n\n**Detalle**" }),
    issue(2, { title: "Dos", body: "**Rama sugerida**\n`fix/2-dos`" }),
    issue(1, { title: "Uno", pull_request: {} }),
  ]);

  const r = s.run(["issue", "branch", "--missing", "--dry-run"], { claude: answer([{ number: 3, type: "feat", slug: "three" }]) });

  assert.equal(r.status, 0, r.err);
  assert.equal(r.out, "#3 feat/3-three (claude)\n");
  assert.equal(s.claudeCalls().length, 1);
  assert.deepEqual(s.ghCalls().map((call) => call.method), ["GET"]);
  assert.doesNotMatch(r.err, /nothing written/);
});

test("--missing --yes adds the block after the header of each issue, re-reading it first", () => {
  const s = sandbox();
  s.route(MISSING_LIST, [issue(3, { title: "Tres", body: "Header.\n\n**Detalle**\nText." }), issue(4, { title: "Cuatro" })]);
  s.route(`GET ${ISSUES}/3`, issue(3, { title: "Tres", body: "Header.\n\n**Detalle**\nText edited meanwhile." }));
  s.route(`GET ${ISSUES}/4`, issue(4, { title: "Cuatro" }));
  s.route(`PATCH ${ISSUES}/3`, issue(3));
  s.route(`PATCH ${ISSUES}/4`, issue(4));

  const r = s.run(["issue", "branch", "--missing", "--yes", "--namer", "title"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(s.ghCalls().slice(1), [
    { method: "GET", path: `${ISSUES}/3` },
    { method: "PATCH", path: `${ISSUES}/3`, body: { body: "Header.\n\n**Rama sugerida**\n`3-tres`\n\n**Detalle**\nText edited meanwhile." } },
    { method: "GET", path: `${ISSUES}/4` },
    { method: "PATCH", path: `${ISSUES}/4`, body: { body: "**Rama sugerida**\n`4-cuatro`" } },
  ]);
  assert.match(r.out, /#3: block added\.\n#4: block added\./);
});

test("--missing --yes leaves alone an issue that got a block meanwhile", () => {
  const s = sandbox();
  s.route(MISSING_LIST, [issue(3, { title: "Tres" })]);
  s.route(`GET ${ISSUES}/3`, issue(3, { body: "**Rama sugerida**\n`feat/3-other`" }));

  const r = s.run(["issue", "branch", "--missing", "--yes", "--namer", "title"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(s.ghCalls().map((call) => call.method), ["GET", "GET"]);
  assert.match(r.err, /#3: it got a "Rama sugerida" block or was deleted meanwhile; left alone/);
});

test("--missing without a terminal and without --yes writes nothing; a failed edit exits with 1", () => {
  const s = sandbox();
  s.route(MISSING_LIST, [issue(3, { title: "Tres" }), issue(4, { title: "Cuatro" })]);
  s.route(`GET ${ISSUES}/3`, issue(3, { title: "Tres" }));
  s.route(`GET ${ISSUES}/4`, issue(4, { title: "Cuatro" }));
  s.route(`PATCH ${ISSUES}/4`, issue(4));

  const asked = s.run(["issue", "branch", "--missing", "--namer", "title"]);
  const asWritten = s.ghCalls();
  const partial = s.run(["issue", "branch", "--missing", "--namer", "title", "--yes"]);

  assert.equal(asked.status, 0, asked.err);
  assert.match(asked.err, /nothing written: pass --yes/);
  assert.deepEqual(asWritten.map((call) => call.method), ["GET"]);
  assert.equal(partial.status, 1);
  assert.match(partial.err, /#3: could not edit issue #3/);
  assert.match(partial.out, /#4: block added\./);
});

test("usage and config errors exit with 2 before calling GitHub", () => {
  const s = sandbox();
  for (const args of [
    [],
    ["issue"],
    ["issue", "branch"],
    ["issue", "branch", "4x"],
    ["issue", "branch", "--missing", "4"],
    ["issue", "branch", "4", "--yes"],
    ["issue", "branch", "--missing", "--yes", "--dry-run"],
    ["issue", "branch", "--missing", "--json"],
    ["issue", "branch", "--missing", "--limit", "0"],
    ["issue", "branch", "4", "--namer", "gpt"],
    ["issue", "branch", "4", "-R", "nope"],
    ["issue", "branch", "4", "--nope"],
  ]) {
    const r = s.run(args);
    assert.equal(r.status, 2, args.join(" "));
    assert.deepEqual(s.ghCalls(), [], args.join(" "));
  }
  s.config({ branch: { namr: "title" } });
  const bad = s.run(["issue", "branch", "4"]);
  assert.equal(bad.status, 2);
  assert.match(bad.err, /unknown key "branch.namr"/);
});

test("the repo comes from -R, then from the config's repo", () => {
  const s = sandbox();
  s.route("GET repos/other/thing/issues/5", issue(5, { title: "Uno" }));
  s.route("GET repos/from/config/issues/5", issue(5, { title: "Uno" }));

  const flag = s.run(["issue", "branch", "5", "--namer", "title", "-R", "other/thing"]);
  s.config({ repo: "from/config" });
  const config = s.run(["issue", "branch", "5", "--namer", "title"]);

  assert.equal(flag.status, 0, flag.err);
  assert.equal(config.status, 0, config.err);
  assert.equal(s.ghCalls()[0].path, "repos/from/config/issues/5");
});

test("--missing in a terminal writes only after a yes; no, or just Enter, writes nothing", async () => {
  const s = sandbox();
  s.route(MISSING_LIST, [issue(3, { title: "Tres" })]);
  s.route(`GET ${ISSUES}/3`, issue(3, { title: "Tres" }));
  s.route(`PATCH ${ISSUES}/3`, issue(3));
  const args = ["issue", "branch", "--missing", "--namer", "title"];

  for (const answer of ["n", ""]) {
    const r = await s.runTty(args, answer);
    assert.equal(r.asked, true, r.out);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(s.ghCalls().map((call) => call.method), ["GET"], `answer "${answer}"`);
  }
  const yes = await s.runTty(args, "y");

  assert.equal(yes.status, 0, yes.out);
  assert.deepEqual(s.ghCalls().map((call) => call.method), ["GET", "GET", "PATCH"]);
  assert.match(yes.out, /#3: block added\./);
});
