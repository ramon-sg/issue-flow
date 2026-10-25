// Tests of `issue-flow adapter …`, with the cases of Abastio's scripts/orca-hooks.test.sh:
// a real bare origin, the GitHub of fake-github.mjs, a fake Orca CLI, and real processes
// for the apps the archive stops.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { dockerProject } from "../dist/docker.js";
import { installed, startSandbox } from "./start-helpers.mjs";
import { alive, fakeProgram, flow, listener, logged, logStep, withLog } from "./worktree-helpers.mjs";

const ISSUE_URL = "https://github.com/acme/widgets/issues/214";
const PORTS = { start: 42000, blockSize: 2, blocks: 4 };

// A worktree like the ones of Orca and Paseo: outside the main checkout, from origin/main.
function toolWorktree(s, branch) {
  const dir = join(s.tmp, "tool", branch.replaceAll("/", "+"));
  s.git(s.main, "worktree", "add", "-q", dir, "-b", branch, "origin/main");
  return dir;
}

const created = (s) => s.writes().filter((call) => call.method === "POST" && call.path.endsWith("/pulls"));
const orcaSays = (s, worktree) => ({ ISSUE_FLOW_ORCA_CLI: fakeProgram(s, "orca", JSON.stringify({ result: { worktree } })) });

test("setup copies .worktreeinclude, runs the steps and, under Paseo, starts the issue of the branch", () => {
  const s = startSandbox();
  flow(s, { worktrees: { setup: [logStep("deps")] } });
  const dir = toolWorktree(s, "feat/214-paseo-name");

  const r = s.cli(["adapter", "setup"], { cwd: dir, env: withLog(s, { PASEO_WORKTREE_PATH: dir, PASEO_SOURCE_CHECKOUT_PATH: s.main }) });

  assert.equal(r.status, 0, r.err);
  assert.equal(readFileSync(join(dir, ".local", "credentials"), "utf8"), "ID=x\n");
  assert.deepEqual(logged(s), [`deps ${dir}`]);
  assert.equal(created(s)[0].body.head, "feat/214-paseo-name");
  assert.deepEqual(s.world.issues[214].assignees, [{ login: "me" }]);
  assert.deepEqual(s.claudeCalls(), []);
});

test("under Paseo, a branch without an issue number only gets the setup", () => {
  const s = startSandbox();
  const dir = toolWorktree(s, "ramon/explore");

  const r = s.cli(["adapter", "setup"], { cwd: dir, env: { PASEO_WORKTREE_PATH: dir } });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(s.writes(), []);
});

test("under Orca the issue comes from its CLI: the desktop's linkedWorkItem or the mobile's linkedIssue", () => {
  const desktop = startSandbox();
  const mobile = startSandbox();
  const other = startSandbox();
  const fromDesktop = toolWorktree(desktop, "ramon/avisar");
  const fromMobile = toolWorktree(mobile, "ramon/avisar");
  const fromOther = toolWorktree(other, "ramon/avisar");

  const a = desktop.cli(["adapter", "setup"], {
    cwd: fromDesktop,
    env: orcaSays(desktop, { linkedWorkItem: { provider: "github", type: "issue", url: `${ISSUE_URL}#x` } }),
  });
  const b = mobile.cli(["adapter", "setup"], { cwd: fromMobile, env: orcaSays(mobile, { linkedWorkItem: null, linkedIssue: 214 }) });
  const c = other.cli(["adapter", "setup"], {
    cwd: fromOther,
    env: orcaSays(other, { linkedWorkItem: { provider: "linear", type: "issue", url: "https://linear.app/x/issue/214" }, linkedIssue: 214 }),
  });

  assert.equal(a.status, 0, a.err);
  assert.equal(b.status, 0, b.err);
  assert.equal(c.status, 0, c.err);
  assert.equal(created(desktop)[0].body.head, "feat/214-odoo-refund-notice");
  assert.equal(created(mobile)[0].body.head, "feat/214-odoo-refund-notice");
  assert.deepEqual(other.writes(), []);
});

