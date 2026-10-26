// Tests of `issue-flow doctor` and `issue-flow upgrade` on a repo that `init` set up. The
// fake npx and npm of fake-npx.mjs log any call: neither command runs another tool nor asks
// npm, because the version that runs is the one they check and move to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startSandbox } from "./start-helpers.mjs";
import { npxCalls, npxEnv, readRepoJson, withNpx } from "./init-helpers.mjs";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const OWN = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// A repo set up with init.
function setUp() {
  const s = withNpx(startSandbox());
  s.cli(["init", "--yes"], { env: npxEnv(s) });
  return s;
}

// The repo as an older issue-flow left it: its dependencies, hooks and schema at 0.0.9.
function atOldVersion(s) {
  const pkg = readRepoJson(s, "package.json");
  pkg.devDependencies = { ...pkg.devDependencies, "@ramon-sg/issue-flow": "0.0.9", "@ramon-sg/github-rest": "0.1.0", "@ramon-sg/skills-manager": "1.0.0" };
  writeFileSync(join(s.main, "package.json"), JSON.stringify(pkg));
  const settings = readFileSync(join(s.main, ".claude", "settings.json"), "utf8").replaceAll(`@ramon-sg/issue-flow@${VERSION}`, "@ramon-sg/issue-flow@0.0.9");
  writeFileSync(join(s.main, ".claude", "settings.json"), settings);
  const config = readRepoJson(s, ".agents/flow.json");
  writeFileSync(join(s.main, ".agents", "flow.json"), JSON.stringify({ ...config, $schema: config.$schema.replace(`v${VERSION}`, "v0.0.9") }));
}

