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
import { npxCalls, npxEnv, readRepoJson, withNpx } from "./init-helpers.mjs";

const OWN = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const VERSION = OWN.version;
const SESSION = `npx --yes @ramon-sg/issue-flow@${VERSION} session # runs claude-cloud session in the cloud`;

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

// Runs the CLI in a pseudo-terminal (`script`), typing each answer at the next `[y/N]`.
// stdin ends only when the output ends ("Next:"): ending it right after the last answer can
// reach the terminal before the CLI reads that answer.
function tty(s, args, answers) {
  const run = process.platform === "darwin" ? 'cat | exec script -q /dev/null "$@"' : 'cat | exec script -qec "$(printf "%q " "$@")" /dev/null';
  const shell = process.platform === "darwin" ? "sh" : "bash";
  const env = { HOME: s.tmp, PATH: `${join(s.tmp, "bin")}:/usr/bin:/bin`, ...npxEnv(s) };
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

const commandsOf = (settings, event) => settings.hooks[event].flatMap((entry) => entry.hooks.map((hook) => hook.command));

test("apply --yes sets an empty repo up: config, package.json and hooks, and runs no other tool", () => {
  const s = withNpx(startSandbox());

  const r = s.cli(["apply", "--yes"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(readRepoJson(s, ".agents/flow.json"), { $schema: `https://raw.githubusercontent.com/ramon-sg/issue-flow/v${VERSION}/schema.json` });
  const pkg = readRepoJson(s, "package.json");
  assert.deepEqual(Object.keys(pkg.devDependencies).sort(), ["@ramon-sg/github-rest", "@ramon-sg/issue-flow"]);
  assert.equal(pkg.devDependencies["@ramon-sg/github-rest"], OWN.dependencies["@ramon-sg/github-rest"].replace(/^\^/, ""));
  assert.equal(pkg.devDependencies["@ramon-sg/issue-flow"], VERSION);
  assert.equal(pkg.scripts["issue:start"], "issue-flow issue start");
  const settings = readRepoJson(s, ".claude/settings.json");
  assert.deepEqual(commandsOf(settings, "SessionStart"), [SESSION]);
  assert.deepEqual(commandsOf(settings, "WorktreeCreate"), [`npx --yes @ramon-sg/issue-flow@${VERSION} hook worktree-create`]);
  assert.equal(settings.hooks.WorktreeRemove[0].hooks[0].timeout, 600);
  assert.equal(existsSync(join(s.main, ".claude", "repo-guard.config.json")), false);
  assert.deepEqual(npxCalls(s), []);
  assert.match(r.out, /Next: run 'npm install', review the diff and commit it/);
  assert.equal(r.err, "");
});

test("apply twice changes nothing", () => {
  const s = withNpx(startSandbox());
  s.cli(["apply", "--yes"], { env: npxEnv(s) });
  const before = ["package.json", ".agents/flow.json", ".claude/settings.json"].map((file) => readFileSync(join(s.main, file), "utf8"));

  const again = s.cli(["apply"], { env: npxEnv(s) });

  assert.equal(again.status, 0, again.err);
  assert.equal(again.out, `Already at issue-flow ${VERSION}.\n`);
  const after = ["package.json", ".agents/flow.json", ".claude/settings.json"].map((file) => readFileSync(join(s.main, file), "utf8"));
  assert.deepEqual(after, before);
});

test("every setup step of a recipe is trusted: they run the worktree's code, which pr worktree must not", () => {
  const s = withNpx(startSandbox());

  const r = s.cli(["apply", "--yes", "--recipe", "npm,pnpm,bun,docker-compose,direnv"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  const { setup } = readRepoJson(s, ".agents/flow.json").worktrees;
  assert.deepEqual(setup.map((step) => step.name), ["deps", "direnv", "docker"]);
  assert.ok(setup.every((step) => step.trusted === true), JSON.stringify(setup));
  assert.match(r.err, /kept the "deps" step of worktrees\.setup \(pnpm\)/);
});

test("apply keeps the repo's own hooks, scripts and github-rest, and drops claude-cloud's SessionStart hook", () => {
  const s = withNpx(startSandbox());
  mkdirSync(join(s.main, ".claude"));
  const own = { type: "command", command: "echo mine" };
  const cloud = { type: "command", command: "/opt/claude-cloud/bin/claude-cloud session || true", timeout: 600 };
  writeFileSync(join(s.main, ".claude", "settings.json"), JSON.stringify({ model: "opus", hooks: { SessionStart: [{ hooks: [own] }, { hooks: [cloud] }] } }));
  writeFileSync(join(s.main, "package.json"), JSON.stringify({ name: "shop", devDependencies: { "@ramon-sg/github-rest": "0.1.0" }, scripts: { "issue:start": "bash scripts/start-issue.sh" } }));

  const r = s.cli(["apply", "--yes"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  const settings = readRepoJson(s, ".claude/settings.json");
  assert.equal(settings.model, "opus");
  assert.deepEqual(commandsOf(settings, "SessionStart"), ["echo mine", SESSION]);
  assert.match(r.out, /dropped the claude-cloud session SessionStart hook/);
  const pkg = readRepoJson(s, "package.json");
  assert.equal(pkg.devDependencies["@ramon-sg/github-rest"], "0.1.0");
  assert.equal(pkg.scripts["issue:start"], "bash scripts/start-issue.sh");
  assert.match(r.err, /kept @ramon-sg\/github-rest 0\.1\.0 \(the skills need .* or newer: raise it\)/);
  assert.deepEqual(npxCalls(s), []);
});

test("apply in a terminal asks about the recipes the repo's files suggest, and keeps a step the repo has", async () => {
  const s = withNpx(startSandbox());
  writeFileSync(join(s.main, "pnpm-lock.yaml"), "");
  writeFileSync(join(s.main, "compose.yaml"), "");
  writeFileSync(join(s.main, ".envrc"), "");

  const r = await tty(s, ["apply"], ["n", "y", "y"]);

  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Recipe direnv: .* Add it\?.*Recipe docker-compose:.*Recipe pnpm:/s);
  const { worktrees } = readRepoJson(s, ".agents/flow.json");
  assert.deepEqual(worktrees.setup.map((step) => step.name).sort(), ["deps", "docker"]);
  assert.deepEqual(worktrees.teardown.map((step) => step.name), ["docker"]);
  assert.match(r.out, /Next: run 'pnpm install'/);
});

test("apply asks about recipes only the first time; --recipe adds one later, keeping a step the repo has", () => {
  const s = withNpx(startSandbox());
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

test("without a terminal nor --yes, apply writes nothing when the repo suggests recipes, and does not wait", () => {
  const s = withNpx(startSandbox());
  writeFileSync(join(s.main, "pnpm-lock.yaml"), "");

  const r = s.cli(["apply"], { env: npxEnv(s) });

  assert.equal(r.status, 1);
  assert.match(r.err, /nothing written: the repo's files suggest recipes; pass --yes to take them, or --recipe to pick/);
  assert.equal(existsSync(join(s.main, ".agents", "flow.json")), false);
  assert.equal(existsSync(join(s.main, "package.json")), false);
});

test("without a terminal, apply --json still prints JSON when it writes nothing, and --dry-run previews the recipes", () => {
  const s = withNpx(startSandbox());
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
  const s = withNpx(startSandbox());
  const other = withNpx(startSandbox());
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
  const s = withNpx(startSandbox());
  const types = { labels: { bug: "fix" }, titlePrefixes: { "bug:": "fix" } };
  writeFileSync(join(s.main, "paseo.json"), JSON.stringify({ project: { v: 1, issues: { branchTemplate: "{type}/{number}-{slug}", types } } }));

  const r = s.cli(["apply", "--yes"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(readRepoJson(s, ".agents/flow.json").branch, { template: "{type}/{number}-{slug}", types });
});

test("apply refuses to run in a worktree: the config is the main checkout's", () => {
  const s = withNpx(startSandbox());
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
