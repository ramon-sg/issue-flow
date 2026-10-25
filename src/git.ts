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
interface WorktreeEntry {
  path: string;
  branch: string | null;
  lock: string | null;
}

/**
 * The worktrees of the repo, the main checkout first.
 * @param cwd - Any checkout of the repo.
 * @returns Path, branch and lock reason of each.
 */
function worktrees(cwd: string): WorktreeEntry[] {
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
 * any worktree.
 * @param cwd - A directory inside the repo.
 * @returns The common git dir and the main checkout, or null outside git.
 * @example locateRepo(process.cwd())?.mainRoot
 */
export function locateRepo(cwd: string): { commonDir: string; mainRoot: string } | null {
  const result = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!result.ok) return null;
  const commonDir = real(result.out);
  return { commonDir, mainRoot: dirname(commonDir) };
}
