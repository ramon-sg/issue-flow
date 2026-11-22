// Tests of `issue-flow apply` (and `init`, its old name): the files it writes in a real
// checkout, that it runs twice without changing anything, and its recipes. The fake npx of
// fake-npx.mjs logs any call, so the tests can tell apply runs no other tool: agent-kitchen does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startSandbox } from "./start-helpers.mjs";
import { npxCalls, npxEnv, readRepoJson, runnerCalls, withBun, withNpx } from "./init-helpers.mjs";

const OWN = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const VERSION = OWN.version;
const SESSION = `bun x --bun @ramon-sg/issue-flow@${VERSION} session # runs agent-cloud-kit session in the cloud`;

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

// Runs the CLI in a pseudo-terminal (`script`), typing each answer at the next `[y/N]`.
// stdin ends only when the output ends ("Next:"): ending it right after the last answer can
// reach the terminal before the CLI reads that answer.
function tty(s, args, answers) {
  const run = process.platform === "darwin" ? 'cat | exec script -q /dev/null "$@"' : 'cat | exec script -qec "$(printf "%q " "$@")" /dev/null';
  const shell = process.platform === "darwin" ? "sh" : "bash";
  const env = { ISSUE_FLOW_LANG: "en", HOME: s.tmp, PATH: `${join(s.tmp, "bin")}:/usr/bin:/bin`, ...npxEnv(s) };
  return new Promise((resolve, reject) => {
    const child = spawn(shell, ["-c", run, shell, process.execPath, CLI, ...args], { cwd: s.main, env });
    const left = [...answers];
    let out = "";
    let asked = 0;
    const timer = setTimeout(() => child.kill(), 20_000);
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      out += chunk;
      while (asked < out.split("[y/N]").length - 1 && left.length > 0) {
        asked += 1;
        child.stdin.write(`${left.shift()}\r`);
      }
      if (/Next: |nothing written|issue-flow: /.test(out)) child.stdin.end();
    });
    child.on("error", reject);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, out });
    });
  });
}

// A sandbox with the fake npx and bun in its PATH.
const sandbox = () => withBun(withNpx(startSandbox()));
const RUNNER_SCHEMA = /^https:\/\/.*runner\.schema\.json$/;
const REST = OWN.devDependencies["@ramon-sg/github-rest"].replace(/^\^/, "");
const commandsOf = (settings, event) => settings.hooks[event].flatMap((entry) => entry.hooks.map((hook) => hook.command));