test("setup still exits 0 when Orca cannot be asked or the issue cannot be started, and says what to run", () => {
  const s = startSandbox();
  const broken = startSandbox();
  const dir = toolWorktree(s, "ramon/avisar");
  const brokenDir = toolWorktree(broken, "ramon/avisar");
  delete broken.world.issues[214];

  const noOrca = s.cli(["adapter", "setup"], { cwd: dir, env: { ISSUE_FLOW_ORCA_CLI: fakeProgram(s, "orca", null) } });
  const failed = broken.cli(["adapter", "setup"], { cwd: brokenDir, env: orcaSays(broken, { linkedIssue: 214 }) });

  assert.equal(noOrca.status, 0, noOrca.err);
  assert.match(noOrca.err, /could not ask Orca which issue this workspace came from\. If it came from one, run 'issue-flow adapter issue <issue-url>'/);
  assert.equal(failed.status, 0, failed.err);
  assert.match(failed.err, /issue #214 was not started .*; to retry, run 'issue-flow adapter issue https:\/\/github\.com\/acme\/widgets\/issues\/214' in /);
});

test("setup --only runs one step and starts no issue; in the main checkout nothing runs", () => {
  const s = startSandbox();
  flow(s, { worktrees: { setup: [logStep("deps"), logStep("env")] } });
  const dir = toolWorktree(s, "feat/214-x");

  const one = s.cli(["adapter", "setup", "--only", "env"], { cwd: dir, env: withLog(s, { PASEO_WORKTREE_PATH: dir }) });
  const oneWrites = s.writes();
  const main = s.cli(["adapter", "setup"], { env: withLog(s, { PASEO_WORKTREE_PATH: s.main }) });
  const bad = s.cli(["adapter", "setup", "--only", "nope"], { cwd: dir });

  assert.equal(one.status, 0, one.err);
  assert.equal(main.status, 0, main.err);
  assert.deepEqual(logged(s), [`env ${dir}`]);
  assert.deepEqual(oneWrites, []);
  assert.equal(bad.status, 2);
});

test("adapter issue <url> starts that issue and exits with its code; another repo's URL is refused", () => {
  const s = startSandbox();
  const dir = toolWorktree(s, "ramon/avisar");

  const wrong = s.cli(["adapter", "issue", "https://github.com/acme/other/issues/214"], { cwd: dir });
  const right = s.cli(["adapter", "issue", ISSUE_URL], { cwd: dir });

  assert.equal(wrong.status, 1);
  assert.match(wrong.err, /is not an issue of acme\/widgets; nothing done/);
  assert.equal(right.status, 0, right.err);
  assert.equal(created(s).length, 1);
});

test("archive runs the teardown, frees the ports and deletes the worktree's Docker; always exits 0", () => {
  const s = startSandbox();
  flow(s, { worktrees: { teardown: [{ name: "down", run: 'echo "down $PWD" >> "$LOG"; exit 1' }], ports: PORTS, dockerProjects: ["app"] } });
  const dir = toolWorktree(s, "feat/214-x");
  const base = s.cli(["worktree", "ports"], { cwd: dir }).out.trim();
  s.docker.set({ running: true, items: [{ kind: "volume", id: "v1", project: dockerProject("app", dir), dir }] });

  const r = s.cli(["adapter", "archive"], { cwd: dir, env: withLog(s) });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(logged(s), [`down ${dir}`]);
  assert.deepEqual(s.docker.get().items, []);
  assert.equal(existsSync(join(s.stateDir, "ports", base)), false);
});

test("archive with git's link broken still deletes the folder's Docker, with the config Orca names", () => {
  const s = startSandbox();
  flow(s, { worktrees: { dockerProjects: ["app"] } });
  const dir = toolWorktree(s, "feat/214-x");
  const moved = `${dir}-moved`;
  renameSync(dir, moved);
  s.git(s.main, "worktree", "prune");
  s.docker.set({ running: true, items: [{ kind: "volume", id: "v1", project: dockerProject("app", moved), dir: moved }] });

  const r = s.cli(["adapter", "archive"], { cwd: moved, env: { ORCA_WORKTREE_PATH: moved, ORCA_ROOT_PATH: s.main } });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(s.docker.get().items, []);
});

test("archive in the main checkout runs no teardown", () => {
  const s = startSandbox();
  flow(s, { worktrees: { teardown: [logStep("down")] } });

  const r = s.cli(["adapter", "archive"], { env: withLog(s) });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(logged(s), []);
});

test("archive stops the apps of the worktree on its ports, before its steps, and nothing outside it", { skip: !installed("lsof") }, async () => {
  const s = startSandbox();
  const stoppedFirst = { name: "down", run: 'test -e "$TMPDIR_T/termed" && echo stopped-first >> "$LOG"' };
  flow(s, { worktrees: { ports: PORTS, teardown: [stoppedFirst] } });
  const dir = toolWorktree(s, "feat/214-x");
  const base = Number(s.cli(["worktree", "ports"], { cwd: dir }).out.trim());
  const termed = join(s.tmp, "termed");
  const app = await listener(join(dir, ".agents"), base, { parent: true, onTerm: termed });
  const outside = await listener(s.tmp, base + 1);

  const r = s.cli(["adapter", "archive"], { cwd: dir, env: withLog(s, { TMPDIR_T: s.tmp }) });
  for (let tries = 0; tries < 40 && alive(app); tries += 1) await sleep(50);

  try {
    assert.equal(r.status, 0, r.err);
    assert.match(r.err, /stopping the apps that run in /);
    assert.deepEqual(logged(s), ["stopped-first"]);
    assert.equal(alive(app), false);
    assert.equal(existsSync(termed), true);
    assert.equal(alive(outside), true);
  } finally {
    for (const group of [app, outside]) {
      try {
        process.kill(-group, "SIGKILL");
      } catch {}
    }
  }
});

test("archive kills an app that ignores TERM", { skip: !installed("lsof") }, async () => {
  const s = startSandbox();
  flow(s, { worktrees: { ports: PORTS } });
  const dir = toolWorktree(s, "feat/214-x");
  const base = Number(s.cli(["worktree", "ports"], { cwd: dir }).out.trim());
  const app = await listener(dir, base, { ignoreTerm: true });

  const r = s.cli(["adapter", "archive"], { cwd: dir });
  for (let tries = 0; tries < 40 && alive(app); tries += 1) await sleep(50);

  try {
    assert.equal(r.status, 0, r.err);
    assert.equal(alive(app), false);
  } finally {
    try {
      process.kill(-app, "SIGKILL");
    } catch {}
  }
});

test("archive signals only the app when the leader of its group runs outside the worktree", { skip: !installed("lsof") }, async () => {
  const s = startSandbox();
  flow(s, { worktrees: { ports: PORTS } });
  const dir = toolWorktree(s, "feat/214-x");
  const base = Number(s.cli(["worktree", "ports"], { cwd: dir }).out.trim());
  const termed = join(s.tmp, "termed");
  const launcher = await listener(s.tmp, base, { parent: true, childCwd: dir, onTerm: termed });

  const r = s.cli(["adapter", "archive"], { cwd: dir });
  // NOTE: a dead launcher stays a zombie until this process reaps it, which needs a free
  // event loop.
  await sleep(500);

  try {
    assert.equal(r.status, 0, r.err);
    assert.equal(existsSync(termed), true);
    assert.equal(alive(launcher), true);
  } finally {
    try {
      process.kill(-launcher, "SIGKILL");
    } catch {}
  }
});

test("setup goes on with the defaults when .agents/flow.json is not valid", () => {
  const s = startSandbox();
  const dir = toolWorktree(s, "ramon/explore");
  mkdirSync(join(s.main, ".agents"), { recursive: true });
  writeFileSync(join(s.main, ".agents", "flow.json"), "{ nope");

  const setup = s.cli(["adapter", "setup"], { cwd: dir, env: { PASEO_WORKTREE_PATH: dir } });
  const issue = s.cli(["adapter", "issue", ISSUE_URL], { cwd: dir });

  assert.equal(setup.status, 0, setup.err);
  assert.match(setup.err, /is not valid JSON.*going on with the defaults/);
  assert.equal(issue.status, 2);
});
