// Tests of `issue-flow worktree …` and `issue-flow session`, with the cases of Abastio's
// worktree-setup, worktree-prune, worktree-cleanup and claude-session-env tests: a real
// bare origin, the GitHub of fake-github.mjs and the Docker of fake-docker.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dockerProject } from "../dist/docker.js";
import { startSandbox } from "./start-helpers.mjs";

// Writes .agents/flow.json in the main checkout with that `worktrees` section, committed and
// pushed, so worktrees from origin/main have it too.
function flow(s, worktrees) {
  mkdirSync(join(s.main, ".agents"), { recursive: true });
  writeFileSync(join(s.main, ".agents", "flow.json"), JSON.stringify({ worktrees }));
  s.git(s.main, "add", ".agents/flow.json");
  s.git(s.main, "commit", "-q", "-m", "flow");
  s.git(s.main, "push", "-q", "origin", "main");
}

// A linked worktree in .claude/worktrees, on a new branch from origin/main.
function worktree(s, branch) {
  const dir = join(s.main, ".claude", "worktrees", branch.replaceAll("/", "+"));
  s.git(s.main, "worktree", "add", "-q", dir, "-b", branch, "origin/main");
  return dir;
}

// A step that appends its name and the variables it got to $LOG.
const logStep = (name, extra = "") => ({
  name,
  run: `echo "${name} $ISSUE_FLOW_WORKTREE|$ISSUE_FLOW_MAIN_ROOT|$ISSUE_FLOW_PORT_BASE|$ISSUE_FLOW_DOCKER_SUFFIX|$PWD" >> "$LOG"${extra}`,
});

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The worktree each logged step ran for.
const worktreesOf = (s) => logged(s).map((line) => line.slice(line.indexOf(" ") + 1).split("|")[0]);

function logged(s) {
  const file = join(s.tmp, "steps.log");
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
}

const withLog = (s, env = {}) => ({ LOG: join(s.tmp, "steps.log"), ...env });

test("setup runs the steps in order in the worktree, with its variables; the main checkout runs none", () => {
  const s = startSandbox();
  flow(s, { setup: [logStep("deps"), logStep("env")], ports: { start: 42000, blockSize: 2, blocks: 4 } });
  const dir = worktree(s, "feat/1-x");

  const main = s.cli(["worktree", "setup"], { env: withLog(s) });
  const inWorktree = s.cli(["worktree", "setup"], { cwd: dir, env: withLog(s) });

  assert.equal(main.status, 0, main.err);
  assert.equal(inWorktree.status, 0, inWorktree.err);
  const lines = logged(s);
  assert.equal(lines.length, 2);
  assert.match(lines[0], new RegExp(`^deps ${escape(dir)}\\|${escape(s.main)}\\|4200[0246]\\|feat-1-x-[0-9a-f]{6}\\|${escape(dir)}$`));
  assert.match(lines[1], /^env /);
});

test("setup --only runs one step, and a name that is not a step is a usage error", () => {
  const s = startSandbox();
  flow(s, { setup: [logStep("deps"), logStep("env")] });
  const dir = worktree(s, "feat/1-x");

  const one = s.cli(["worktree", "setup", "--only", "env"], { cwd: dir, env: withLog(s) });
  const bad = s.cli(["worktree", "setup", "--only", "nope"], { cwd: dir, env: withLog(s) });

  assert.equal(one.status, 0, one.err);
  assert.deepEqual(logged(s).map((line) => line.split(" ")[0]), ["env"]);
  assert.equal(bad.status, 2);
  assert.match(bad.err, /--only expects a setup step of \.agents\/flow\.json \(deps, env\): nope/);
});

