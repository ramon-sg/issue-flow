// Tests of `issue-flow issue start` with --adopt, --cloud, --teleport and --here, with the
// cases of Abastio's scripts/start-issue.test.sh: a real bare origin, the GitHub of
// fake-github.mjs and the fake claude.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BRANCH, startSandbox, WT } from "./start-helpers.mjs";

const URL = "https://github.com/acme/widgets.git";
const SESSION_ENV = { CLAUDE_CODE_REMOTE_SESSION_ID: "cse_01TEST" };
const NOTE = "Cloud session: https://claude.ai/code/session_01TEST";

// A worktree like the ones of Orca: outside the main checkout, from origin/main, on a branch
// with any name.
function toolWorktree(s, branch) {
  const dir = join(s.tmp, "orca", branch.replaceAll("/", "+"));
  s.git(s.main, "worktree", "add", "-q", dir, "-b", branch, "origin/main");
  return dir;
}

const branchAt = (s, dir) => s.git(dir, "rev-parse", "--abbrev-ref", "HEAD");
const created = (s) => s.writes().filter((call) => call.method === "POST" && call.path.endsWith("/pulls"));
const edited = (s) => s.writes().filter((call) => call.method === "PATCH");

test("usage errors of the cloud flags exit with 2 before calling GitHub", () => {
  const s = startSandbox();
  for (const args of [
    ["--cloud", "--branch"],
    ["--cloud", "--plan"],
    ["--cloud", "--here"],
    ["--cloud", "--teleport"],
    ["--here", "--branch"],
    ["--here", "--plan"],
    ["--here", "--free"],
    ["--here", "--adopt"],
    ["--teleport", "--plan"],
    ["--teleport", "--new"],
    ["--teleport", "--no-launch"],
    ["--cloud", "--free"],
    ["--adopt", "--branch"],
    ["--adopt", "--resume", "x"],
    ["--adopt", "--new"],
    ["--adopt", "--plan"],
    ["--adopt", "--ask-permissions"],
  ]) {
    const r = s.run(["214", ...args]);
    assert.equal(r.status, 2, args.join(" "));
    assert.deepEqual(s.ghCalls(), [], args.join(" "));
  }
});

