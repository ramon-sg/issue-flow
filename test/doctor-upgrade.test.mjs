// Tests of `issue-flow doctor` and of `apply` (and `upgrade`, its old name) on a repo that
// an older issue-flow set up. The fake npx and npm of fake-npx.mjs log any call: neither
// command runs another tool nor asks npm, because the version that runs is the one they
// check and move to.
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
  s.cli(["apply", "--yes"], { env: npxEnv(s) });
  return s;
}

// The lowest github-rest the flow needs.
const REST = OWN.dependencies["@ramon-sg/github-rest"].replace(/^\^/, "");

// The repo as an older issue-flow left it: issue-flow, hooks and schema at 0.0.9, and the
// skills-manager that issue-flow used to add.
function atOldVersion(s) {
  const pkg = readRepoJson(s, "package.json");
  pkg.devDependencies = { ...pkg.devDependencies, "@ramon-sg/issue-flow": "0.0.9", "@ramon-sg/skills-manager": "1.0.0" };
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

test("doctor names each problem and what fixes it: issue-flow apply when the repo pins this version", () => {
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
  assert.match(r.out, /✗ @ramon-sg\/github-rest: not in package\.json, and the skills call it: run npx @ramon-sg\/issue-flow apply/);
  assert.match(r.out, /✗ WorktreeRemove hook: not in \.claude\/settings\.json: run npx @ramon-sg\/issue-flow apply/);
  assert.match(r.out, /✗ WorktreeCreate hook: at 0\.0\.1, this is .*: run npx @ramon-sg\/issue-flow apply/);
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
  assert.deepEqual(checks.map((check) => check.name), [".agents/flow.json", "@ramon-sg/issue-flow", "@ramon-sg/github-rest", "SessionStart hook", "WorktreeCreate hook", "WorktreeRemove hook"]);
  assert.deepEqual(checks.filter((check) => !check.ok).map((check) => check.name), [".agents/flow.json", "@ramon-sg/issue-flow", "SessionStart hook", "WorktreeCreate hook", "WorktreeRemove hook"]);
  assert.ok(checks.filter((check) => !check.ok).every((check) => check.detail.endsWith("run npx agent-kitchen apply")), r.out);
  assert.match(checks[0].detail, /valid, but its \$schema is not at v/);
});

test("apply moves issue-flow, the hooks and the schema to the version that runs, and no other version", () => {
  const s = setUp();
  atOldVersion(s);

  const r = s.cli(["apply"], { env: npxEnv(s) });
  const calls = { npx: npxCalls(s), npm: npxCalls(s, "npm") };
  const again = s.cli(["apply"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(calls, { npx: [], npm: [] });
  assert.deepEqual(readRepoJson(s, "package.json").devDependencies, { "@ramon-sg/issue-flow": VERSION, "@ramon-sg/github-rest": REST, "@ramon-sg/skills-manager": "1.0.0" });
  const settings = readRepoJson(s, ".claude/settings.json");
  assert.match(settings.hooks.SessionStart[0].hooks[0].command, new RegExp(`^npx --yes @ramon-sg/issue-flow@${VERSION.replaceAll(".", "\\.")} session `));
  assert.equal(settings.hooks.SessionStart.length, 1);
  assert.equal(readRepoJson(s, ".agents/flow.json").$schema, `https://raw.githubusercontent.com/ramon-sg/issue-flow/v${VERSION}/schema.json`);
  assert.equal(again.out, `Already at issue-flow ${VERSION}.\n`);
  assert.equal(s.cli(["doctor"], { env: npxEnv(s) }).status, 0);
});

test("apply keeps a newer github-rest quietly, and an old one with a note that doctor repeats", () => {
  const newer = setUp();
  const old = setUp();
  for (const [s, version] of [[newer, "99.0.0"], [old, "0.1.0"]]) {
    const pkg = readRepoJson(s, "package.json");
    pkg.devDependencies["@ramon-sg/github-rest"] = version;
    writeFileSync(join(s.main, "package.json"), JSON.stringify(pkg));
  }

  const quiet = newer.cli(["apply"], { env: npxEnv(newer) });
  const noted = old.cli(["apply"], { env: npxEnv(old) });
  const doctor = old.cli(["doctor"], { env: npxEnv(old) });

  assert.equal(quiet.err, "");
  assert.equal(readRepoJson(newer, "package.json").devDependencies["@ramon-sg/github-rest"], "99.0.0");
  assert.equal(noted.status, 0, noted.err);
  assert.match(noted.out, /^Already at issue-flow /);
  assert.match(noted.err, /kept @ramon-sg\/github-rest 0\.1\.0 \(the skills need .* or newer: raise it\)/);
  assert.equal(doctor.status, 1);
  assert.match(doctor.out, /✗ @ramon-sg\/github-rest: 0\.1\.0, and the skills need .* or newer: raise it in package\.json/);
});

test("apply --json gives the changes and what to run next; --dry-run writes nothing", () => {
  const s = setUp();
  atOldVersion(s);
  const before = readFileSync(join(s.main, "package.json"), "utf8");

  const dry = s.cli(["apply", "--dry-run"], { env: npxEnv(s) });
  const plan = s.cli(["apply", "--dry-run", "--json"], { env: npxEnv(s) });
  const unchanged = readFileSync(join(s.main, "package.json"), "utf8");
  const done = s.cli(["apply", "--json"], { env: npxEnv(s) });
  const settled = s.cli(["apply", "--json"], { env: npxEnv(s) });

  assert.equal(dry.status, 0, dry.err);
  assert.match(dry.out, new RegExp(`issue-flow ${VERSION.replaceAll(".", "\\.")} would write:\\n.*@ramon-sg/issue-flow 0\\.0\\.9 → `, "s"));
  assert.equal(unchanged, before);
  assert.equal(JSON.parse(plan.out).written, false);
  assert.equal(done.status, 0, done.err);
  const result = JSON.parse(done.out);
  assert.equal(result.version, VERSION);
  assert.equal(result.written, true);
  assert.ok(result.changes.some((change) => change.startsWith("package.json: devDependencies: @ramon-sg/issue-flow 0.0.9 → ")), JSON.stringify(result));
  assert.deepEqual(result.next, ["npm install", "review the diff and commit it"]);
  assert.deepEqual(JSON.parse(settled.out), { version: VERSION, changes: [], kept: [], written: false, next: [] });
});

test("apply never moves the repo back nor pins over a range", () => {
  const s = setUp();
  const pkg = readRepoJson(s, "package.json");
  pkg.devDependencies["@ramon-sg/issue-flow"] = "99.0.0";
  writeFileSync(join(s.main, "package.json"), JSON.stringify(pkg));
  const before = readFileSync(join(s.main, "package.json"), "utf8");
  const ranged = setUp();
  const other = readRepoJson(ranged, "package.json");
  other.devDependencies["@ramon-sg/issue-flow"] = "^0.2.6";
  writeFileSync(join(ranged.main, "package.json"), JSON.stringify(other));
  // NOTE: package.json still pins this version; the newer hook alone must stop it.
  const hookedRepo = setUp();
  const settings = readFileSync(join(hookedRepo.main, ".claude", "settings.json"), "utf8").replace(`@ramon-sg/issue-flow@${VERSION} hook worktree-create`, "@ramon-sg/issue-flow@99.1.0 hook worktree-create");
  writeFileSync(join(hookedRepo.main, ".claude", "settings.json"), settings);

  const r = s.cli(["apply"], { env: npxEnv(s) });
  const range = ranged.cli(["apply"], { env: npxEnv(ranged) });
  const hooked = hookedRepo.cli(["apply", "--dry-run"], { env: npxEnv(hookedRepo) });

  assert.equal(r.status, 1);
  assert.match(r.err, /package\.json has issue-flow 99\.0\.0, newer than this .*; run 'npx @ramon-sg\/issue-flow@99\.0\.0 apply'/);
  assert.equal(readFileSync(join(s.main, "package.json"), "utf8"), before);
  assert.equal(range.status, 1);
  assert.match(range.err, /package\.json has issue-flow \^0\.2\.6, not an exact version: the hooks need one/);
  assert.equal(hooked.status, 1);
  assert.match(hooked.err, /a hook of \.claude\/settings\.json has issue-flow 99\.1\.0, newer than this/);
});

test("apply takes an issue-flow pinned with = as exact, and pins it bare", () => {
  const s = setUp();
  atOldVersion(s);
  const pkg = readRepoJson(s, "package.json");
  pkg.devDependencies["@ramon-sg/issue-flow"] = "=0.0.9";
  writeFileSync(join(s.main, "package.json"), JSON.stringify(pkg));

  const r = s.cli(["apply"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  assert.equal(readRepoJson(s, "package.json").devDependencies["@ramon-sg/issue-flow"], VERSION);
});

test("init and upgrade run apply and say so; upgrade never asks, as agent-kitchen 0.4.0 calls it without a terminal", () => {
  const s = withNpx(startSandbox());
  writeFileSync(join(s.main, "pnpm-lock.yaml"), "");
  const old = setUp();
  atOldVersion(old);

  const upgraded = s.cli(["upgrade"], { env: npxEnv(s) });
  const moved = old.cli(["upgrade"], { env: npxEnv(old) });
  const fresh = withNpx(startSandbox());
  const inited = fresh.cli(["init", "--yes"], { env: npxEnv(fresh) });

  assert.equal(upgraded.status, 0, upgraded.err);
  assert.match(upgraded.err, /upgrade is now apply: run 'issue-flow apply'\. upgrade goes away in 0\.4\.0\./);
  assert.equal(readRepoJson(s, ".agents/flow.json").worktrees, undefined);
  assert.equal(moved.status, 0, moved.err);
  assert.equal(readRepoJson(old, "package.json").devDependencies["@ramon-sg/issue-flow"], VERSION);
  assert.equal(inited.status, 0, inited.err);
  assert.match(inited.err, /init is now apply/);
  assert.equal(readRepoJson(fresh, "package.json").devDependencies["@ramon-sg/issue-flow"], VERSION);
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