test("doctor passes on a repo init set up, and runs no other tool", () => {
  const s = setUp();

  const r = s.cli(["doctor"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /✗/);
  assert.match(r.out, /✓ WorktreeCreate hook: /);
  assert.deepEqual(npxCalls(s), []);
});

test("doctor names each problem and what fixes it", () => {
  const s = setUp();
  const pkg = readRepoJson(s, "package.json");
  delete pkg.devDependencies["@ramon-sg/github-rest"];
  writeFileSync(join(s.main, "package.json"), JSON.stringify(pkg));
  const settings = readRepoJson(s, ".claude/settings.json");
  settings.hooks.WorktreeRemove = [];
  settings.hooks.WorktreeCreate[0].hooks[0].command = "npx --yes @ramon-sg/issue-flow@0.0.1 hook worktree-create";
  writeFileSync(join(s.main, ".claude", "settings.json"), JSON.stringify(settings));

  const r = s.cli(["doctor"], { env: npxEnv(s) });

  assert.equal(r.status, 1);
  assert.match(r.out, /✗ @ramon-sg\/github-rest: not in package\.json, and the skills call it: run npx agent-kit/);
  assert.match(r.out, /✗ WorktreeRemove hook: not in \.claude\/settings\.json/);
  assert.match(r.out, /✗ WorktreeCreate hook: at 0\.0\.1, this is .*: run npx agent-kit/);
  assert.match(r.out, /✓ SessionStart hook/);
});

test("doctor --json prints passing checks with their detail, and exits 0", () => {
  const s = setUp();

  const r = s.cli(["doctor", "--json"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  const checks = JSON.parse(r.out);
  assert.equal(checks.length, 6);
  assert.ok(checks.every((check) => check.ok === true && typeof check.detail === "string" && check.detail !== ""), r.out);
});

test("doctor --json turns a broken file into a failed check, so agent-kit can show it", () => {
  const s = setUp();
  writeFileSync(join(s.main, "package.json"), "{ not json");

  const r = s.cli(["doctor", "--json"], { env: npxEnv(s) });

  assert.equal(r.status, 1);
  assert.match(JSON.parse(r.out).find((check) => !check.ok).detail, /package\.json is not valid JSON/);
});

test("doctor --json prints the failing checks, for agent-kit", () => {
  const s = setUp();
  atOldVersion(s);

  const r = s.cli(["doctor", "--json"], { env: npxEnv(s) });

  assert.equal(r.status, 1);
  const checks = JSON.parse(r.out);
  assert.deepEqual(checks.map((check) => check.name), [".agents/flow.json", "@ramon-sg/issue-flow", "@ramon-sg/github-rest", "SessionStart hook", "WorktreeCreate hook", "WorktreeRemove hook"]);
  assert.deepEqual(checks.filter((check) => !check.ok).map((check) => check.name), ["@ramon-sg/issue-flow", "SessionStart hook", "WorktreeCreate hook", "WorktreeRemove hook"]);
});

test("upgrade moves the dependencies, hooks and schema to the version that runs, without asking npm", () => {
  const s = setUp();
  atOldVersion(s);

  const r = s.cli(["upgrade"], { env: npxEnv(s) });
  const calls = { npx: npxCalls(s), npm: npxCalls(s, "npm") };

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(calls, { npx: [], npm: [] });
  assert.deepEqual(readRepoJson(s, "package.json").devDependencies, {
    "@ramon-sg/issue-flow": VERSION,
    "@ramon-sg/github-rest": OWN.dependencies["@ramon-sg/github-rest"],
    "@ramon-sg/skills-manager": OWN.devDependencies["@ramon-sg/skills-manager"],
  });
  const settings = readRepoJson(s, ".claude/settings.json");
  assert.match(settings.hooks.SessionStart[0].hooks[0].command, new RegExp(`^npx --yes @ramon-sg/issue-flow@${VERSION.replaceAll(".", "\\.")} session `));
  assert.equal(settings.hooks.SessionStart.length, 1);
  assert.equal(readRepoJson(s, ".agents/flow.json").$schema, `https://raw.githubusercontent.com/ramon-sg/issue-flow/v${VERSION}/schema.json`);
  assert.equal(s.cli(["doctor"], { env: npxEnv(s) }).status, 0);
});

test("upgrade never moves the repo back: a newer version in package.json or a hook stops it", () => {
  const s = setUp();
  const pkg = readRepoJson(s, "package.json");
  pkg.devDependencies["@ramon-sg/issue-flow"] = "^99.0.0";
  writeFileSync(join(s.main, "package.json"), JSON.stringify(pkg));
  const before = readFileSync(join(s.main, "package.json"), "utf8");
  const other = setUp();
  const settings = readFileSync(join(other.main, ".claude", "settings.json"), "utf8").replace(`@ramon-sg/issue-flow@${VERSION} hook worktree-create`, "@ramon-sg/issue-flow@99.1.0 hook worktree-create");
  writeFileSync(join(other.main, ".claude", "settings.json"), settings);

  const r = s.cli(["upgrade"], { env: npxEnv(s) });
  const hooked = other.cli(["upgrade", "--dry-run"], { env: npxEnv(other) });

  assert.equal(r.status, 1);
  assert.match(r.err, /the repo is at issue-flow \^99\.0\.0, newer than this .*; run 'npx @ramon-sg\/issue-flow@99\.0\.0 upgrade'/);
  assert.equal(readFileSync(join(s.main, "package.json"), "utf8"), before);
  assert.equal(hooked.status, 1);
  assert.match(hooked.err, /at issue-flow 99\.1\.0/);
});

test("upgrade --dry-run only says what would change", () => {
  const s = setUp();
  atOldVersion(s);
  const before = readFileSync(join(s.main, "package.json"), "utf8");

  const r = s.cli(["upgrade", "--dry-run"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, new RegExp(`To issue-flow ${VERSION.replaceAll(".", "\\.")}:\\n.*@ramon-sg/issue-flow 0\\.0\\.9 → `, "s"));
  assert.equal(readFileSync(join(s.main, "package.json"), "utf8"), before);
});

test("upgrade refuses to run in a worktree, and leaves the main checkout alone", () => {
  const s = setUp();
  atOldVersion(s);
  const dir = join(s.tmp, "wt");
  s.git(s.main, "worktree", "add", "-q", "-b", "other", dir);
  const before = readFileSync(join(s.main, "package.json"), "utf8");

  const r = s.cli(["upgrade"], { env: npxEnv(s), cwd: dir });

  assert.equal(r.status, 1);
  assert.match(r.err, /run upgrade in the main checkout/);
  assert.equal(readFileSync(join(s.main, "package.json"), "utf8"), before);
});
