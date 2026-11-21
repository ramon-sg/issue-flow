// Tests of `issue-flow doctor` and of `apply` (and `upgrade`, its old name) on a repo that
// an older issue-flow set up. The fake npx and npm of fake-npx.mjs log any call: neither
// command runs another tool nor asks npm, because the version that runs is the one they
// check and move to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startSandbox } from "./start-helpers.mjs";
import { npxCalls, npxEnv, readRepoJson, withBun, withNpx } from "./init-helpers.mjs";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const OWN = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// A repo set up with init.
function setUp() {
  const s = withBun(withNpx(startSandbox()));
  s.cli(["apply", "--yes"], { env: npxEnv(s) });
  return s;
}

// The lowest github-rest the flow needs.
const REST = OWN.devDependencies["@ramon-sg/github-rest"].replace(/^\^/, "");

// The repo as an older issue-flow left it, with the devDependencies mode: issue-flow, hooks
// (run with npx) and schema at 0.0.9, the skills-manager that issue-flow used to add, the
// scripts that call the repo's copy, and no runner.json.
function atOldVersion(s) {
  const pkg = readRepoJson(s, "package.json");
  pkg.devDependencies = { "@ramon-sg/issue-flow": "0.0.9", "@ramon-sg/github-rest": REST, "@ramon-sg/skills-manager": "1.0.0" };
  pkg.scripts = { "issue:start": "issue-flow issue start", "issue:start:free": "issue-flow issue start --free", "worktree:prune": "issue-flow worktree prune", "pr:worktree": "issue-flow pr worktree" };
  writeFileSync(join(s.main, "package.json"), JSON.stringify(pkg));
  rmSync(join(s.main, ".agents", "runner.json"));
  const settings = readFileSync(join(s.main, ".claude", "settings.json"), "utf8").replaceAll(`bunx --bun @ramon-sg/issue-flow@${VERSION}`, "npx --yes @ramon-sg/issue-flow@0.0.9");
  writeFileSync(join(s.main, ".claude", "settings.json"), settings);
  const config = readRepoJson(s, ".agents/flow.json");
  writeFileSync(join(s.main, ".agents", "flow.json"), JSON.stringify({ ...config, $schema: config.$schema.replace(`v${VERSION}`, "v0.0.9") }));
}

// Writes a tool's version into the repo's runner.json.
function pinTool(s, name, version) {
  const runner = readRepoJson(s, ".agents/runner.json");
  runner.tools[name] = version;
  writeFileSync(join(s.main, ".agents", "runner.json"), JSON.stringify(runner));
}

