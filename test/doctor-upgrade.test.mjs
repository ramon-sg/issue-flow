// Tests of `issue-flow doctor` and `issue-flow upgrade` on a repo that `init` set up, with the
// fake npx and npm of fake-npx.mjs: claude-repo-guard's doctor, `npm view` and skills-manager.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startSandbox } from "./start-helpers.mjs";
import { npxCalls, npxEnv, readRepoJson, withNpx } from "./init-helpers.mjs";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

// A repo set up with init, its skills manifest and a lock with two flow skills at `tag` and
// one general skill.
function setUp(tag = `v${VERSION}`) {
  const s = withNpx(startSandbox());
  s.cli(["init", "--yes"], { env: npxEnv(s) });
  const flow = (name) => ({ source: "catalog:ramon-sg/issue-flow", repo: "https://github.com/ramon-sg/issue-flow.git", tag, commit: "a".repeat(40) });
  writeFileSync(join(s.main, ".agents", "skills.json"), JSON.stringify({ sources: [{ catalog: "ramon-sg/issue-flow", ref: tag, skills: ["close-pr"] }, { catalog: "ramon-sg/agent-skills", skills: ["code-audit"] }] }));
  writeFileSync(join(s.main, ".agents", "skills.lock.json"), JSON.stringify({
    lockVersion: 2,
    skills: { "close-pr": flow("close-pr"), "pr-review-comments": flow("pr-review-comments"), "code-audit": { source: "catalog:ramon-sg/agent-skills", tag: "v0.1.0" } },
  }));
  return s;
}

const RELEASE = JSON.stringify({ version: "0.2.0", dependencies: { "@ramon-sg/github-rest": "0.3.0" }, devDependencies: { "@ramon-sg/skills-manager": "1.2.0" } });

test("doctor passes on a repo init set up, and asks claude-repo-guard's doctor", () => {
  const s = setUp();

  const r = s.cli(["doctor"], { env: npxEnv(s, { FAKE_NPX_DOCTOR: '[{"name":"sandbox","ok":true,"detail":"on"}]' }) });

  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /✗/);
  assert.match(r.out, /✓ flow skills: 2 at v/);
  assert.match(r.out, /✓ claude-repo-guard: its doctor passes/);
  assert.deepEqual(npxCalls(s).map((call) => call.args.slice(1)), [["github:ramon-sg/claude-repo-guard", "doctor", "--json"]]);
});

test("doctor names each problem and what fixes it", () => {
  const s = setUp("v0.0.9");
  const pkg = readRepoJson(s, "package.json");
  delete pkg.devDependencies["@ramon-sg/github-rest"];
  writeFileSync(join(s.main, "package.json"), JSON.stringify(pkg));
  const settings = readRepoJson(s, ".claude/settings.json");
  settings.hooks.WorktreeRemove = [];
  settings.hooks.WorktreeCreate[0].hooks[0].command = "npx --yes @ramon-sg/issue-flow@0.0.1 hook worktree-create";
  writeFileSync(join(s.main, ".claude", "settings.json"), JSON.stringify(settings));
  const guard = readRepoJson(s, ".claude/repo-guard.config.json");
  writeFileSync(join(s.main, ".claude", "repo-guard.config.json"), JSON.stringify({ ...guard, weakerNetworkIsolation: false }));

  const r = s.cli(["doctor"], { env: npxEnv(s, { FAKE_NPX_DOCTOR: '[{"name":"sandbox","ok":false,"detail":"bubblewrap is missing"},null]' }) });

  assert.equal(r.status, 1);
  assert.match(r.out, /✗ @ramon-sg\/github-rest: not in package\.json, and the skills call it: run issue-flow init/);
  assert.match(r.out, /✗ WorktreeRemove hook: not in \.claude\/settings\.json/);
  assert.match(r.out, /✗ WorktreeCreate hook: at 0\.0\.1, this is .*: run issue-flow upgrade/);
  assert.match(r.out, /✓ SessionStart hook/);
  assert.match(r.out, /✗ flow skills: close-pr at v0\.0\.9, pr-review-comments at v0\.0\.9, this is v.*: run issue-flow upgrade/);
  assert.match(r.out, /✗ claude-repo-guard: sandbox: bubblewrap is missing/);
  assert.match(r.out, /✗ claude-repo-guard: \?: null/);
  assert.equal(/✗ weakerNetworkIsolation/.test(r.out), process.platform === "darwin");
});

