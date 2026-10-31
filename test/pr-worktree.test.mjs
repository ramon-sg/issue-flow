// Tests of `issue-flow pr worktree` and of the WorktreeCreate and WorktreeRemove hooks, with
// the cases of Clean Queen's scripts/pr-worktree.sh and .claude/hooks/worktree-*.sh: a real
// bare origin, the GitHub of fake-github.mjs, the fake claude and the fake docker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dockerProject } from "../dist/docker.js";
import { startSandbox } from "./start-helpers.mjs";
import { flow, logged, logStep, withLog } from "./worktree-helpers.mjs";

const PR_BRANCH = "feat/7-review-me";

// A PR #7 whose branch is in origin with a commit that adds review.txt.
function withPr(s, extra = {}) {
  const sha = s.pushBranch(PR_BRANCH, { file: "review.txt" });
  s.pull({ number: 7, branch: PR_BRANCH, sha, ...extra });
  return sha;
}

const prPath = (s) => join(s.main, ".claude", "worktrees", "pr-7");
const hook = (s, name, input, env = {}) => s.cli(["hook", name], { input: JSON.stringify(input), env });

test("pr worktree makes a worktree on the PR's branch, tracking origin, and leaves the main checkout alone", () => {
  const s = startSandbox();
  const sha = withPr(s);
  writeFileSync(join(s.main, "local-work.txt"), "mine\n");

  const r = s.cli(["pr", "worktree", "7"]);

  assert.equal(r.status, 0, r.err);
  const dir = prPath(s);
  assert.equal(s.git(dir, "rev-parse", "HEAD"), sha);
  assert.equal(s.git(dir, "rev-parse", "--abbrev-ref", "HEAD"), PR_BRANCH);
  assert.equal(s.git(dir, "rev-parse", "--abbrev-ref", "@{u}"), `origin/${PR_BRANCH}`);
  assert.equal(readFileSync(join(dir, ".local", "credentials"), "utf8"), "ID=x\n");
  assert.equal(s.git(s.main, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.equal(s.git(s.main, "status", "--porcelain"), "?? local-work.txt");
  assert.match(r.out, /Ready\. To go in: cd .*\/\.claude\/worktrees\/pr-7\n/);
  assert.deepEqual(s.writes(), []);
});

test("pr worktree with .git/config locked, as in Claude Code's sandbox, still makes the worktree", () => {
  const s = startSandbox();
  const sha = withPr(s);
  writeFileSync(join(s.main, ".git", "config.lock"), "");

  const r = s.cli(["pr", "worktree", "7", "--no-setup"]);

  assert.equal(r.status, 0, r.err);
  assert.equal(s.git(prPath(s), "rev-parse", "HEAD"), sha);
  assert.equal(s.git(prPath(s), "rev-parse", "--abbrev-ref", "HEAD"), PR_BRANCH);
  assert.match(r.err, /could not make feat\/7-review-me track origin\/feat\/7-review-me/);
});

test("pr worktree with .git/config locked and a local branch already tracking origin warns of nothing", () => {
  const s = startSandbox();
  withPr(s);
  s.git(s.main, "fetch", "-q", "origin", `${PR_BRANCH}:${PR_BRANCH}`);
  s.git(s.main, "branch", "-q", `--set-upstream-to=origin/${PR_BRANCH}`, PR_BRANCH);
  writeFileSync(join(s.main, ".git", "config.lock"), "");

  const r = s.cli(["pr", "worktree", "7", "--no-setup"]);

  assert.equal(r.status, 0, r.err);
  assert.doesNotMatch(r.err, /track/);
});

test("pr worktree runs the setup but skips trusted steps, since the PR's code is not in main", () => {
  const s = startSandbox();
  flow(s, { worktrees: { setup: [{ ...logStep("deps"), trusted: true }, logStep("env")] } });
  withPr(s);

  const r = s.cli(["pr", "worktree", "7"], { env: withLog(s) });
  const bare = s.cli(["pr", "worktree", "7", "--no-setup"], { env: withLog(s) });

  assert.equal(r.status, 0, r.err);
  assert.match(r.err, /skipped "deps": this worktree has code that is not in origin\/main/);
  assert.equal(bare.status, 0, bare.err);
  assert.match(bare.out, /The worktree already exists; reusing it\./);
  assert.deepEqual(logged(s), [`env ${prPath(s)}`]);
});

test("pr worktree moves a local copy of the branch forward to origin's", () => {
  const s = startSandbox();
  const sha = withPr(s);
  s.git(s.main, "branch", "--no-track", PR_BRANCH, "origin/main");

  const r = s.cli(["pr", "worktree", "7"]);

  assert.equal(r.status, 0, r.err);
  assert.equal(s.git(prPath(s), "rev-parse", "HEAD"), sha);
  assert.equal(s.git(prPath(s), "rev-parse", "--abbrev-ref", "@{u}"), `origin/${PR_BRANCH}`);
});

test("pr worktree refuses a fork's PR, a missing PR and a branch checked out in the main checkout", () => {
  const s = startSandbox();
  s.pull({ number: 8, branch: "fork-branch", fork: true });
  withPr(s);
  s.git(s.main, "fetch", "-q", "origin");
  s.git(s.main, "checkout", "-q", "-b", PR_BRANCH, `origin/${PR_BRANCH}`);

  const fork = s.cli(["pr", "worktree", "8"]);
  const missing = s.cli(["pr", "worktree", "99"]);
  const taken = s.cli(["pr", "worktree", "7"]);

  assert.equal(fork.status, 1);
  assert.match(fork.err, /PR #8 comes from a fork and its branch is not in origin/);
  assert.equal(missing.status, 1);
  assert.match(missing.err, /acme\/widgets has no PR #99/);
  assert.equal(taken.status, 1);
  assert.match(taken.err, new RegExp(`${PR_BRANCH} is checked out in ${s.main};`));
  assert.equal(existsSync(prPath(s)), false);
  assert.equal(s.git(s.main, "rev-parse", "--abbrev-ref", "HEAD"), PR_BRANCH);
});

test("pr worktree -- runs the command in the worktree and exits with its code; with none it opens Claude there", () => {
  const s = startSandbox();
  withPr(s);
  const file = join(s.tmp, "where");

  const command = s.cli(["pr", "worktree", "7", "--", "sh", "-c", `pwd > "${file}"; exit 3`]);
  const claude = s.cli(["pr", "worktree", "7", "--"]);
  const claudeDirs = s.claudeCalls().map((call) => call.cwd);
  const misplaced = s.cli(["worktree", "ports", "--", "sh"]);

  assert.equal(command.status, 3, command.err);
  assert.equal(readFileSync(file, "utf8").trim(), prPath(s));
  assert.equal(claude.status, 0, claude.err);
  assert.deepEqual(claudeDirs, [prPath(s)]);
  assert.equal(misplaced.status, 2);
});

test("worktree-create makes the worktree from origin's base branch and prints only its path", () => {
  const s = startSandbox();
  const developTip = s.pushBranch("develop", { commit: true });
  flow(s, { baseBranch: "develop", worktrees: { setup: [logStep("deps")] } });

  const r = hook(s, "worktree-create", { name: "bold-oak", cwd: s.main }, withLog(s));

  assert.equal(r.status, 0, r.err);
  const dir = join(s.main, ".claude", "worktrees", "bold-oak");
  assert.equal(r.out, `${dir}\n`);
  assert.equal(s.git(dir, "rev-parse", "--abbrev-ref", "HEAD"), "worktree-bold-oak");
  assert.equal(s.git(dir, "rev-parse", "HEAD"), developTip);
  assert.equal(readFileSync(join(dir, ".local", "credentials"), "utf8"), "ID=x\n");
  assert.deepEqual(logged(s), [`deps ${dir}`]);
  assert.match(r.err, /output of deps/);
});

test("worktree-create reuses an existing worktree, and refuses pr-<n> and names that leave the folder", () => {
  const s = startSandbox();
  const first = hook(s, "worktree-create", { name: "x/y", cwd: s.main });

  const again = hook(s, "worktree-create", { name: "x/y", cwd: s.main });
  const pr = hook(s, "worktree-create", { name: "pr-12", cwd: s.main });
  const up = hook(s, "worktree-create", { name: "..", cwd: s.main });
  const none = hook(s, "worktree-create", { cwd: s.main });

  assert.equal(first.status, 0, first.err);
  assert.equal(again.status, 0, again.err);
  assert.equal(again.out, first.out);
  assert.match(first.out, /\.claude\/worktrees\/x\+y\n$/);
  assert.equal(pr.status, 1);
  assert.match(pr.err, /to review a PR, run 'issue-flow pr worktree 12'/);
  assert.equal(up.status, 1);
  assert.equal(none.status, 1);
  assert.equal(existsSync(join(s.main, ".claude", "worktrees", "pr-12")), false);
});

test("worktree-remove runs the teardown, deletes the Docker, the folder and a branch with nothing unpushed", () => {
  const s = startSandbox();
  flow(s, { worktrees: { teardown: [logStep("down")], dockerProjects: ["app"] } });
  const dir = hook(s, "worktree-create", { name: "bold-oak", cwd: s.main }).out.trim();
  s.docker.set({ running: true, items: [{ kind: "volume", id: "v1", project: dockerProject("app", dir), dir }] });

  const r = hook(s, "worktree-remove", { worktree_path: dir, cwd: dir }, withLog(s));

  assert.equal(r.status, 0, r.err);
  assert.equal(existsSync(dir), false);
  assert.deepEqual(logged(s), [`down ${dir}`]);
  assert.deepEqual(s.docker.get().items, []);
  assert.equal(s.git(s.main, "branch", "--list", "worktree-bold-oak"), "");
});

test("worktree-remove keeps a worktree with changes, and the branch of one with unpushed commits", () => {
  const s = startSandbox();
  const dirty = hook(s, "worktree-create", { name: "dirty", cwd: s.main }).out.trim();
  writeFileSync(join(dirty, "draft.txt"), "x\n");
  const ahead = hook(s, "worktree-create", { name: "ahead", cwd: s.main }).out.trim();
  s.git(ahead, "commit", "-q", "--allow-empty", "-m", "local");

  const kept = hook(s, "worktree-remove", { worktree_path: dirty, cwd: s.main });
  const removed = hook(s, "worktree-remove", { worktree_path: ahead, cwd: s.main });

  assert.equal(kept.status, 1);
  assert.match(kept.err, /has uncommitted changes; kept/);
  assert.equal(existsSync(join(dirty, "draft.txt")), true);
  assert.equal(removed.status, 0, removed.err);
  assert.equal(existsSync(ahead), false);
  assert.match(removed.err, /kept the branch worktree-ahead: it has commits that are not in origin/);
  assert.equal(s.git(s.main, "branch", "--list", "worktree-ahead").trim(), "worktree-ahead");
});

test("worktree-remove never deletes the main checkout nor a folder that is not a worktree", () => {
  const s = startSandbox();
  const other = join(s.main, "docs");
  mkdirSync(other);
  writeFileSync(join(other, "keep.md"), "x\n");

  const main = hook(s, "worktree-remove", { worktree_path: s.main, cwd: s.main });
  const folder = hook(s, "worktree-remove", { worktree_path: other, cwd: s.main });

  assert.equal(main.status, 1);
  assert.match(main.err, /the main checkout is never deleted/);
  assert.equal(folder.status, 1);
  assert.match(folder.err, /is not a worktree of this repo; deleting nothing/);
  assert.equal(existsSync(join(other, "keep.md")), true);
});

test("session takes the folder from the hook's input, as claude --worktree sends the worktree's", () => {
  const s = startSandbox();
  flow(s, { worktrees: { setup: [logStep("deps")] } });
  const dir = hook(s, "worktree-create", { name: "bold-oak", cwd: s.main }).out.trim();
  writeFileSync(join(s.tmp, "steps.log"), "");

  const r = s.cli(["session"], { input: JSON.stringify({ cwd: dir }), env: withLog(s, { CLAUDE_PROJECT_DIR: s.main }) });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(logged(s), [`deps ${dir}`]);
});

test("session run by hand, without CLAUDE_PROJECT_DIR, does not read stdin", () => {
  const s = startSandbox();
  flow(s, { worktrees: { setup: [logStep("deps")] } });
  const dir = hook(s, "worktree-create", { name: "bold-oak", cwd: s.main }).out.trim();
  writeFileSync(join(s.tmp, "steps.log"), "");

  const r = s.cli(["session"], { input: JSON.stringify({ cwd: dir }), env: withLog(s) });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(logged(s), []);
});