test("a trusted step runs only with the code of origin/main, except in a cloud session", () => {
  const s = startSandbox();
  flow(s, { setup: [{ ...logStep("deps"), trusted: true }] });
  const clean = worktree(s, "feat/1-clean");
  const ahead = worktree(s, "feat/2-ahead");
  s.git(ahead, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "foreign");
  const changed = worktree(s, "feat/3-changed");
  writeFileSync(join(changed, ".gitignore"), "changed\n");

  const trusted = s.cli(["worktree", "setup"], { cwd: clean, env: withLog(s) });
  const untrusted = s.cli(["worktree", "setup"], { cwd: ahead, env: withLog(s) });
  const dirty = s.cli(["worktree", "setup"], { cwd: changed, env: withLog(s) });
  const cloud = s.cli(["worktree", "setup"], { cwd: ahead, env: withLog(s, { CLAUDE_CODE_REMOTE: "true" }) });

  assert.equal(trusted.status, 0, trusted.err);
  assert.equal(untrusted.status, 0, untrusted.err);
  assert.match(untrusted.err, /skipped "deps": this worktree has code that is not in origin\/main/);
  assert.match(dirty.err, /skipped "deps"/);
  assert.equal(cloud.status, 0, cloud.err);
  assert.deepEqual(worktreesOf(s), [clean, ahead]);
});