test("upgrade moves the dependencies, hooks, schema and the flow's catalog to the release, and updates only the flow's skills", () => {
  const s = setUp();

  const r = s.cli(["upgrade"], { env: npxEnv(s, { FAKE_NPM_VIEW: RELEASE }) });

  assert.equal(r.status, 0, r.err);
  const pkg = readRepoJson(s, "package.json");
  assert.deepEqual(pkg.devDependencies, { "@ramon-sg/issue-flow": "0.2.0", "@ramon-sg/github-rest": "0.3.0", "@ramon-sg/skills-manager": "1.2.0" });
  const settings = readRepoJson(s, ".claude/settings.json");
  assert.match(settings.hooks.SessionStart[0].hooks[0].command, /^npx --yes @ramon-sg\/issue-flow@0\.2\.0 session /);
  assert.equal(settings.hooks.SessionStart.length, 1);
  assert.equal(readRepoJson(s, ".agents/flow.json").$schema, "https://raw.githubusercontent.com/ramon-sg/issue-flow/v0.2.0/schema.json");
  const manifest = readRepoJson(s, ".agents/skills.json");
  assert.deepEqual(manifest.sources.map((source) => source.ref), ["v0.2.0", undefined]);
  assert.deepEqual(npxCalls(s, "npm").map((call) => call.args.slice(0, 2)), [["view", "@ramon-sg/issue-flow@latest"]]);
  assert.deepEqual(npxCalls(s).map((call) => call.args.slice(1)), [["@ramon-sg/skills-manager@1.2.0", "update", "close-pr", "pr-review-comments"]]);
});

test("upgrade --dry-run only says what would change; without the release on npm it stops", () => {
  const s = setUp();
  const before = readFileSync(join(s.main, "package.json"), "utf8");

  const dry = s.cli(["upgrade", "--to", "0.2.0", "--dry-run"], { env: npxEnv(s, { FAKE_NPM_VIEW: RELEASE }) });
  const viewed = npxCalls(s, "npm").map((call) => call.args[1]);
  const missing = s.cli(["upgrade", "--to", "9.9.9"], { env: npxEnv(s) });

  assert.equal(dry.status, 0, dry.err);
  assert.match(dry.out, /To issue-flow 0\.2\.0:\n.*@ramon-sg\/issue-flow .*→ 0\.2\.0/s);
  assert.deepEqual(viewed, ["@ramon-sg/issue-flow@0.2.0"]);
  assert.equal(readFileSync(join(s.main, "package.json"), "utf8"), before);
  assert.equal(missing.status, 1);
  assert.match(missing.err, /npm could not find @ramon-sg\/issue-flow@9\.9\.9/);
  assert.equal(readFileSync(join(s.main, "package.json"), "utf8"), before);
});

test("upgrade refuses to run in a worktree, and leaves the main checkout alone", () => {
  const s = setUp();
  const dir = join(s.tmp, "wt");
  s.git(s.main, "worktree", "add", "-q", "-b", "other", dir);
  const before = readFileSync(join(s.main, "package.json"), "utf8");

  const r = s.cli(["upgrade"], { env: npxEnv(s, { FAKE_NPM_VIEW: RELEASE }), cwd: dir });

  assert.equal(r.status, 1);
  assert.match(r.err, /run upgrade in the main checkout/);
  assert.equal(readFileSync(join(s.main, "package.json"), "utf8"), before);
  assert.deepEqual(npxCalls(s), []);
});
