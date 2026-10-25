/**
 * @file Locks the worktree while Claude runs (`git worktree lock`), so cleaning worktrees
 * from another terminal does not delete one in use. The reason starts like the one of
 * `claude --worktree`, so tools that respect it respect this one too, and ends with the
 * pid: a lock left by a process that died is taken over. Ported from `lock_worktree` in
 * Abastio's `scripts/start-issue.sh`.
 */
import { git, worktreeLock } from "./git.js";

/** Start of the lock reason. */
export const LOCK_REASON = "claude session issue-flow";

/** How the lock went. */
export interface Lock {
  mine: boolean;
  shared: boolean;
}

/**
 * Whether a process is alive.
 * @param pid - The pid.
 * @returns True if it is (or it cannot be told: another user's).
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Whether a lock is from an `issue-flow` whose process is gone (a `kill -9`).
 * @param reason - The lock reason.
 * @returns True if it is stale.
 * @example isStale("claude session issue-flow 99999999") // true
 */
export function isStale(reason: string): boolean {
  if (!reason.startsWith(`${LOCK_REASON} `)) return false;
  const pid = reason.slice(LOCK_REASON.length + 1);
  return /^\d+$/.test(pid) && !alive(Number(pid));
}

/**
 * Locks the worktree. A stale lock of `issue-flow` is taken over; any other lock is left
 * alone, and then the session counts as shared, so nothing offers to delete the worktree.
 * @param mainRoot - The main checkout.
 * @param workDir - The worktree.
 * @param say - Where to say what happened.
 * @returns Whether this process holds the lock and whether another session does.
 * @example lockWorktree(root, wt, console.error)
 */
export function lockWorktree(mainRoot: string, workDir: string, say: (text: string) => void): Lock {
  const reason = worktreeLock(mainRoot, workDir);
  if (reason !== null && isStale(reason)) {
    say(`Taking over the lock of a session that is gone (${reason}).`);
    git(mainRoot, ["worktree", "unlock", workDir]);
  }
  if (git(mainRoot, ["worktree", "lock", "--reason", `${LOCK_REASON} ${process.pid}`, workDir]).ok)
    return { mine: true, shared: false };
  say("the worktree is already locked (is another session open?); going on without locking it.");
  return { mine: false, shared: true };
}

/**
 * Unlocks the worktree if this process locked it.
 * @param mainRoot - The main checkout.
 * @param workDir - The worktree.
 * @param lock - The lock.
 * @example unlockWorktree(root, wt, lock)
 */
export function unlockWorktree(mainRoot: string, workDir: string, lock: Lock): void {
  if (!lock.mine) return;
  git(mainRoot, ["worktree", "unlock", workDir]);
  lock.mine = false;
}