test("--adopt renames a just-made worktree's branch and publishes it, without asking nor opening Claude", () => {
  const s = startSandbox();
  const dir = toolWorktree(s, "ramon/avisar-devoluciones");

  const r = s.run(["214", "--adopt"], { cwd: dir });

  assert.equal(r.status, 0, r.err);
  assert.equal(branchAt(s, dir), BRANCH);
  assert.equal(s.git(s.main, "branch", "--list", "ramon/*"), "");
  assert.match(r.out, /rename the branch ramon\/avisar-devoluciones to feat\/214-odoo-refund-notice/);
  assert.match(r.out, /Mode: {9}adopted worktree at /);
  assert.doesNotMatch(r.out, /Session:/);
  assert.equal(s.git(dir, "log", "-1", "--format=%s"), "chore: empieza el trabajo en la issue #214 [skip ci]");
  assert.equal(s.git(s.origin, "rev-parse", BRANCH), s.git(dir, "rev-parse", "HEAD"));
  assert.equal(created(s)[0].body.head, BRANCH);
  assert.equal(created(s)[0].body.draft, true);
  assert.deepEqual(s.world.issues[214].assignees, [{ login: "me" }]);
  assert.deepEqual(s.claudeCalls(), []);
  assert.equal(existsSync(join(s.main, WT)), false);
  assert.match(r.out, /Ready: issue #214 is on branch feat\/214-odoo-refund-notice, with its draft PR\./);
});

test("--adopt again with the PR open adds nothing", () => {
  const s = startSandbox();
  const dir = toolWorktree(s, "ramon/avisar-devoluciones");
  s.run(["214", "--adopt"], { cwd: dir });

  const r = s.run(["214", "--adopt"], { cwd: dir });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(created(s), []);
  assert.equal(s.git(dir, "rev-list", "--count", "origin/main..HEAD"), "1");
  assert.match(r.out, /Actions: {6}none: everything was already done/);
});

test("--adopt keeps a just-made branch that already has the issue's number", () => {
  const s = startSandbox();
  const dir = toolWorktree(s, "fix/214-mi-nombre");

  const r = s.run(["214", "--adopt"], { cwd: dir });

  assert.equal(r.status, 0, r.err);
  assert.equal(branchAt(s, dir), "fix/214-mi-nombre");
  assert.match(r.out, /\nBranch: {7}fix\/214-mi-nombre\n/);
  assert.doesNotMatch(r.out, /Found:|rename the branch/);
  assert.equal(created(s)[0].body.head, "fix/214-mi-nombre");
});

test("--adopt in a new round names the branch with -2 and points to the plan left open", () => {
  const s = startSandbox();
  const head = s.pushBranch(BRANCH, { commit: true });
  s.git(s.origin, "branch", "-D", BRANCH);
  s.pull({ number: 200, branch: BRANCH, state: "merged", body: "Closes #214", sha: head });
  mkdirSync(join(s.main, "docs", "plans"), { recursive: true });
  writeFileSync(join(s.main, "docs", "plans", "open.md"), "---\nstatus: in-progress\nprs: [200]\n---\n");
  s.git(s.main, "add", "docs/plans/open.md");
  s.git(s.main, "commit", "-q", "-m", "plan");
  s.git(s.main, "push", "-q", "origin", "main");
  const dir = toolWorktree(s, "ramon/segunda-tanda");

  const r = s.run(["214", "--adopt"], { cwd: dir });

  assert.equal(r.status, 0, r.err);
  assert.equal(branchAt(s, dir), `${BRANCH}-2`);
  assert.match(r.out, /Open plan of this issue, to resume: docs\/plans\/open\.md/);
});

test("--adopt stops if the issue already has its branch elsewhere, and renames nothing", () => {
  const s = startSandbox();
  const other = join(s.main, WT);
  s.git(s.main, "worktree", "add", "-q", other, "-b", BRANCH, "origin/main");
  const inWorktree = toolWorktree(s, "ramon/duplicada");
  const s2 = startSandbox();
  s2.pushBranch(BRANCH);
  const onlyOrigin = toolWorktree(s2, "ramon/solo-origin");

  const taken = s.run(["214", "--adopt"], { cwd: inWorktree });
  const remote = s2.run(["214", "--adopt"], { cwd: onlyOrigin });

  assert.equal(taken.status, 1);
  assert.ok(taken.err.includes(`already has branch ${BRANCH} (at ${other})`), taken.err);
  assert.equal(branchAt(s, inWorktree), "ramon/duplicada");
  assert.deepEqual(created(s), []);
  assert.equal(remote.status, 1);
  assert.ok(remote.err.includes(`already has branch ${BRANCH} (only in origin)`), remote.err);
});

test("--adopt never renames a worktree that is not just made", () => {
  const s = startSandbox();
  const withCommit = toolWorktree(s, "ramon/con-commits");
  s.git(withCommit, "commit", "-q", "--allow-empty", "-m", "earlier work");
  const pushed = toolWorktree(s, "ramon/publicada");
  s.git(pushed, "push", "-q", "origin", "ramon/publicada");
  const dirty = toolWorktree(s, "ramon/con-cambios");
  writeFileSync(join(dirty, ".gitignore"), "changed\n");

  const results = [withCommit, pushed, dirty].map((dir) => s.run(["214", "--adopt"], { cwd: dir }));

  assert.deepEqual(results.map((r) => r.status), [1, 1, 1]);
  assert.match(results[0].err, /only a just-made worktree is adopted/);
  assert.match(results[1].err, /only a just-made worktree is adopted/);
  assert.match(results[2].err, /has uncommitted changes: only a just-made worktree is adopted/);
  assert.deepEqual([withCommit, pushed, dirty].map((dir) => branchAt(s, dir)), ["ramon/con-commits", "ramon/publicada", "ramon/con-cambios"]);
});

test("--adopt resumes the issue's branch with commits, and untracked files do not stop it", () => {
  const s = startSandbox();
  const resumed = toolWorktree(s, "ramon/214-con-commits");
  s.git(resumed, "commit", "-q", "--allow-empty", "-m", "earlier work");
  const loose = toolWorktree(s, "ramon/con-sueltos");
  writeFileSync(join(loose, "loose.txt"), "x\n");

  const first = s.run(["214", "--adopt"], { cwd: resumed });
  const second = startSandbox();
  const looseOnly = toolWorktree(second, "ramon/con-sueltos");
  writeFileSync(join(looseOnly, "loose.txt"), "x\n");
  const looseRun = second.run(["214", "--adopt"], { cwd: looseOnly });

  assert.equal(first.status, 0, first.err);
  assert.equal(branchAt(s, resumed), "ramon/214-con-commits");
  assert.equal(created(s)[0].body.head, "ramon/214-con-commits");
  assert.equal(looseRun.status, 0, looseRun.err);
  assert.equal(branchAt(second, looseOnly), BRANCH);
});

test("--adopt with staged changes makes an empty start commit and leaves them staged", () => {
  const s = startSandbox();
  const dir = toolWorktree(s, BRANCH);
  writeFileSync(join(dir, ".gitignore"), "staged\n");
  s.git(dir, "add", ".gitignore");

  const r = s.run(["214", "--adopt"], { cwd: dir });

  assert.equal(r.status, 0, r.err);
  assert.equal(s.git(dir, "show", "--format=", "--name-only", "HEAD"), "");
  assert.equal(s.git(dir, "diff", "--cached", "--name-only"), ".gitignore");
});

test("--adopt stops in the main checkout and on a detached HEAD", () => {
  const s = startSandbox();
  const dir = toolWorktree(s, "ramon/suelta");
  s.git(dir, "checkout", "-q", "--detach");

  const main = s.run(["214", "--adopt"]);
  const detached = s.run(["214", "--adopt"], { cwd: dir });

  assert.equal(main.status, 1);
  assert.match(main.err, /--adopt runs inside a worktree, not in the main checkout/);
  assert.equal(detached.status, 1);
  assert.match(detached.err, /is not on a branch; not adopting it/);
});

test("--adopt --dry-run shows the rename and does not do it", () => {
  const s = startSandbox();
  const dir = toolWorktree(s, "ramon/ensayo");

  const r = s.run(["214", "--adopt", "--dry-run"], { cwd: dir });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /rename the branch ramon\/ensayo to feat\/214-odoo-refund-notice/);
  assert.equal(branchAt(s, dir), "ramon/ensayo");
  assert.deepEqual(s.writes(), []);
});

