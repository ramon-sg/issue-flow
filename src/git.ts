/**
 * @file Small git queries over `spawnSync`, for starting an issue: refs, commits that are
 * not in the base, where a branch is checked out and worktree locks.
 */
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname } from "node:path";

/** What a git command gave. */
export interface GitResult {
  ok: boolean;
  out: string;
  err: string;
}

/**
 * Runs git and returns whether it worked, with its output trimmed at the end.
 * @param cwd - Where to run it.
 * @param args - The arguments.
 * @returns The result.
 * @example git("/repo", ["rev-parse", "HEAD"]).out
 */
export function git(cwd: string, args: string[]): GitResult {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    ok: run.status === 0,
    out: (run.stdout ?? "").trimEnd(),
    err: (run.stderr ?? "").trim(),
  };
}

/**
 * The non-empty lines of a git command's output (none if it failed).
 * @param cwd - Where to run it.
 * @param args - The arguments.
 * @returns The lines.
 * @example gitLines("/repo", ["branch", "--format=%(refname:short)"])
 */
export function gitLines(cwd: string, args: string[]): string[] {
  const result = git(cwd, args);
  return result.ok ? result.out.split("\n").filter((line) => line !== "") : [];
}

/**
 * Whether a ref exists.
 * @param cwd - The checkout.
 * @param ref - The full ref (`refs/heads/x`).
 * @returns True if it does.
 * @example hasRef("/repo", "refs/heads/main")
 */
export function hasRef(cwd: string, ref: string): boolean {
  return git(cwd, ["rev-parse", "-q", "--verify", ref]).ok;
}

/**
 * Makes a branch track origin's of the same name, unless it already does. The upstream lives
 * in `.git/config`, which Claude Code's sandbox forbids writing, so this is the only step that
 * writes it: branches are made with `--no-track` and pushed without `-u`.
 * @param cwd - The checkout.
 * @param branch - The branch.
 * @returns True if it tracks `origin/<branch>` now; false if git could not write it.
 * @example trackOrigin("/repo", "feat/42-x")
 */
export function trackOrigin(cwd: string, branch: string): boolean {
  const upstream = git(cwd, ["rev-parse", "-q", "--symbolic-full-name", `${branch}@{u}`]);
  if (upstream.ok && upstream.out === `refs/remotes/origin/${branch}`) return true;
  return git(cwd, ["branch", "-q", `--set-upstream-to=origin/${branch}`, branch]).ok;
}

/**
 * The warning when a branch cannot track origin's.
 * @param branch - The branch.
 * @returns The warning.
 */
export function untracked(branch: string): string {
  return `could not make ${branch} track origin/${branch} (is .git/config read-only, as in a sandbox?); push with 'git push origin HEAD'.`;
}

/**
 * Whether the branch exists locally.
 * @param cwd - The checkout.
 * @param branch - The branch.
 * @returns True if it does.
 * @example hasLocal("/repo", "feat/42-x")
 */
export const hasLocal = (cwd: string, branch: string): boolean =>
  hasRef(cwd, `refs/heads/${branch}`);

/**
 * Whether the branch exists in origin, as of the last fetch.
 * @param cwd - The checkout.
 * @param branch - The branch.
 * @returns True if it does.
 * @example onOrigin("/repo", "feat/42-x")
 */
export const onOrigin = (cwd: string, branch: string): boolean =>
  hasRef(cwd, `refs/remotes/origin/${branch}`);

/**
 * Commits of the branch (local, or else in origin) that are not in `origin/<base>`.
 * @param cwd - The checkout.
 * @param branch - The branch.
 * @param base - The base branch.
 * @returns How many, 0 if the branch does not exist.
 * @example ownCommits("/repo", "feat/42-x", "main") // 0
 */
export function ownCommits(cwd: string, branch: string, base: string): number {
  const ref = hasLocal(cwd, branch) ? branch : `origin/${branch}`;
  const result = git(cwd, ["rev-list", "--count", `origin/${base}..${ref}`]);
  return result.ok ? Number(result.out) : 0;
}

/**
 * A path with its symlinks resolved, so paths from git and from the system compare
 * equal (on macOS `/var` is `/private/var`).
 * @param path - The path.
 * @returns The real path, or the path itself if it does not exist.
 */
function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** A worktree as `git worktree list --porcelain` gives it. */
export interface WorktreeEntry {
  path: string;
  branch: string | null;
  lock: string | null;
}

/**
 * The worktrees of the repo, the main checkout first.
 * @param cwd - Any checkout of the repo.
 * @returns Path, branch and lock reason of each.
 * @example worktrees("/repo")[0].path // "/repo"
 */
export function worktrees(cwd: string): WorktreeEntry[] {
  const found: WorktreeEntry[] = [];
  for (const line of git(cwd, ["worktree", "list", "--porcelain"]).out.split("\n")) {
    if (line.startsWith("worktree ")) found.push({ path: real(line.slice(9)), branch: null, lock: null });
    const current = found.at(-1);
    if (current === undefined) continue;
    if (line.startsWith("branch refs/heads/")) current.branch = line.slice(18);
    if (line === "locked") current.lock = "";
    if (line.startsWith("locked ")) current.lock = line.slice(7);
  }
  return found;
}

