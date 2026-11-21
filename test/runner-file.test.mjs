// runner-file: reading .agents/runner.json, pinning tools, shortcuts and the legacy cleanup.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { en } from "../dist/messages/en.js";
import { flowScripts, loadRunnerFile, pickScripts, predictScripts, withFlowTools, withoutLegacy } from "../dist/runner-file.js";
import { SetupError } from "../dist/setup-files.js";

const VERSIONS = { issueFlow: "0.6.0", githubRest: "0.9.0", runner: "1.0.0" };
const REST = "@ramon-sg/github-rest";
const FLOW = "@ramon-sg/issue-flow";

function repoWith(runner) {
  const root = mkdtempSync(join(tmpdir(), "runner-file-"));
  mkdirSync(join(root, ".agents"));
  writeFileSync(join(root, ".agents", "runner.json"), JSON.stringify(runner));
  return root;
}

test("flowScripts builds one command per runner", () => {
  assert.equal(flowScripts("bun", "0.6.0")["issue:start"], "bunx --bun @ramon-sg/issue-flow@0.6.0 issue start");
  assert.equal(flowScripts("bun", "0.6.0")["issue:start:free"], "bunx --bun @ramon-sg/issue-flow@0.6.0 issue start --free");
  assert.equal(flowScripts("node", "0.6.0")["pr:worktree"], "npx --yes @ramon-sg/issue-flow@0.6.0 pr worktree");
  assert.equal(flowScripts("node", "0.6.0")["worktree:prune"], "npx --yes @ramon-sg/issue-flow@0.6.0 worktree prune");
});

test("withFlowTools adds both tools to an empty config", () => {
  const { config, changes, kept } = withFlowTools({ runner: "bun", tools: {}, extra: {} }, VERSIONS, null, en);
  assert.deepEqual(config.tools, { [FLOW]: "0.6.0", [REST]: "0.9.0" });
  assert.equal(changes.length, 2);
  assert.deepEqual(kept, []);
});

test("withFlowTools leaves github-rest alone and warns when it is older", () => {
  const same = withFlowTools({ runner: "bun", tools: { [REST]: "0.9.0" }, extra: {} }, VERSIONS, null, en);
  assert.equal(same.config.tools[REST], "0.9.0");
  assert.deepEqual(same.kept, []);
  const older = withFlowTools({ runner: "bun", tools: { [REST]: "0.5.0" }, extra: {} }, VERSIONS, null, en);
  assert.equal(older.config.tools[REST], "0.5.0");
  assert.equal(older.kept.length, 1);
});

test("withFlowTools raises issue-flow and never lowers it", () => {
  const up = withFlowTools({ runner: "bun", tools: { [FLOW]: "0.5.1" }, extra: {} }, VERSIONS, null, en);
  assert.equal(up.config.tools[FLOW], "0.6.0");
  assert.ok(up.changes.some((line) => line.includes("0.5.1 → 0.6.0")));
  const newer = withFlowTools({ runner: "bun", tools: { [FLOW]: "0.7.0" }, extra: {} }, VERSIONS, null, en);
  assert.equal(newer.config.tools[FLOW], "0.7.0");
});

test("withFlowTools takes the legacy github-rest only if it is exact", () => {
  const empty = { runner: "bun", tools: {}, extra: {} };
  assert.equal(withFlowTools(empty, VERSIONS, "0.7.0", en).config.tools[REST], "0.7.0");
  assert.equal(withFlowTools(empty, VERSIONS, "^0.7.0", en).config.tools[REST], "0.9.0");
});

test("withoutLegacy drops the dependencies and the old scripts", () => {
  const out = withoutLegacy(
    {
      devDependencies: { [FLOW]: "0.5.1", [REST]: "0.6.0" },
      scripts: { "issue:start": "issue-flow issue start", lint: "eslint" },
    },
    en,
  );
  assert.equal(out.pkg.devDependencies, undefined);
  assert.deepEqual(out.pkg.scripts, { lint: "eslint" });
  assert.equal(out.removedDependencies, true);
  assert.equal(out.changes.length, 3);
  const other = withoutLegacy({ devDependencies: { [FLOW]: "0.5.1", typescript: "5.0.0" } }, en);
  assert.deepEqual(other.pkg.devDependencies, { typescript: "5.0.0" });
  assert.equal(withoutLegacy({ scripts: { lint: "eslint" } }, en).removedDependencies, false);
});

test("predictScripts follows the rule of writeScripts", () => {
  const scripts = flowScripts("bun", "0.6.0");
  assert.deepEqual(predictScripts({ scripts: { "issue:start": "./wrap.sh" } }, scripts).clashes, ["issue:start"]);
  const old = predictScripts({ scripts: { "issue:start": "npx @ramon-sg/issue-flow@0.5.0 issue start" } }, scripts);
  assert.ok(old.changes.includes("scripts: issue:start"));
  assert.deepEqual(old.clashes, []);
  assert.equal(predictScripts(null, scripts).changes.length, 4);
});

test("pickScripts skips issue:start:free next to the repo's own issue:start", () => {
  const scripts = flowScripts("bun", "0.6.0");
  const own = pickScripts({ scripts: { "issue:start": "./wrap.sh", "issue:start:free": "issue-flow issue start --free" } }, scripts, en);
  assert.equal(own.scripts["issue:start:free"], undefined);
  assert.equal(own.kept.length, 1);
  const plain = pickScripts({ scripts: { "issue:start": "issue-flow issue start" } }, scripts, en);
  assert.equal(plain.scripts["issue:start:free"], scripts["issue:start:free"]);
  assert.deepEqual(plain.kept, []);
});

test("loadRunnerFile reads an existing file without writing", async () => {
  const loaded = await loadRunnerFile(repoWith({ runner: "node", tools: {} }), undefined);
  assert.equal(loaded.created, false);
  assert.equal(loaded.config.runner, "node");
});

test("loadRunnerFile turns a bad file into a SetupError", async () => {
  await assert.rejects(loadRunnerFile(repoWith({ runner: "node", tools: { x: "^1.0.0" } }), undefined), SetupError);
});