test("a once step runs until it works; a failed step exits 1 and the next one still runs", () => {
  const s = startSandbox();
  const flag = join(s.tmp, "works");
  flow(s, { setup: [{ ...logStep("deps", ` && test -e "${flag}"`), once: true }, logStep("env")] });
  const dir = worktree(s, "feat/1-x");

  const failed = s.cli(["worktree", "setup"], { cwd: dir, env: withLog(s) });
  writeFileSync(flag, "");
  const worked = s.cli(["worktree", "setup"], { cwd: dir, env: withLog(s) });
  const skipped = s.cli(["worktree", "setup"], { cwd: dir, env: withLog(s) });

  assert.equal(failed.status, 1);
  assert.match(failed.err, /step "deps" failed \(exit 1\); run '/);
  assert.equal(worked.status, 0, worked.err);
  assert.equal(skipped.status, 0, skipped.err);
  assert.deepEqual(logged(s).map((line) => line.split(" ")[0]), ["deps", "env", "deps", "env", "env"]);
});

test("the steps come from the main checkout's config, never from the worktree's", () => {
  const s = startSandbox();
  flow(s, { setup: [logStep("deps")] });
  const dir = worktree(s, "feat/1-x");
  writeFileSync(join(dir, ".agents", "flow.json"), JSON.stringify({ worktrees: { setup: [logStep("evil")] } }));

  const r = s.cli(["worktree", "setup"], { cwd: dir, env: withLog(s) });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(logged(s).map((line) => line.split(" ")[0]), ["deps"]);
});

test("a setup lock without a pid, some seconds old, is taken over", () => {
  const s = startSandbox();
  flow(s, { setup: [logStep("deps")] });
  const dir = worktree(s, "feat/1-x");
  const lock = join(s.main, ".git", "worktrees", "feat+1-x", "issue-flow-setup.lock");
  mkdirSync(lock);
  const old = new Date(Date.now() - 60_000);
  utimesSync(lock, old, old);

  const r = s.cli(["worktree", "setup"], { cwd: dir, env: withLog(s) });

  assert.equal(r.status, 0, r.err);
  assert.equal(logged(s).length, 1);
});

test("prune says which PRs it could not read, and leaves those worktrees", () => {
  const s = startSandbox();
  const dir = worktree(s, "feat/1-x");
  s.pull({ number: 10, branch: "feat/1-x", state: "merged" });
  s.world.pullsFail = true;

  const r = s.cli(["worktree", "prune", "--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.err, /could not read the PRs of feat\/1-x from GitHub; they were left alone/);
  assert.ok(existsSync(dir));
});

test("a setup lock left by a process that is gone is taken over", () => {
  const s = startSandbox();
  flow(s, { setup: [logStep("deps")] });
  const dir = worktree(s, "feat/1-x");
  const lock = join(s.main, ".git", "worktrees", "feat+1-x", "issue-flow-setup.lock");
  mkdirSync(lock);
  writeFileSync(join(lock, "pid"), "99999999\n");

  const r = s.cli(["worktree", "setup"], { cwd: dir, env: withLog(s) });

  assert.equal(r.status, 0, r.err);
  assert.equal(logged(s).length, 1);
  assert.equal(existsSync(lock), false);
});

test("teardown runs its steps, frees the ports and deletes the worktree's Docker; not in the main checkout", () => {
  const s = startSandbox();
  flow(s, { teardown: [logStep("down")], ports: { start: 42000, blockSize: 2, blocks: 4 }, dockerProjects: ["acme-dev"] });
  const dir = worktree(s, "feat/1-x");
  const base = s.cli(["worktree", "ports"], { cwd: dir }).out.trim();
  s.docker.set({ running: true, items: [{ kind: "container", id: "c1", project: dockerProject("acme-dev", dir), dir }] });

  const r = s.cli(["worktree", "teardown"], { cwd: dir, env: withLog(s) });
  const main = s.cli(["worktree", "teardown"], { env: withLog(s) });

  assert.equal(r.status, 0, r.err);
  assert.equal(logged(s).length, 1);
  assert.match(logged(s)[0], new RegExp(`^down ${escape(dir)}\\|${escape(s.main)}\\|${base}\\|`));
  assert.equal(existsSync(join(s.stateDir, "ports", base)), false);
  assert.deepEqual(s.docker.get().items, []);
  assert.equal(main.status, 1);
  assert.match(main.err, /teardown is for worktrees, not the main checkout/);
});

test("teardown --path never takes the main checkout by another path, nor a folder that is not a worktree", () => {
  const s = startSandbox();
  flow(s, { teardown: [logStep("down")] });
  const elsewhere = join(s.tmp, "elsewhere");
  mkdirSync(elsewhere);

  const dot = s.cli(["worktree", "teardown", "--path", "."], { env: withLog(s) });
  const slash = s.cli(["worktree", "teardown", "--path", `${s.main}/`], { env: withLog(s) });
  const other = s.cli(["worktree", "teardown", "--path", elsewhere], { env: withLog(s) });

  assert.deepEqual([dot.status, slash.status, other.status], [1, 1, 1]);
  assert.match(dot.err, /teardown is for worktrees, not the main checkout/);
  assert.match(other.err, /is not a worktree of this repo/);
  assert.deepEqual(logged(s), []);
});

test("teardown --path of a worktree already gone frees its Docker", () => {
  const s = startSandbox();
  flow(s, { dockerProjects: ["acme-dev"] });
  const dir = worktree(s, "feat/1-x");
  s.git(s.main, "worktree", "remove", dir);
  s.docker.set({ running: true, items: [{ kind: "volume", id: "v1", project: dockerProject("acme-dev", dir) }] });

  const r = s.cli(["worktree", "teardown", "--path", dir]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(s.docker.get().items, []);
});

test("ports prints the worktree's block, keeps it, and --next moves it", () => {
  const s = startSandbox();
  flow(s, { ports: { start: 42000, blockSize: 2, blocks: 4 } });
  const dir = worktree(s, "feat/1-x");
  const none = startSandbox();

  const first = s.cli(["worktree", "ports"], { cwd: dir });
  const again = s.cli(["worktree", "ports"], { cwd: dir });
  const moved = s.cli(["worktree", "ports", "--next"], { cwd: dir });
  const off = none.cli(["worktree", "ports"]);

  assert.equal(first.status, 0, first.err);
  assert.match(first.out, /^4200[0246]\n$/);
  assert.equal(again.out, first.out);
  assert.notEqual(moved.out, first.out);
  assert.match(moved.err, /the worktree moves to block 4200[0246]/);
  assert.equal(off.status, 1);
  assert.match(off.err, /this repo has no ports for worktrees/);
});

test("cleanup deletes the Docker of deleted worktrees with a prefix, and nothing else", () => {
  const s = startSandbox();
  flow(s, { dockerProjects: ["acme-dev"] });
  const alive = worktree(s, "feat/1-alive");
  mkdirSync(join(alive, "infra"));
  writeFileSync(join(alive, "infra", "compose.yml"), "services: {}\n");
  const gone = join(s.main, ".claude", "worktrees", "feat+2-gone");
  mkdirSync(gone, { recursive: true });
  s.docker.set({
    running: true,
    items: [
      { kind: "container", id: "c-gone", project: "acme-dev-feat-2-gone-abc123", dir: gone },
      { kind: "volume", id: "v-gone", project: "acme-dev-feat-2-gone-abc123" },
      { kind: "network", id: "n-gone", project: "acme-dev-feat-2-gone-abc123" },
      { kind: "container", id: "c-alive", project: "acme-dev-feat-1-alive-def456", dir: alive },
      { kind: "container", id: "c-infra", project: "acme-dev-feat-1-alive-def457", dir: join(alive, "infra") },
      { kind: "container", id: "c-main", project: "acme-dev", dir: join(s.tmp, "elsewhere") },
      { kind: "container", id: "c-other", project: "other-dev-x-1", dir: gone },
    ],
  });

  const r = s.cli(["worktree", "cleanup"]);

  assert.equal(r.status, 0, r.err);
  assert.equal(r.out, "deleted: acme-dev-feat-2-gone-abc123\n");
  assert.deepEqual(s.docker.get().items.map((item) => item.id), ["c-alive", "c-infra", "c-main", "c-other"]);
});

test("cleanup --path deletes that worktree's projects even if it lives, with volumes left without containers", () => {
  const s = startSandbox();
  flow(s, { dockerProjects: ["acme-dev", "acme-tests", "acme-e2e"] });
  const dir = worktree(s, "feat/1-x");
  s.docker.set({
    running: true,
    items: [
      { kind: "container", id: "c1", project: dockerProject("acme-dev", dir), dir },
      { kind: "volume", id: "v1", project: dockerProject("acme-tests", dir) },
      { kind: "container", id: "keep", project: "acme-dev-feat-9-y-000000", dir: join(s.tmp, "y") },
    ],
  });

  const r = s.cli(["worktree", "cleanup", "--path", dir]);

  assert.equal(r.status, 0, r.err);
  assert.equal(r.out, `deleted: ${dockerProject("acme-dev", dir)}\ndeleted: ${dockerProject("acme-tests", dir)}\n`);
  assert.deepEqual(s.docker.get().items.map((item) => item.id), ["keep"]);
});

test("cleanup with Docker down says so, deletes nothing and exits 0; a project that resists exits 1", () => {
  const s = startSandbox();
  flow(s, { dockerProjects: ["acme-dev"] });
  s.docker.set({ running: false, items: [] });
  const down = s.cli(["worktree", "cleanup"]);
  s.docker.set({ running: true, items: [{ kind: "container", id: "c1", project: "acme-dev-x-1", dir: join(s.tmp, "gone"), stuck: true }] });

  const stuck = s.cli(["worktree", "cleanup"]);

  assert.equal(down.status, 0, down.err);
  assert.match(down.err, /Docker is not running; nothing was cleaned/);
  assert.equal(stuck.status, 1);
  assert.match(stuck.err, /could not delete acme-dev-x-1/);
});

test("prune deletes, after a yes, the worktrees of merged or closed PRs with their branch and teardown", () => {
  const s = startSandbox();
  flow(s, { teardown: [logStep("down")] });
  const merged = worktree(s, "feat/1-merged");
  const closed = worktree(s, "feat/2-closed");
  const open = worktree(s, "feat/3-open");
  s.git(merged, "push", "-q", "origin", "feat/1-merged");
  s.pull({ number: 10, branch: "feat/1-merged", state: "merged" });
  s.pull({ number: 11, branch: "feat/2-closed", state: "closed" });
  s.pull({ number: 12, branch: "feat/3-open" });
  const sessions = join(s.main, ".git", "issue-flow-sessions");
  mkdirSync(sessions);
  writeFileSync(join(sessions, "feat+1-merged"), "id\n");

  const no = s.cli(["worktree", "prune"], { input: "n\n", env: withLog(s) });
  const kept = [merged, closed].every((dir) => existsSync(dir));
  const yes = s.cli(["worktree", "prune"], { input: "y\n", env: withLog(s) });

  assert.equal(no.status, 0, no.err);
  assert.match(no.out, /Deleted nothing\./);
  assert.ok(kept);
  assert.equal(yes.status, 0, yes.err);
  assert.match(yes.out, /PR MERGED: .*feat\+1-merged \(feat\/1-merged\)/);
  assert.match(yes.out, /deleted: .*feat\+2-closed \(feat\/2-closed\)/);
  assert.equal(existsSync(merged) || existsSync(closed), false);
  assert.ok(existsSync(open));
  assert.equal(s.git(s.main, "branch", "--list", "feat/1-merged", "feat/2-closed"), "");
  assert.equal(existsSync(join(sessions, "feat+1-merged")), false);
  assert.deepEqual(worktreesOf(s).sort(), [closed, merged].sort());
});

test("prune never deletes a dirty worktree, one with unpushed commits, or a locked one", () => {
  const s = startSandbox();
  const dirty = worktree(s, "feat/1-dirty");
  writeFileSync(join(dirty, "notes.txt"), "x\n");
  const ahead = worktree(s, "feat/2-ahead");
  s.git(ahead, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "unpushed");
  const live = worktree(s, "feat/3-live");
  s.git(s.main, "worktree", "lock", "--reason", `claude session issue-flow ${process.pid}`, live);
  const dead = worktree(s, "feat/4-dead");
  s.git(s.main, "worktree", "lock", "--reason", "claude session issue-flow 99999999", dead);
  const claude = worktree(s, "feat/5-claude");
  s.git(s.main, "worktree", "lock", "--reason", "claude session", claude);
  const hand = worktree(s, "feat/6-hand");
  s.git(s.main, "worktree", "lock", hand);
  for (const [index, branch] of ["feat/1-dirty", "feat/2-ahead", "feat/3-live", "feat/4-dead", "feat/5-claude", "feat/6-hand"].entries())
    s.pull({ number: 20 + index, branch, state: "merged" });

  const r = s.cli(["worktree", "prune", "--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /PR MERGED, but with uncommitted changes, not deleted: .*feat\+1-dirty/);
  assert.match(r.out, /PR MERGED, but with commits that are not in origin, not deleted: .*feat\+2-ahead/);
  assert.match(r.out, /in use by a Claude session, not touched: .*feat\+3-live/);
  assert.match(r.out, /locked by an issue-flow session that is gone, not touched: .*feat\+4-dead \(free it with: git worktree unlock/);
  assert.match(r.out, /in use by a Claude session, not touched: .*feat\+5-claude/);
  assert.match(r.out, /locked, not touched: .*feat\+6-hand/);
  assert.match(r.out, /No worktrees to delete\./);
  assert.ok([dirty, ahead, live, dead, claude, hand].every((dir) => existsSync(dir)));
});

test("prune --only looks at that worktree alone", () => {
  const s = startSandbox();
  const one = worktree(s, "feat/1-one");
  const two = worktree(s, "feat/2-two");
  s.pull({ number: 10, branch: "feat/1-one", state: "merged" });
  s.pull({ number: 11, branch: "feat/2-two", state: "merged" });

  const r = s.cli(["worktree", "prune", "--only", two, "--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.equal(existsSync(two), false);
  assert.ok(existsSync(one));
});

// A program in the sandbox's PATH that logs its arguments and folder to $LOG, then runs `body`.
function program(s, name, body = "") {
  const file = join(s.tmp, "bin", name);
  writeFileSync(file, `#!/bin/sh\necho "${name} $* $PWD" >> "$LOG"\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

test("session in a worktree runs the setup and tells Claude on stdout what failed; in the main checkout it does not", () => {
  const s = startSandbox();
  flow(s, { setup: [{ name: "deps", run: "exit 3" }] });
  const dir = worktree(s, "feat/1-x");
  s.git(dir, "push", "-q", "-u", "origin", "feat/1-x");

  const inWorktree = s.cli(["session"], { cwd: dir });
  const main = s.cli(["session"]);

  assert.equal(inWorktree.status, 0);
  assert.match(inWorktree.out, /step "deps" failed \(exit 3\)/);
  assert.doesNotMatch(inWorktree.out, /was not started/);
  assert.equal(main.status, 0);
  assert.equal(main.out, "");
});

test("session in the cloud runs claude-cloud session and the setup in its checkout, or says how to set up the environment", () => {
  const s = startSandbox();
  flow(s, { setup: [{ name: "deps", run: 'echo "setup $PWD" >> "$LOG"' }] });
  const bin = program(s, "claude-cloud");
  const cloud = { CLAUDE_CODE_REMOTE: "true", CLAUDE_CLOUD_BIN: bin };

  const ran = s.cli(["session"], { env: withLog(s, cloud) });
  const missing = s.cli(["session"], { env: withLog(s, { ...cloud, CLAUDE_CLOUD_BIN: join(s.tmp, "none") }) });

  assert.equal(ran.status, 0);
  assert.deepEqual(logged(s).slice(0, 2), [`claude-cloud session ${s.main}`, `setup ${s.main}`]);
  assert.match(missing.out, /the environment setup did not run .* npx -y @ramon-sg\/claude-cloud@1 setup/);
});

test("session warns of an issue worktree whose branch was never published", () => {
  const s = startSandbox();
  const dir = worktree(s, "feat/214-x");

  const r = s.cli(["session"], { cwd: dir });

  assert.equal(r.status, 0);
  assert.match(r.out, /issue #214 was not started: its branch is not published and has no draft PR/);
});

test("session appends direnv's environment to CLAUDE_ENV_FILE, and never a failed export", () => {
  const s = startSandbox();
  writeFileSync(join(s.main, ".envrc"), "export X=1\n");
  const envFile = join(s.tmp, "claude-env");
  writeFileSync(envFile, "");
  program(s, "direnv", 'echo "export X=1"; exit ${DIRENV_EXIT:-0}');

  const ok = s.cli(["session"], { env: withLog(s, { CLAUDE_ENV_FILE: envFile }) });
  const failed = s.cli(["session"], { env: withLog(s, { CLAUDE_ENV_FILE: envFile, DIRENV_EXIT: "1" }) });

  assert.equal(ok.status, 0);
  assert.equal(readFileSync(envFile, "utf8"), "export X=1\n\n");
  assert.match(failed.out, /could not load the \.envrc with direnv/);
  assert.equal(readFileSync(envFile, "utf8"), "export X=1\n\n");
});

test("issue start runs the setup in the new worktree after copying the included files", () => {
  const s = startSandbox();
  flow(s, { setup: [{ name: "creds", run: `test -e .local/credentials && echo creds >> "$LOG"` }] });

  const r = s.run(["214", "--yes", "--no-launch"], { env: withLog(s) });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(logged(s), ["creds"]);
});

test("the cleanup after a merged PR runs the teardown while the worktree is still there", () => {
  const s = startSandbox();
  flow(s, { teardown: [{ name: "down", run: `test -d "$ISSUE_FLOW_WORKTREE" && echo down >> "$LOG"` }] });

  const r = s.run(["214", "--yes"], { input: "y\n", env: withLog(s, { FAKE_CLAUDE_MERGE: "900" }) });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(logged(s), ["down"]);
  assert.equal(existsSync(join(s.main, ".claude", "worktrees", "feat+214-odoo-refund-notice")), false);
});