/**
 * Where the branch is checked out: the main checkout or a worktree.
 * @param cwd - Any checkout of the repo.
 * @param branch - The branch.
 * @returns The path, or null if it is not checked out.
 * @example checkedOutAt("/repo", "feat/42-x")
 */
export function checkedOutAt(cwd: string, branch: string): string | null {
  return worktrees(cwd).find((entry) => entry.branch === branch)?.path ?? null;
}

/**
 * Why the worktree is locked.
 * @param cwd - Any checkout of the repo.
 * @param path - The worktree.
 * @returns The reason (empty if it has none), or null if it is not locked.
 * @example worktreeLock("/repo", "/repo/.claude/worktrees/feat+42-x")
 */
export function worktreeLock(cwd: string, path: string): string | null {
  return worktrees(cwd).find((entry) => entry.path === real(path))?.lock ?? null;
}

/**
 * Whether the checkout has no changes. Untracked files count unless told otherwise.
 * @param cwd - The checkout.
 * @param untracked - Whether untracked files count.
 * @returns True if it is clean.
 * @example isClean("/repo")
 */
export function isClean(cwd: string, untracked = true): boolean {
  const args = ["status", "--porcelain", ...(untracked ? [] : ["--untracked-files=no"])];
  const result = git(cwd, args);
  return result.ok && result.out === "";
}

/**
 * The branch the checkout is on.
 * @param cwd - The checkout.
 * @returns The branch, or null on a detached HEAD.
 * @example currentBranch("/repo") // "main"
 */
export function currentBranch(cwd: string): string | null {
  const result = git(cwd, ["symbolic-ref", "-q", "--short", "HEAD"]);
  return result.ok ? result.out : null;
}

/**
 * Where a directory's repo lives: its shared `.git` and the main checkout, the same from
 * any worktree. The main checkout is the first one git lists, which also holds in a
 * submodule or with `--separate-git-dir`, where the shared `.git` is not inside it.
 * @param cwd - A directory inside the repo.
 * @returns The common git dir and the main checkout, or null outside git.
 * @example locateRepo(process.cwd())?.mainRoot
 */
export function locateRepo(cwd: string): { commonDir: string; mainRoot: string } | null {
  const result = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!result.ok) return null;
  const commonDir = real(result.out);
  return { commonDir, mainRoot: worktrees(cwd)[0]?.path ?? dirname(commonDir) };
}

/**
 * The root of the checkout a directory is in (the main one or a worktree), with its
 * symlinks resolved like the other paths here.
 * @param cwd - A directory inside the checkout.
 * @returns The root, or null outside git.
 * @example checkoutRoot("/repo/.claude/worktrees/feat+42-x/src") // "/repo/.claude/worktrees/feat+42-x"
 */
export function checkoutRoot(cwd: string): string | null {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  return result.ok ? real(result.out) : null;
}

/**
 * Whether deleting the branch loses no work: all its commits are in some branch of
 * origin, or it does not go past the PR's head (the branch already deleted on GitHub, or
 * a squash merge).
 * @param cwd - The checkout.
 * @param branch - The branch.
 * @param head - The merged PR's head.
 * @returns True if it is safe.
 * @example safeToDelete("/repo", "feat/42-x", "")
 */
export function safeToDelete(cwd: string, branch: string, head: string): boolean {
  if (git(cwd, ["rev-list", "--count", branch, "--not", "--remotes=origin"]).out === "0") return true;
  return head !== "" && git(cwd, ["merge-base", "--is-ancestor", branch, head]).ok;
}

/**
 * Brings `origin/<base>` and moves the local base forward to it, if nothing is lost. A base
 * not checked out anywhere moves as a ref only; one checked out is merged there with
 * `--ff-only`, and only if that checkout has no changes. A base with commits that are not in
 * origin is left alone.
 * @param mainRoot - The main checkout.
 * @param base - The base branch.
 * @returns Null if it is up to date now (or there is no local base); else why it was not
 *   moved.
 * @example updateBase("/repo", "main") // null
 */
export function updateBase(mainRoot: string, base: string): string | null {
  const remote = `refs/remotes/origin/${base}`;
  const local = `refs/heads/${base}`;
  if (!git(mainRoot, ["fetch", "-q", "origin", `+refs/heads/${base}:${remote}`]).ok)
    return `could not fetch ${base} from origin; local ${base} was not updated.`;
  if (!hasRef(mainRoot, local)) return null;
  const from = git(mainRoot, ["rev-parse", local]).out;
  const to = git(mainRoot, ["rev-parse", remote]).out;
  if (from === to) return null;
  if (!git(mainRoot, ["merge-base", "--is-ancestor", local, remote]).ok)
    return `local ${base} has commits that are not in origin/${base}; it was not updated.`;
  const at = checkedOutAt(mainRoot, base);
  if (at === null)
    return git(mainRoot, ["update-ref", local, to, from]).ok ? null : `could not move local ${base} to origin/${base}.`;
  if (!isClean(at, false)) return `${base} is checked out in ${at} with changes; it was not updated. Run 'git pull --ff-only' there.`;
  return git(at, ["merge", "-q", "--ff-only", remote]).ok ? null : `could not update ${base} in ${at}; run 'git pull --ff-only' there.`;
}