test("--adopt of a new branch with the number while the issue goes on in another: its PR is Part of", () => {
  const s = startSandbox();
  s.pushBranch(BRANCH);
  s.pull({ number: 210, branch: BRANCH, body: "Closes #214" });
  const dir = toolWorktree(s, `${BRANCH}-2`);

  const r = s.run(["214", "--adopt"], { cwd: dir });

  assert.equal(r.status, 0, r.err);
  assert.equal(branchAt(s, dir), `${BRANCH}-2`);
  assert.equal(created(s)[0].body.head, `${BRANCH}-2`);
  assert.match(created(s)[0].body.body, /^Part of #214/);
});

test("--cloud opens the cloud session from the main checkout and creates nothing here", () => {
  const s = startSandbox();
  const head = s.git(s.main, "rev-parse", "HEAD");

  const r = s.run(["214", "--cloud"], { input: "y\n" });

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(s.claudeCalls().map((call) => [call.args, call.cwd]), [[["--cloud", "/start-issue 214 --yes"], s.main]]);
  assert.match(r.out, /Mode: {9}cloud \(the session makes the branch and the PR\)/);
  assert.doesNotMatch(r.out, /Session:/);
  assert.match(r.out, /To bring it here: issue-flow issue start 214 --teleport/);
  assert.deepEqual(s.writes(), []);
  assert.equal(s.git(s.origin, "branch", "--list", "feat/*"), "");
  assert.equal(existsSync(join(s.main, WT)), false);
  assert.equal(s.git(s.main, "rev-parse", "HEAD"), head);
});

test("--cloud: no opens nothing, and without claude it says how to open it", () => {
  const s = startSandbox();

  const no = s.run(["214", "--cloud"], { input: "n\n" });
  const noLaunch = s.run(["214", "--cloud", "--yes", "--no-launch"]);
  const noLaunchCalls = s.claudeCalls();
  const noClaude = s.run(["214", "--cloud", "--yes"], { withoutClaude: true });

  assert.equal(no.status, 1);
  assert.deepEqual(s.claudeCalls(), []);
  assert.match(noLaunch.out, /To open the cloud session/);
  assert.deepEqual(noLaunchCalls, []);
  assert.equal(noClaude.status, 0, noClaude.err);
  assert.match(noClaude.out, /To open the cloud session: issue-flow issue start 214 --cloud/);
});

test("--cloud leaves a main checkout on another branch and dirty alone, with a warning", () => {
  const s = startSandbox();
  s.git(s.main, "checkout", "-q", "-b", "other");
  writeFileSync(join(s.main, "dirty.txt"), "dirty\n");

  const r = s.run(["214", "--cloud", "--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.equal(branchAt(s, s.main), "other");
  assert.match(r.err, /the main checkout is not on main: the session clones its current branch/);
  assert.equal(s.claudeCalls().length, 1);
});

test("--cloud stops if the branch is checked out or only local, and a failed session exits 1", () => {
  const s = startSandbox();
  s.git(s.main, "worktree", "add", "-q", join(s.main, WT), "-b", BRANCH, "origin/main");
  const local = startSandbox();
  local.git(local.main, "branch", BRANCH, "origin/main");
  local.git(local.main, "checkout", "-q", BRANCH);
  local.git(local.main, "commit", "-q", "--allow-empty", "-m", "local");
  local.git(local.main, "checkout", "-q", "main");
  const failing = startSandbox();

  const checkedOut = s.run(["214", "--cloud", "--yes"]);
  const onlyLocal = local.run(["214", "--cloud", "--yes"]);
  const failed = failing.run(["214", "--cloud", "--yes"], { env: { FAKE_CLAUDE_EXIT: "1" } });

  assert.equal(checkedOut.status, 1);
  assert.match(checkedOut.err, /is already at .*without --cloud/);
  assert.deepEqual(s.claudeCalls(), []);
  assert.equal(onlyLocal.status, 1);
  assert.match(onlyLocal.err, /is only local: push it or go on without --cloud/);
  assert.equal(failed.status, 1);
  assert.match(failed.err, /could not open the cloud session/);
});

test("--cloud with several branches passes the chosen one, or --new, to the session", () => {
  const s = startSandbox();
  s.pushBranch(BRANCH);
  s.pushBranch("fix/214-old");
  s.pull({ number: 210, branch: BRANCH, body: "Closes #214" });
  s.pull({ number: 150, branch: "fix/214-old", body: "Closes #214" });
  const prompt = (args, input = "") => {
    const r = s.run(["214", "--cloud", ...args], { input });
    return r.status === 0 ? s.claudeCalls()[0].args[1] : r.err;
  };

  const yes = s.run(["214", "--cloud", "--yes"]);
  const yesCalls = s.claudeCalls();
  const resumed = prompt(["--yes", "--resume", "fix/214-old"]);
  const picked = prompt([], "2\ny\n");
  const another = prompt([], "n\ny\n");
  const fresh = prompt(["--yes", "--new"]);

  assert.equal(yes.status, 1);
  assert.match(yes.err, /choose with --resume <branch> or --new/);
  assert.deepEqual(yesCalls, []);
  assert.equal(resumed, "/start-issue 214 --yes --resume fix/214-old");
  assert.equal(picked, "/start-issue 214 --yes --resume fix/214-old");
  assert.equal(another, "/start-issue 214 --yes --new");
  assert.equal(fresh, "/start-issue 214 --yes --new");
});

test("--cloud with one live branch passes --new only when asked", () => {
  const s = startSandbox();
  s.pushBranch(BRANCH);
  s.pull({ number: 210, branch: BRANCH, body: "Closes #214" });

  const plain = s.run(["214", "--cloud", "--yes"]);
  const plainArgs = s.claudeCalls()[0].args;
  const fresh = s.run(["214", "--cloud", "--yes", "--new"]);

  assert.equal(plain.status, 0, plain.err);
  assert.deepEqual(plainArgs, ["--cloud", "/start-issue 214 --yes"]);
  assert.equal(fresh.status, 0, fresh.err);
  assert.deepEqual(s.claudeCalls()[0].args, ["--cloud", "/start-issue 214 --yes --new"]);
});

test("resuming without --teleport opens the local session and tells how to bring the cloud one", () => {
  const s = startSandbox();
  s.run(["214", "--yes", "--no-launch"]);
  s.world.pulls[0].body = `Closes #214\n\n${NOTE}`;

  const r = s.run(["214", "--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Cloud: {8}the issue has a cloud session \(https:\/\/claude\.ai\/code\/session_01TEST\)\. To bring it: issue-flow issue start 214 --teleport/);
  const session = s.claudeCalls().find((call) => !call.args.includes("-p"));
  assert.equal(session.cwd, join(s.main, WT));
  assert.ok(session.args.includes("--resume"));
  assert.ok(!session.args.includes("--teleport"));
});

test("--teleport brings the session noted in the PR to the worktree, with the permission mode", () => {
  const s = startSandbox();
  s.run(["214", "--yes", "--no-launch"]);
  s.world.pulls[0].body = `Closes #214\n\n${NOTE}`;

  const r = s.run(["214", "--teleport", "--yes", "--free"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Session: {6}cloud session_01TEST \(brought with teleport\)/);
  assert.match(r.out, /To resume it later: claude --resume/);
  assert.deepEqual(s.claudeCalls().map((call) => [call.args, call.cwd]), [
    [["--settings", '{"sandbox":{"enabled":false}}', "--dangerously-skip-permissions", "--teleport", "session_01TEST"], join(s.main, WT)],
  ]);
});

test("--teleport without a session in the PR opens the list, and without a branch stops", () => {
  const s = startSandbox();
  s.run(["214", "--yes", "--no-launch"]);
  const none = startSandbox();

  const list = s.run(["214", "--teleport", "--yes"]);
  const noBranch = none.run(["214", "--teleport", "--yes"]);

  assert.equal(list.status, 0, list.err);
  assert.match(list.out, /Session: {6}cloud \(chosen from teleport's list\)/);
  assert.deepEqual(s.claudeCalls()[0].args, ["--teleport"]);
  assert.equal(noBranch.status, 1);
  assert.match(noBranch.err, /issue #214 has no branch: start it with 'issue-flow issue start 214 --cloud'/);
});

test("--here starts the issue in this checkout, notes the cloud session in the PR and prints the prompt", () => {
  const s = startSandbox();

  const r = s.run(["214", "--here"], { input: "y\n", env: SESSION_ENV });

  assert.equal(r.status, 0, r.err);
  assert.equal(branchAt(s, s.main), BRANCH);
  assert.equal(s.git(s.origin, "log", "-1", "--format=%s", BRANCH), "chore: empieza el trabajo en la issue #214 [skip ci]");
  assert.equal(s.git(s.main, "rev-parse", "--abbrev-ref", "@{u}"), `origin/${BRANCH}`);
  assert.equal(created(s)[0].body.draft, true);
  assert.equal(s.world.pulls[0].body, `Closes #214\n\nIssue: https://github.com/acme/widgets/issues/214\n\nEn progreso.\n\n${NOTE}`);
  assert.match(r.out, /Mode: {9}this session \(--here\)/);
  assert.match(r.out, /note the session in the PR/);
  assert.match(r.out, /\nPrompt: Issue #214\. Lee la issue/);
  assert.deepEqual(s.claudeCalls(), []);
  assert.equal(existsSync(join(s.main, WT)), false);
});

test("--here again in the same session adds no PR and does not touch the body", () => {
  const s = startSandbox();
  s.run(["214", "--here", "--yes"], { env: SESSION_ENV });
  s.git(s.main, "checkout", "-q", "main");
  s.git(s.main, "branch", "-q", "-D", BRANCH);
  const body = s.world.pulls[0].body;

  const r = s.run(["214", "--here", "--yes"], { env: SESSION_ENV });

  assert.equal(r.status, 0, r.err);
  assert.equal(branchAt(s, s.main), BRANCH);
  assert.equal(s.git(s.main, "rev-parse", "HEAD"), s.git(s.origin, "rev-parse", BRANCH));
  assert.deepEqual(s.writes(), []);
  assert.equal(s.world.pulls[0].body, body);
  assert.doesNotMatch(r.out, /note the session in the PR/);
});

test("--here in another session replaces the link, keeping one line and the rest of the body", () => {
  const s = startSandbox();
  s.run(["214", "--here", "--yes"], { env: SESSION_ENV });

  const r = s.run(["214", "--here", "--yes"], { env: { CLAUDE_CODE_REMOTE_SESSION_ID: "cse_02OTHER" } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /note the session in the PR/);
  assert.equal(s.world.pulls[0].body, "Closes #214\n\nIssue: https://github.com/acme/widgets/issues/214\n\nEn progreso.\n\nCloud session: https://claude.ai/code/session_02OTHER");
});

test("--here resumes from a clone of one branch, like the cloud's", () => {
  const s = startSandbox();
  const tip = s.pushBranch(BRANCH, { commit: true });
  s.pull({ number: 210, branch: BRANCH, body: "Closes #214", sha: tip });
  s.git(s.main, "push", "-q", "origin", "main:claude/start-x");
  s.git(s.main, "commit", "-q", "--allow-empty", "-m", "main moved on");
  s.git(s.main, "push", "-q", "origin", "main");
  const clone = join(s.tmp, "cloud");
  s.git(s.tmp, "clone", "-q", "--single-branch", "--branch", "claude/start-x", s.origin, clone);
  s.git(clone, "remote", "set-url", "origin", URL);
  s.git(clone, "config", `url.${s.origin}.insteadOf`, URL);

  const r = s.run(["214", "--here", "--yes"], { cwd: clone });

  assert.equal(r.status, 0, r.err);
  assert.equal(branchAt(s, clone), BRANCH);
  assert.equal(s.git(clone, "rev-parse", "HEAD"), tip);
  assert.equal(s.git(clone, "rev-parse", "origin/main"), s.git(s.main, "rev-parse", "main"));
  assert.deepEqual(created(s), []);
});

test("--here outside a cloud session does not touch the PR body", () => {
  const s = startSandbox();

  const r = s.run(["214", "--here", "--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(edited(s), []);
  assert.doesNotMatch(r.out, /note the session/);
});

test("--here stops with uncommitted changes, without moving HEAD nor pushing", () => {
  const s = startSandbox();
  writeFileSync(join(s.main, ".gitignore"), "dirty\n");
  const head = s.git(s.main, "rev-parse", "HEAD");

  const r = s.run(["214", "--here", "--yes"]);

  assert.equal(r.status, 1);
  assert.match(r.err, /this checkout has uncommitted changes/);
  assert.equal(s.git(s.main, "rev-parse", "HEAD"), head);
  assert.equal(branchAt(s, s.main), "main");
  assert.equal(s.git(s.origin, "branch", "--list", "feat/*"), "");
});

test("--here never overwrites a local branch with commits origin lacks", () => {
  const s = startSandbox();
  s.run(["214", "--here", "--yes"]);
  s.git(s.main, "commit", "-q", "--allow-empty", "-m", "local work not pushed");
  const local = s.git(s.main, "rev-parse", "HEAD");
  const remote = s.git(s.origin, "rev-parse", BRANCH);
  s.git(s.main, "checkout", "-q", "--detach");

  const r = s.run(["214", "--here", "--yes"]);

  assert.equal(r.status, 1);
  assert.match(r.err, /has commits that are not in origin/);
  assert.equal(s.git(s.main, "rev-parse", BRANCH), local);
  assert.equal(s.git(s.origin, "rev-parse", BRANCH), remote);
});

test("--here goes on with untracked files, which the cloud's hook leaves", () => {
  const s = startSandbox();
  writeFileSync(join(s.main, "loose.txt"), "x\n");

  const r = s.run(["214", "--here", "--yes"]);

  assert.equal(r.status, 0, r.err);
  assert.equal(branchAt(s, s.main), BRANCH);
});

test("--here stops if the issue's branch is only local, from another checkout", () => {
  const s = startSandbox();
  s.git(s.main, "branch", BRANCH, "origin/main");

  const r = s.run(["214", "--here", "--yes"]);

  assert.equal(r.status, 1);
  assert.match(r.err, /is only local \(on another machine or checkout\): push it from there/);
  assert.equal(branchAt(s, s.main), "main");
});

test("--here stops if the branch is in another worktree", () => {
  const s = startSandbox();
  const other = join(s.main, WT);
  s.git(s.main, "worktree", "add", "-q", other, "-b", BRANCH, "origin/main");

  const r = s.run(["214", "--here", "--yes"]);

  assert.equal(r.status, 1);
  assert.ok(r.err.includes(`branch ${BRANCH} is already at ${other}:`), r.err);
  assert.equal(branchAt(s, s.main), "main");
});

test("--here with several branches: --yes asks to choose, --resume takes one, --new makes another", () => {
  const s = startSandbox();
  s.pushBranch(BRANCH);
  s.pushBranch("fix/214-old");
  s.pull({ number: 210, branch: BRANCH, body: "Closes #214" });
  s.pull({ number: 150, branch: "fix/214-old", body: "Closes #214" });

  const yes = s.run(["214", "--here", "--yes"]);
  const yesAt = branchAt(s, s.main);
  const resumed = s.run(["214", "--here", "--yes", "--resume", "fix/214-old"]);
  const resumedAt = branchAt(s, s.main);
  const resumedPrs = created(s);
  s.git(s.main, "checkout", "-q", "main");
  const fresh = s.run(["214", "--here", "--yes", "--new"]);

  assert.equal(yes.status, 1);
  assert.match(yes.err, /choose with --resume <branch> or --new/);
  assert.equal(yesAt, "main");
  assert.equal(resumed.status, 0, resumed.err);
  assert.equal(resumedAt, "fix/214-old");
  assert.deepEqual(resumedPrs, []);
  assert.equal(fresh.status, 0, fresh.err);
  assert.equal(branchAt(s, s.main), `${BRANCH}-2`);
  assert.match(created(s)[0].body.body, /^Part of #214/);
});

test("--here --dry-run shows the summary and changes nothing", () => {
  const s = startSandbox();

  const r = s.run(["214", "--here", "--dry-run"], { env: SESSION_ENV });

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Mode: {9}this session \(--here\)/);
  assert.match(r.out, /note the session in the PR/);
  assert.equal(branchAt(s, s.main), "main");
  assert.deepEqual(s.writes(), []);
  assert.equal(s.git(s.origin, "branch", "--list", "feat/*"), "");
});

test("--cloud never puts a branch with shell characters in the session's prompt", () => {
  const s = startSandbox();
  const odd = "fix/214-a$(touch-x)";
  s.pushBranch(BRANCH);
  s.pushBranch(odd);
  s.pull({ number: 210, branch: BRANCH, body: "Closes #214" });
  s.pull({ number: 150, branch: odd, body: "Closes #214" });

  const r = s.run(["214", "--cloud", "--yes", "--resume", odd]);

  assert.equal(r.status, 1);
  assert.match(r.err, /has characters the cloud session's prompt cannot carry/);
  assert.deepEqual(s.claudeCalls(), []);
});