test("doctor passes on a repo init set up, and runs no other tool", () => {
  const s = setUp();

  const r = s.cli(["doctor"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, /✗/);
  assert.match(r.out, /✓ WorktreeCreate hook: /);
  assert.deepEqual(npxCalls(s), []);
});

test("doctor names each problem and what fixes it: issue-flow apply when the repo pins this version", () => {
  const s = setUp();
  const runner = readRepoJson(s, ".agents/runner.json");
  delete runner.tools["@ramon-sg/github-rest"];
  writeFileSync(join(s.main, ".agents", "runner.json"), JSON.stringify(runner));
  const settings = readRepoJson(s, ".claude/settings.json");
  settings.hooks.WorktreeRemove = [];
  settings.hooks.WorktreeCreate[0].hooks[0].command = "bunx --bun @ramon-sg/issue-flow@0.0.1 hook worktree-create";
  writeFileSync(join(s.main, ".claude", "settings.json"), JSON.stringify(settings));

  const r = s.cli(["doctor"], { env: npxEnv(s) });

  assert.equal(r.status, 1);
  assert.match(r.out, /✗ @ramon-sg\/github-rest: no entry in "tools" of \.agents\/runner\.json, and the skills call it: run npx @ramon-sg\/issue-flow apply/);
  assert.match(r.out, /✗ WorktreeRemove hook: not in \.claude\/settings\.json: run npx @ramon-sg\/issue-flow apply/);
  assert.match(r.out, /✗ WorktreeCreate hook: at 0\.0\.1, this is .*: run npx @ramon-sg\/issue-flow apply/);
  assert.match(r.out, /✓ SessionStart hook/);
});

test("doctor fails when a shortcut is at another version, and names it", () => {
  const s = setUp();
  const pkg = readRepoJson(s, "package.json");
  pkg.scripts["issue:start"] = "bunx --bun @ramon-sg/issue-flow@0.0.1 issue start";
  writeFileSync(join(s.main, "package.json"), JSON.stringify(pkg));

  const r = s.cli(["doctor"], { env: npxEnv(s) });

  assert.equal(r.status, 1);
  assert.match(r.out, /✗ .*@ramon-sg\/issue-flow is not pinned to .* in: bunx --bun @ramon-sg\/issue-flow@0\.0\.1 issue start/);
});

test("doctor fails when a hook uses another runner", () => {
  const s = setUp();
  const runner = readRepoJson(s, ".agents/runner.json");
  runner.runner = "node";
  writeFileSync(join(s.main, ".agents", "runner.json"), JSON.stringify(runner));

  const r = s.cli(["doctor"], { env: npxEnv(s) });

  assert.equal(r.status, 1);
  assert.match(r.out, /✗ SessionStart hook: .*runner/);
});

test("doctor fails when github-rest is older than the one inside", () => {
  const s = setUp();
  pinTool(s, "@ramon-sg/github-rest", "0.5.0");

  const r = s.cli(["doctor"], { env: npxEnv(s) });

  assert.equal(r.status, 1);
  assert.match(r.out, new RegExp(`✗ @ramon-sg/github-rest: 0\\.5\\.0, and the skills need ${REST.replaceAll(".", "\\.")} or newer`));
});

test("doctor shows an invalid runner.json as a failed check, and does not throw", () => {
  const s = setUp();
  writeFileSync(join(s.main, ".agents", "runner.json"), "{ not json");

  const r = s.cli(["doctor"], { env: npxEnv(s) });
  const json = s.cli(["doctor", "--json"], { env: npxEnv(s) });

  assert.equal(r.status, 1);
  assert.match(r.out, /✗ runner: /);
  assert.doesNotMatch(r.err, /at .*\.js/);
  assert.ok(JSON.parse(json.out).some((check) => !check.ok));
});

test("doctor fails when there is no runner.json", () => {
  const s = setUp();
  rmSync(join(s.main, ".agents", "runner.json"));

  const r = s.cli(["doctor"], { env: npxEnv(s) });

  assert.equal(r.status, 1);
  assert.match(r.out, /✗ @ramon-sg\/issue-flow: /);
});

test("doctor fails while devDependencies still have issue-flow", () => {
  const s = setUp();
  const pkg = readRepoJson(s, "package.json");
  pkg.devDependencies = { "@ramon-sg/issue-flow": VERSION };
  writeFileSync(join(s.main, "package.json"), JSON.stringify(pkg));

  const r = s.cli(["doctor"], { env: npxEnv(s) });

  assert.equal(r.status, 1);
  assert.match(r.out, /✗ devDependencies: .*@ramon-sg\/issue-flow.*apply/);
});

test("doctor --json prints passing checks with their detail, and exits 0", () => {
  const s = setUp();

  const r = s.cli(["doctor", "--json"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  const checks = JSON.parse(r.out);
  assert.equal(checks.length, 9);
  assert.ok(checks.every((check) => check.ok === true && typeof check.detail === "string" && check.detail !== ""), r.out);
});

test("doctor --json turns a broken file into a failed check, so agent-kitchen can show it", () => {
  const s = setUp();
  writeFileSync(join(s.main, "package.json"), "{ not json");

  const r = s.cli(["doctor", "--json"], { env: npxEnv(s) });

  assert.equal(r.status, 1);
  assert.match(JSON.parse(r.out).find((check) => !check.ok).detail, /package\.json is not valid JSON/);
});

test("doctor --json prints the failing checks, for agent-kitchen", () => {
  const s = setUp();
  atOldVersion(s);

  const r = s.cli(["doctor", "--json"], { env: npxEnv(s) });

  assert.equal(r.status, 1);
  const checks = JSON.parse(r.out);
  assert.deepEqual(Object.keys(checks[0]), ["name", "ok", "detail"]);
  assert.deepEqual(checks.map((check) => check.name), [".agents/flow.json", "runner", "@ramon-sg/issue-flow", "@ramon-sg/github-rest", "tool pins", "SessionStart hook", "WorktreeCreate hook", "WorktreeRemove hook", "devDependencies"]);
  const failing = checks.filter((check) => !check.ok).map((check) => check.name);
  assert.deepEqual(failing, [".agents/flow.json", "@ramon-sg/issue-flow", "@ramon-sg/github-rest", "tool pins", "SessionStart hook", "WorktreeCreate hook", "WorktreeRemove hook", "devDependencies"]);
  assert.match(checks[0].detail, /valid, but its \$schema is not at v/);
  assert.match(checks[2].detail, /run npx agent-kitchen apply$/);
});

test("apply moves a repo from devDependencies and npx hooks at an old version to runner.json and bunx hooks at this one", () => {
  const s = setUp();
  atOldVersion(s);

  const r = s.cli(["apply"], { env: npxEnv(s) });
  const calls = { npx: npxCalls(s), npm: npxCalls(s, "npm") };
  const again = s.cli(["apply"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(calls, { npx: [], npm: [] });
  assert.deepEqual(readRepoJson(s, "package.json").devDependencies, { "@ramon-sg/skills-manager": "1.0.0" });
  assert.deepEqual(readRepoJson(s, ".agents/runner.json").tools, { "@ramon-sg/github-rest": REST, "@ramon-sg/issue-flow": VERSION });
  assert.equal(readRepoJson(s, "package.json").scripts["issue:start"], `bunx --bun @ramon-sg/issue-flow@${VERSION} issue start`);
  const settings = readRepoJson(s, ".claude/settings.json");
  assert.match(settings.hooks.SessionStart[0].hooks[0].command, new RegExp(`^bunx --bun @ramon-sg/issue-flow@${VERSION.replaceAll(".", "\\.")} session `));
  assert.equal(settings.hooks.SessionStart.length, 1);
  assert.doesNotMatch(JSON.stringify(settings), /npx --yes/);
  assert.equal(readRepoJson(s, ".agents/flow.json").$schema, `https://raw.githubusercontent.com/ramon-sg/issue-flow/v${VERSION}/schema.json`);
  assert.equal(again.out, `Already at issue-flow ${VERSION}.\n`);
  assert.equal(s.cli(["doctor"], { env: npxEnv(s) }).status, 0);
});

test("apply keeps a newer github-rest quietly, and an old one with a note", () => {
  const newer = setUp();
  const old = setUp();
  pinTool(newer, "@ramon-sg/github-rest", "99.0.0");
  pinTool(old, "@ramon-sg/github-rest", "0.1.0");

  const quiet = newer.cli(["apply"], { env: npxEnv(newer) });
  const noted = old.cli(["apply"], { env: npxEnv(old) });
  const doctor = old.cli(["doctor"], { env: npxEnv(old) });

  assert.equal(quiet.err, "");
  assert.equal(readRepoJson(newer, ".agents/runner.json").tools["@ramon-sg/github-rest"], "99.0.0");
  assert.equal(noted.status, 0, noted.err);
  assert.match(noted.out, /^Already at issue-flow /);
  assert.match(noted.err, /kept @ramon-sg\/github-rest 0\.1\.0 \(the skills need .* or newer: raise it\)/);
  assert.equal(doctor.status, 1);
  assert.match(doctor.out, /✗ @ramon-sg\/github-rest: 0\.1\.0, and the skills need .* or newer/);
});

test("apply --json gives the changes and what to run next; --dry-run writes nothing", () => {
  const s = setUp();
  atOldVersion(s);
  const files = ["package.json", ".claude/settings.json", ".agents/flow.json"];
  const before = files.map((file) => readFileSync(join(s.main, file), "utf8"));

  const dry = s.cli(["apply", "--dry-run"], { env: npxEnv(s) });
  const plan = s.cli(["apply", "--dry-run", "--json"], { env: npxEnv(s) });
  const unchanged = files.map((file) => readFileSync(join(s.main, file), "utf8"));
  const written = existsSync(join(s.main, ".agents", "runner.json"));
  const done = s.cli(["apply", "--json"], { env: npxEnv(s) });
  const settled = s.cli(["apply", "--json"], { env: npxEnv(s) });

  assert.equal(dry.status, 0, dry.err);
  assert.match(dry.out, new RegExp(`issue-flow ${VERSION.replaceAll(".", "\\.")} would write:\\n.*\\.agents/runner\\.json: tools: @ramon-sg/issue-flow ${VERSION.replaceAll(".", "\\.")}`, "s"));
  assert.deepEqual(unchanged, before);
  assert.equal(written, false);
  assert.equal(JSON.parse(plan.out).written, false);
  assert.equal(done.status, 0, done.err);
  const result = JSON.parse(done.out);
  assert.equal(result.version, VERSION);
  assert.equal(result.written, true);
  assert.ok(result.changes.some((change) => change === `.agents/runner.json: tools: @ramon-sg/issue-flow ${VERSION}`), JSON.stringify(result));
  assert.ok(result.changes.some((change) => change === "package.json: devDependencies: without @ramon-sg/issue-flow"), JSON.stringify(result));
  assert.deepEqual(result.next, ["bun install", "review the diff and commit it"]);
  assert.deepEqual(JSON.parse(plan.out).changes, result.changes);
  assert.deepEqual(JSON.parse(settled.out), { version: VERSION, changes: [], kept: [], written: false, next: [] });
});

test("apply never moves the repo back nor pins over a range", () => {
  const s = setUp();
  pinTool(s, "@ramon-sg/issue-flow", "99.0.0");
  const before = readFileSync(join(s.main, ".agents", "runner.json"), "utf8");
  const legacy = setUp();
  const pkg = readRepoJson(legacy, "package.json");
  pkg.devDependencies = { "@ramon-sg/issue-flow": "99.0.0" };
  writeFileSync(join(legacy.main, "package.json"), JSON.stringify(pkg));
  const ranged = setUp();
  const other = readRepoJson(ranged, "package.json");
  other.devDependencies = { "@ramon-sg/issue-flow": "^0.2.6" };
  writeFileSync(join(ranged.main, "package.json"), JSON.stringify(other));
  // NOTE: runner.json still pins this version; the newer hook alone must stop it.
  const hookedRepo = setUp();
  const settings = readFileSync(join(hookedRepo.main, ".claude", "settings.json"), "utf8").replace(`@ramon-sg/issue-flow@${VERSION} hook worktree-create`, "@ramon-sg/issue-flow@99.1.0 hook worktree-create");
  writeFileSync(join(hookedRepo.main, ".claude", "settings.json"), settings);

  const r = s.cli(["apply"], { env: npxEnv(s) });
  const old = legacy.cli(["apply"], { env: npxEnv(legacy) });
  const range = ranged.cli(["apply"], { env: npxEnv(ranged) });
  const hooked = hookedRepo.cli(["apply", "--dry-run"], { env: npxEnv(hookedRepo) });

  assert.equal(r.status, 1);
  assert.match(r.err, /\.agents\/runner\.json has issue-flow 99\.0\.0, newer than this .*; run 'npx @ramon-sg\/issue-flow@99\.0\.0 apply'/);
  assert.equal(readFileSync(join(s.main, ".agents", "runner.json"), "utf8"), before);
  assert.equal(old.status, 1);
  assert.match(old.err, /package\.json has issue-flow 99\.0\.0, newer than this/);
  assert.equal(range.status, 1);
  assert.match(range.err, /package\.json has issue-flow \^0\.2\.6, not an exact version: the hooks need one/);
  assert.equal(hooked.status, 1);
  assert.match(hooked.err, /a hook of \.claude\/settings\.json has issue-flow 99\.1\.0, newer than this/);
});

test("apply takes an issue-flow pinned with = as exact, and drops it from package.json", () => {
  const s = setUp();
  atOldVersion(s);
  const pkg = readRepoJson(s, "package.json");
  pkg.devDependencies["@ramon-sg/issue-flow"] = "=0.0.9";
  writeFileSync(join(s.main, "package.json"), JSON.stringify(pkg));

  const r = s.cli(["apply"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  assert.equal(readRepoJson(s, "package.json").devDependencies["@ramon-sg/issue-flow"], undefined);
  assert.equal(readRepoJson(s, ".agents/runner.json").tools["@ramon-sg/issue-flow"], VERSION);
});

test("init and upgrade run apply and say so; upgrade never asks, as agent-kitchen 0.4.0 calls it without a terminal", () => {
  const s = withBun(withNpx(startSandbox()));
  writeFileSync(join(s.main, "pnpm-lock.yaml"), "");
  const old = setUp();
  atOldVersion(old);

  const upgraded = s.cli(["upgrade"], { env: npxEnv(s) });
  const moved = old.cli(["upgrade"], { env: npxEnv(old) });
  const fresh = withBun(withNpx(startSandbox()));
  const inited = fresh.cli(["init", "--yes"], { env: npxEnv(fresh) });

  assert.equal(upgraded.status, 0, upgraded.err);
  assert.match(upgraded.err, /upgrade is now apply: run 'issue-flow apply'\. upgrade goes away in 0\.4\.0\./);
  assert.equal(readRepoJson(s, ".agents/flow.json").worktrees, undefined);
  assert.equal(moved.status, 0, moved.err);
  assert.equal(readRepoJson(old, ".agents/runner.json").tools["@ramon-sg/issue-flow"], VERSION);
  assert.equal(inited.status, 0, inited.err);
  assert.match(inited.err, /init is now apply/);
  assert.equal(readRepoJson(fresh, ".agents/runner.json").tools["@ramon-sg/issue-flow"], VERSION);
});

test("apply refuses to run in a worktree, and leaves the main checkout alone", () => {
  const s = setUp();
  atOldVersion(s);
  const dir = join(s.tmp, "wt");
  s.git(s.main, "worktree", "add", "-q", "-b", "other", dir);
  const before = readFileSync(join(s.main, "package.json"), "utf8");

  const r = s.cli(["apply"], { env: npxEnv(s), cwd: dir });

  assert.equal(r.status, 1);
  assert.match(r.err, /run apply in the main checkout/);
  assert.equal(readFileSync(join(s.main, "package.json"), "utf8"), before);
});