test("apply --yes in a repo without package.json writes runner.json, hooks and shortcuts, and no node_modules", () => {
  const s = sandbox();

  const r = s.cli(["apply", "--yes"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(readRepoJson(s, ".agents/flow.json"), { $schema: `https://raw.githubusercontent.com/ramon-sg/issue-flow/v${VERSION}/schema.json` });
  const runner = readRepoJson(s, ".agents/runner.json");
  assert.match(runner.$schema, RUNNER_SCHEMA);
  assert.equal(runner.runner, "bun");
  assert.deepEqual(runner.tools, { "@ramon-sg/github-rest": REST, "@ramon-sg/issue-flow": VERSION });
  const pkg = readRepoJson(s, "package.json");
  assert.deepEqual(pkg, {
    private: true,
    packageManager: "bun@1.4.4",
    scripts: {
      "issue:start": `bun x --bun @ramon-sg/issue-flow@${VERSION} issue start`,
      "issue:start:free": `bun x --bun @ramon-sg/issue-flow@${VERSION} issue start --free`,
      "worktree:prune": `bun x --bun @ramon-sg/issue-flow@${VERSION} worktree prune`,
      "pr:worktree": `bun x --bun @ramon-sg/issue-flow@${VERSION} pr worktree`,
    },
  });
  const settings = readRepoJson(s, ".claude/settings.json");
  assert.deepEqual(commandsOf(settings, "SessionStart"), [SESSION]);
  assert.deepEqual(commandsOf(settings, "WorktreeCreate"), [`bun x --bun @ramon-sg/issue-flow@${VERSION} hook worktree-create`]);
  assert.equal(settings.hooks.WorktreeRemove[0].hooks[0].timeout, 600);
  assert.equal(existsSync(join(s.main, ".claude", "repo-guard.config.json")), false);
  assert.equal(existsSync(join(s.main, "node_modules")), false);
  assert.deepEqual(npxCalls(s), []);
  assert.deepEqual(runnerCalls(s, "bun"), []);
  assert.match(r.out, /Next: review the diff and commit it/);
  assert.doesNotMatch(r.out, /install/);
  assert.equal(r.err, "");
});

test("with runner node everything runs with npx --yes", () => {
  const s = sandbox();
  mkdirSync(join(s.main, ".agents"));
  writeFileSync(join(s.main, ".agents", "runner.json"), JSON.stringify({ runner: "node", tools: {} }));
  writeFileSync(join(s.main, "package.json"), JSON.stringify({ name: "shop" }));

  const r = s.cli(["apply", "--yes"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  const settings = readRepoJson(s, ".claude/settings.json");
  assert.deepEqual(commandsOf(settings, "WorktreeCreate"), [`npx --yes @ramon-sg/issue-flow@${VERSION} hook worktree-create`]);
  const pkg = readRepoJson(s, "package.json");
  assert.equal(pkg.scripts["issue:start"], `npx --yes @ramon-sg/issue-flow@${VERSION} issue start`);
  assert.equal(pkg.packageManager, undefined, "the repo had a package.json already");
  assert.equal(readRepoJson(s, ".agents/runner.json").runner, "node");
  assert.deepEqual(npxCalls(s), []);
});

test("without Bun and without a terminal it picks node with a warning", () => {
  const s = withNpx(startSandbox());

  const r = s.cli(["apply", "--yes"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  assert.equal(readRepoJson(s, ".agents/runner.json").runner, "node");
  assert.match(r.err, /Bun is not installed/);
  assert.match(readRepoJson(s, "package.json").scripts["issue:start"], /^npx --yes /);
});

test("in a terminal without Bun it asks, and saying no writes nothing", async () => {
  const s = withNpx(startSandbox());

  const r = await tty(s, ["apply"], ["n"]);

  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /Bun is not installed: use Node\? \[y\/N\]/);
  assert.equal(existsSync(join(s.main, ".agents", "runner.json")), false);
  assert.equal(existsSync(join(s.main, ".claude", "settings.json")), false);
});

test("in a terminal without Bun it asks, and saying yes uses node", async () => {
  const s = withNpx(startSandbox());

  const r = await tty(s, ["apply"], ["y"]);

  assert.equal(r.status, 0, r.out);
  assert.equal(readRepoJson(s, ".agents/runner.json").runner, "node");
});

test("apply moves a repo off devDependencies", () => {
  const s = sandbox();
  writeFileSync(
    join(s.main, "package.json"),
    JSON.stringify({
      name: "shop",
      devDependencies: { "@ramon-sg/issue-flow": "0.5.1", "@ramon-sg/github-rest": "0.6.0", typescript: "5.9.3" },
      scripts: { "issue:start": "issue-flow issue start", "issue:start:free": "issue-flow issue start --free", "worktree:prune": "issue-flow worktree prune", "pr:worktree": "issue-flow pr worktree" },
    }),
  );

  const r = s.cli(["apply", "--yes"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  const pkg = readRepoJson(s, "package.json");
  assert.deepEqual(pkg.devDependencies, { typescript: "5.9.3" });
  assert.equal(pkg.scripts["issue:start"], `bun x --bun @ramon-sg/issue-flow@${VERSION} issue start`);
  assert.equal(pkg.scripts["pr:worktree"], `bun x --bun @ramon-sg/issue-flow@${VERSION} pr worktree`);
  assert.equal(readRepoJson(s, ".agents/runner.json").tools["@ramon-sg/github-rest"], "0.6.0");
  assert.match(r.out, /Next: run 'npm install', review the diff and commit it/);
});

test("apply keeps a script of the repo", () => {
  const s = sandbox();
  writeFileSync(join(s.main, "package.json"), JSON.stringify({ name: "shop", scripts: { "issue:start": "./scripts/start.sh" } }));

  const r = s.cli(["apply", "--yes"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  const pkg = readRepoJson(s, "package.json");
  assert.equal(pkg.scripts["issue:start"], "./scripts/start.sh");
  assert.equal(pkg.scripts["issue:start:free"], undefined);
  assert.equal(pkg.scripts["worktree:prune"], `bun x --bun @ramon-sg/issue-flow@${VERSION} worktree prune`);
  assert.match(r.err, /package\.json: .*issue:start/);
});

test("apply refuses a runner.json with a newer issue-flow", () => {
  const s = sandbox();
  mkdirSync(join(s.main, ".agents"));
  writeFileSync(join(s.main, ".agents", "runner.json"), JSON.stringify({ runner: "bun", tools: { "@ramon-sg/issue-flow": "99.0.0" } }));

  const r = s.cli(["apply", "--yes"], { env: npxEnv(s) });

  assert.equal(r.status, 1);
  assert.match(r.err, /\.agents\/runner\.json has issue-flow 99\.0\.0, newer than this/);
  assert.equal(existsSync(join(s.main, ".claude", "settings.json")), false);
  assert.equal(existsSync(join(s.main, "package.json")), false);
});

test("apply with an invalid runner.json writes nothing", () => {
  const s = sandbox();
  mkdirSync(join(s.main, ".agents"));
  writeFileSync(join(s.main, ".agents", "runner.json"), JSON.stringify({ runner: "bun", tools: { "@ramon-sg/issue-flow": "^0.5.0" } }));

  const r = s.cli(["apply", "--yes"], { env: npxEnv(s) });

  assert.equal(r.status, 1);
  assert.match(r.err, /runner\.json/);
  assert.match(r.err, /\^0\.5\.0/);
  assert.equal(existsSync(join(s.main, ".claude", "settings.json")), false);
  assert.equal(existsSync(join(s.main, ".agents", "flow.json")), false);
});

test("--dry-run --json lists the same changes as the real run", () => {
  const dry = sandbox();
  const real = sandbox();

  const planned = dry.cli(["apply", "--dry-run", "--json", "--yes"], { env: npxEnv(dry) });
  const done = real.cli(["apply", "--json", "--yes"], { env: npxEnv(real) });

  assert.equal(planned.status, 0, planned.err);
  assert.equal(done.status, 0, done.err);
  assert.deepEqual(JSON.parse(planned.out).changes, JSON.parse(done.out).changes);
  assert.equal(JSON.parse(planned.out).written, false);
  assert.equal(existsSync(join(dry.main, ".agents")), false);
  assert.equal(existsSync(join(dry.main, "package.json")), false);
  assert.equal(existsSync(join(dry.main, ".claude")), false);
});

test("apply twice changes nothing", () => {
  const s = sandbox();
  s.cli(["apply", "--yes"], { env: npxEnv(s) });
  const before = ["package.json", ".agents/flow.json", ".agents/runner.json", ".claude/settings.json"].map((file) => readFileSync(join(s.main, file), "utf8"));

  const again = s.cli(["apply"], { env: npxEnv(s) });

  assert.equal(again.status, 0, again.err);
  assert.equal(again.out, `Already at issue-flow ${VERSION}.\n`);
  const after = ["package.json", ".agents/flow.json", ".agents/runner.json", ".claude/settings.json"].map((file) => readFileSync(join(s.main, file), "utf8"));
  assert.deepEqual(after, before);
});

test("every setup step of a recipe is trusted: they run the worktree's code, which pr worktree must not", () => {
  const s = sandbox();

  const r = s.cli(["apply", "--yes", "--recipe", "npm,pnpm,bun,docker-compose,direnv"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  const { setup } = readRepoJson(s, ".agents/flow.json").worktrees;
  assert.deepEqual(setup.map((step) => step.name), ["deps", "direnv", "docker"]);
  assert.ok(setup.every((step) => step.trusted === true), JSON.stringify(setup));
  assert.match(r.err, /kept the "deps" step of worktrees\.setup \(pnpm\)/);
});

test("apply keeps the repo's own hooks and scripts, moves github-rest into runner.json, and drops agent-cloud-kit's SessionStart hook", () => {
  const s = sandbox();
  mkdirSync(join(s.main, ".claude"));
  const own = { type: "command", command: "echo mine" };
  const cloud = { type: "command", command: "/opt/agent-cloud-kit/bin/agent-cloud-kit session || true", timeout: 600 };
  writeFileSync(join(s.main, ".claude", "settings.json"), JSON.stringify({ model: "opus", hooks: { SessionStart: [{ hooks: [own] }, { hooks: [cloud] }] } }));
  writeFileSync(join(s.main, "package.json"), JSON.stringify({ name: "shop", devDependencies: { "@ramon-sg/github-rest": "0.1.0" }, scripts: { "issue:start": "bash scripts/start-issue.sh" } }));

  const r = s.cli(["apply", "--yes"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  const settings = readRepoJson(s, ".claude/settings.json");
  assert.equal(settings.model, "opus");
  assert.deepEqual(commandsOf(settings, "SessionStart"), ["echo mine", SESSION]);
  assert.match(r.out, /dropped the agent-cloud-kit session SessionStart hook/);
  const pkg = readRepoJson(s, "package.json");
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(readRepoJson(s, ".agents/runner.json").tools["@ramon-sg/github-rest"], "0.1.0");
  assert.equal(pkg.scripts["issue:start"], "bash scripts/start-issue.sh");
  assert.equal(pkg.scripts["issue:start:free"], undefined, "it would skip the repo's own issue:start");
  assert.match(r.err, /kept @ramon-sg\/github-rest 0\.1\.0 \(the skills need .* or newer: raise it\)/);
  assert.deepEqual(npxCalls(s), []);
});

test("apply in a terminal asks about the recipes the repo's files suggest, and keeps a step the repo has", async () => {
  const s = sandbox();
  writeFileSync(join(s.main, "pnpm-lock.yaml"), "");
  writeFileSync(join(s.main, "compose.yaml"), "");
  writeFileSync(join(s.main, ".envrc"), "");

  const r = await tty(s, ["apply"], ["n", "y", "y"]);

  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Recipe direnv: .* Add it\?.*Recipe docker-compose:.*Recipe pnpm:/s);
  const { worktrees } = readRepoJson(s, ".agents/flow.json");
  assert.deepEqual(worktrees.setup.map((step) => step.name).sort(), ["deps", "docker"]);
  assert.deepEqual(worktrees.teardown.map((step) => step.name), ["docker"]);
  assert.match(r.out, /Next: review the diff and commit it/);
});

test("apply asks about recipes only the first time; --recipe adds one later, keeping a step the repo has", () => {
  const s = sandbox();
  writeFileSync(join(s.main, "compose.yaml"), "");
  mkdirSync(join(s.main, ".agents"));
  writeFileSync(join(s.main, ".agents", "flow.json"), JSON.stringify({ worktrees: { setup: [{ name: "deps", run: "pnpm i" }], ports: { start: 30000, blockSize: 10, blocks: 10 } } }));

  const plain = s.cli(["apply"], { env: npxEnv(s) });
  const added = s.cli(["apply", "--recipe", "pnpm,docker-compose"], { env: npxEnv(s) });

  assert.equal(plain.status, 0, plain.err);
  assert.doesNotMatch(plain.err, /Recipe/);
  assert.equal(added.status, 0, added.err);
  const { worktrees } = readRepoJson(s, ".agents/flow.json");
  assert.deepEqual(worktrees.setup.map((step) => `${step.name}: ${step.run}`), ["deps: pnpm i", "docker: docker compose -p main-$ISSUE_FLOW_DOCKER_SUFFIX up -d"]);
  assert.deepEqual(worktrees.ports, { start: 30000, blockSize: 10, blocks: 10 });
  assert.deepEqual(worktrees.dockerProjects, ["main"]);
  assert.match(added.err, /kept the "deps" step of worktrees\.setup \(pnpm\)/);
});

test("apply drops an old issue:start:free that skips the repo's own issue:start", () => {
  const s = sandbox();
  writeFileSync(join(s.main, "package.json"), JSON.stringify({ name: "shop", scripts: { "issue:start": "bash scripts/start-issue.sh", "issue:start:free": "issue-flow issue start --free" } }));

  const r = s.cli(["apply", "--yes"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  const pkg = readRepoJson(s, "package.json");
  assert.equal(pkg.scripts["issue:start"], "bash scripts/start-issue.sh");
  assert.equal(pkg.scripts["issue:start:free"], undefined);
  assert.match(r.out, /scripts: without issue:start:free \(old version\)/);
});

test("without a terminal nor --yes, apply writes nothing when the repo suggests recipes, and does not wait", () => {
  const s = sandbox();
  writeFileSync(join(s.main, "pnpm-lock.yaml"), "");

  const r = s.cli(["apply"], { env: npxEnv(s) });

  assert.equal(r.status, 1);
  assert.match(r.err, /nothing written: the repo's files suggest recipes; pass --yes to take them, or --recipe to pick/);
  assert.equal(existsSync(join(s.main, ".agents", "flow.json")), false);
  assert.equal(existsSync(join(s.main, "package.json")), false);
});

test("without a terminal, apply --json still prints JSON when it writes nothing, and --dry-run previews the recipes", () => {
  const s = sandbox();
  writeFileSync(join(s.main, "pnpm-lock.yaml"), "");

  const json = s.cli(["apply", "--json"], { env: npxEnv(s) });
  const dry = s.cli(["apply", "--dry-run"], { env: npxEnv(s) });

  assert.equal(json.status, 1);
  assert.deepEqual(JSON.parse(json.out), { version: VERSION, changes: [], kept: [], written: false, next: ["pass --yes or --recipe"] });
  assert.equal(dry.status, 0, dry.err);
  assert.match(dry.out, /would write:/);
  assert.match(dry.out, /pnpm: /);
  assert.equal(existsSync(join(s.main, ".agents", "flow.json")), false);
});

test("apply --recipe staging-main sets the base branch; a base branch already set stays", () => {
  const s = sandbox();
  const other = sandbox();
  mkdirSync(join(other.main, ".agents"));
  writeFileSync(join(other.main, ".agents", "flow.json"), JSON.stringify({ baseBranch: "develop" }));

  const r = s.cli(["apply", "--yes", "--recipe", "staging-main"], { env: npxEnv(s) });
  const kept = other.cli(["apply", "--yes", "--recipe", "staging-main"], { env: npxEnv(other) });
  const unknown = s.cli(["apply", "--yes", "--recipe", "turbo"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  assert.equal(readRepoJson(s, ".agents/flow.json").baseBranch, "staging");
  assert.equal(kept.status, 0, kept.err);
  assert.equal(readRepoJson(other, ".agents/flow.json").baseBranch, "develop");
  assert.match(kept.err, /kept baseBranch "develop" \(the recipe says "staging"\)/);
  assert.equal(unknown.status, 2);
  assert.match(unknown.err, /unknown recipe turbo; there are bun, direnv, docker-compose, npm, pnpm, staging-main/);
});

test("apply takes the branch rules of paseo.json into a new config", () => {
  const s = sandbox();
  const types = { labels: { bug: "fix" }, titlePrefixes: { "bug:": "fix" } };
  writeFileSync(join(s.main, "paseo.json"), JSON.stringify({ project: { v: 1, issues: { branchTemplate: "{type}/{number}-{slug}", types } } }));

  const r = s.cli(["apply", "--yes"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(readRepoJson(s, ".agents/flow.json").branch, { template: "{type}/{number}-{slug}", types });
});

test("apply refuses to run in a worktree: the config is the main checkout's", () => {
  const s = sandbox();
  const dir = join(s.tmp, "wt");
  s.git(s.main, "worktree", "add", "-q", "-b", "other", dir);

  const r = s.cli(["apply", "--yes"], { env: npxEnv(s), cwd: dir });

  assert.equal(r.status, 1);
  assert.match(r.err, /run apply in the main checkout/);
  assert.equal(existsSync(join(dir, ".agents")), false);
  assert.equal(existsSync(join(s.main, ".agents")), false);
});

test("reaches: whether a github-rest of the repo reaches the one the flow needs", async () => {
  const { reaches } = await import("../dist/package-edits.js");
  const cases = [
    ["1.3.0", "1.2.0", true],
    ["1.2.0", "1.2.0", true],
    ["1.1.0", "1.2.0", false],
    ["1.10.0", "1.9.0", true],
    ["1.2.0-rc.1", "1.2.0", false],
    ["1.3.0-rc.1", "1.2.0", true],
    ["^1.2.0", "1.3.0", true],
    ["^0.1.0", "0.3.0", false],
    ["^0.3.0", "0.3.0", true],
    ["~1.2.0", "1.3.0", false],
    [">=0.1.0", "0.3.0", true],
    ["=0.2.0", "0.3.0", false],
    ["workspace:*", "0.3.0", true],
    ["github:ramon-sg/github-rest", "0.3.0", true],
  ];
  for (const [current, tested, expected] of cases) assert.equal(reaches(current, tested), expected, `${current} for ${tested}`);
});
