// Tests of `issue-flow init`: the files it writes in a real checkout, that it runs twice
// without duplicating anything, and its recipes. The fake npx of fake-npx.mjs logs any call,
// so the tests can tell init runs no other tool: agent-kit does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startSandbox } from "./start-helpers.mjs";
import { npxCalls, npxEnv, readRepoJson, withNpx } from "./init-helpers.mjs";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const SESSION = `npx --yes @ramon-sg/issue-flow@${VERSION} session # runs claude-cloud session in the cloud`;

const commandsOf = (settings, event) => settings.hooks[event].flatMap((entry) => entry.hooks.map((hook) => hook.command));

test("init --yes sets an empty repo up: config, package.json and hooks, and runs no other tool", () => {
  const s = withNpx(startSandbox());

  const r = s.cli(["init", "--yes"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(readRepoJson(s, ".agents/flow.json"), { $schema: `https://raw.githubusercontent.com/ramon-sg/issue-flow/v${VERSION}/schema.json` });
  const pkg = readRepoJson(s, "package.json");
  assert.deepEqual(Object.keys(pkg.devDependencies).sort(), ["@ramon-sg/github-rest", "@ramon-sg/issue-flow", "@ramon-sg/skills-manager"]);
  assert.equal(pkg.devDependencies["@ramon-sg/issue-flow"], VERSION);
  assert.equal(pkg.scripts["issue:start"], "issue-flow issue start");
  const settings = readRepoJson(s, ".claude/settings.json");
  assert.deepEqual(commandsOf(settings, "SessionStart"), [SESSION]);
  assert.deepEqual(commandsOf(settings, "WorktreeCreate"), [`npx --yes @ramon-sg/issue-flow@${VERSION} hook worktree-create`]);
  assert.equal(settings.hooks.WorktreeRemove[0].hooks[0].timeout, 600);
  assert.equal(existsSync(join(s.main, ".claude", "repo-guard.config.json")), false);
  assert.deepEqual(npxCalls(s), []);
  assert.match(r.out, /Next: run 'npm install'/);
});

test("init twice changes nothing", () => {
  const s = withNpx(startSandbox());
  s.cli(["init", "--yes"], { env: npxEnv(s) });
  const before = ["package.json", ".agents/flow.json", ".claude/settings.json"].map((file) => readFileSync(join(s.main, file), "utf8"));

  const again = s.cli(["init", "--yes"], { env: npxEnv(s) });

  assert.equal(again.status, 0, again.err);
  assert.match(again.out, /already set up/);
  const after = ["package.json", ".agents/flow.json", ".claude/settings.json"].map((file) => readFileSync(join(s.main, file), "utf8"));
  assert.deepEqual(after, before);
});

test("every setup step of a recipe is trusted: they run the worktree's code, which pr worktree must not", () => {
  const s = withNpx(startSandbox());

  const r = s.cli(["init", "--yes", "--recipe", "npm,pnpm,bun,docker-compose,direnv",], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  const { setup } = readRepoJson(s, ".agents/flow.json").worktrees;
  assert.deepEqual(setup.map((step) => step.name), ["deps", "direnv", "docker"]);
  assert.ok(setup.every((step) => step.trusted === true), JSON.stringify(setup));
  assert.match(r.err, /kept the "deps" step of worktrees\.setup \(pnpm\)/);
});

test("init keeps the repo's own hooks and dependencies, and drops claude-cloud's SessionStart hook", () => {
  const s = withNpx(startSandbox());
  mkdirSync(join(s.main, ".claude"));
  const own = { type: "command", command: "echo mine" };
  const cloud = { type: "command", command: "/opt/claude-cloud/bin/claude-cloud session || true", timeout: 600 };
  writeFileSync(join(s.main, ".claude", "settings.json"), JSON.stringify({ model: "opus", hooks: { SessionStart: [{ hooks: [own] }, { hooks: [cloud] }] } }));
  writeFileSync(join(s.main, "package.json"), JSON.stringify({ name: "shop", devDependencies: { "@ramon-sg/github-rest": "0.1.0" }, scripts: { "issue:start": "bash scripts/start-issue.sh" } }));

  const r = s.cli(["init", "--yes",], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  const settings = readRepoJson(s, ".claude/settings.json");
  assert.equal(settings.model, "opus");
  assert.deepEqual(commandsOf(settings, "SessionStart"), ["echo mine", SESSION]);
  assert.match(r.out, /dropped the claude-cloud session SessionStart hook/);
  const pkg = readRepoJson(s, "package.json");
  assert.equal(pkg.devDependencies["@ramon-sg/github-rest"], "0.1.0");
  assert.equal(pkg.scripts["issue:start"], "bash scripts/start-issue.sh");
  assert.match(r.err, /kept @ramon-sg\/github-rest 0\.1\.0/);
  assert.deepEqual(npxCalls(s), []);
});

test("init applies the recipes the repo's files suggest, after asking, and keeps a step the repo has", () => {
  const s = withNpx(startSandbox());
  writeFileSync(join(s.main, "pnpm-lock.yaml"), "");
  writeFileSync(join(s.main, "compose.yaml"), "");
  writeFileSync(join(s.main, ".envrc"), "");
  mkdirSync(join(s.main, ".agents"));
  writeFileSync(join(s.main, ".agents", "flow.json"), JSON.stringify({ worktrees: { setup: [{ name: "deps", run: "pnpm i" }], ports: { start: 30000, blockSize: 10, blocks: 10 } } }));

  const r = s.cli(["init",], { env: npxEnv(s), input: "n\ny\ny\ny\n" });

  assert.equal(r.status, 0, r.err);
  assert.match(r.err, /Recipe direnv: .* Add it\?.*Recipe docker-compose:.*Recipe pnpm:/s);
  const { worktrees } = readRepoJson(s, ".agents/flow.json");
  assert.deepEqual(worktrees.setup.map((step) => `${step.name}: ${step.run}`), ["deps: pnpm i", "docker: docker compose -p main-$ISSUE_FLOW_DOCKER_SUFFIX up -d"]);
  assert.deepEqual(worktrees.teardown.map((step) => step.name), ["docker"]);
  assert.deepEqual(worktrees.ports, { start: 30000, blockSize: 10, blocks: 10 });
  assert.deepEqual(worktrees.dockerProjects, ["main"]);
  assert.match(r.out, /Next: run 'pnpm install'/);
});

test("init --recipe staging-main sets the base branch; a base branch already set stays", () => {
  const s = withNpx(startSandbox());
  const other = withNpx(startSandbox());
  mkdirSync(join(other.main, ".agents"));
  writeFileSync(join(other.main, ".agents", "flow.json"), JSON.stringify({ baseBranch: "develop" }));

  const r = s.cli(["init", "--yes", "--recipe", "staging-main",], { env: npxEnv(s) });
  const kept = other.cli(["init", "--yes", "--recipe", "staging-main",], { env: npxEnv(other) });
  const unknown = s.cli(["init", "--yes", "--recipe", "turbo"], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  assert.equal(readRepoJson(s, ".agents/flow.json").baseBranch, "staging");
  assert.equal(kept.status, 0, kept.err);
  assert.equal(readRepoJson(other, ".agents/flow.json").baseBranch, "develop");
  assert.match(kept.err, /kept baseBranch "develop" \(the recipe says "staging"\)/);
  assert.equal(unknown.status, 2);
  assert.match(unknown.err, /unknown recipe turbo; there are bun, direnv, docker-compose, npm, pnpm, staging-main/);
});

test("init takes the branch rules of paseo.json into a new config", () => {
  const s = withNpx(startSandbox());
  const types = { labels: { bug: "fix" }, titlePrefixes: { "bug:": "fix" } };
  writeFileSync(join(s.main, "paseo.json"), JSON.stringify({ project: { v: 1, issues: { branchTemplate: "{type}/{number}-{slug}", types } } }));

  const r = s.cli(["init", "--yes",], { env: npxEnv(s) });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(readRepoJson(s, ".agents/flow.json").branch, { template: "{type}/{number}-{slug}", types });
});

test("init writes and runs nothing when the answer is no", () => {
  const s = withNpx(startSandbox());

  const r = s.cli(["init"], { env: npxEnv(s), input: "n\n" });

  assert.equal(r.status, 1);
  assert.match(r.err, /nothing written/);
  assert.equal(existsSync(join(s.main, ".agents", "flow.json")), false);
  assert.equal(existsSync(join(s.main, "package.json")), false);
  assert.deepEqual(npxCalls(s), []);
});

test("init refuses to run in a worktree: the config is the main checkout's", () => {
  const s = withNpx(startSandbox());
  const dir = join(s.tmp, "wt");
  s.git(s.main, "worktree", "add", "-q", "-b", "other", dir);

  const r = s.cli(["init", "--yes"], { env: npxEnv(s), cwd: dir });

  assert.equal(r.status, 1);
  assert.match(r.err, /run init in the main checkout/);
  assert.equal(existsSync(join(dir, ".agents")), false);
  assert.equal(existsSync(join(s.main, ".agents")), false);
});
