/**
 * @file `issue-flow worktree …`: the life of a worktree after `issue start` made it.
 * `setup` and `teardown` run the steps of the config, `ports` shows or moves its block of
 * ports, `cleanup` deletes the Docker of worktrees that are gone, and `prune` deletes the
 * worktrees whose PR was merged or closed. Ported from Abastio's `scripts/worktree.sh`,
 * `worktree-prune.sh` and `worktree-cleanup.sh`.
 */
import { findPr } from "@ramon-sg/github-rest";
import { confirm } from "../ask.js";
import type { FlowConfig } from "../config.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalPath, dockerCleanup } from "../docker.js";
import { checkoutRoot, git, isClean, locateRepo, safeToDelete, type WorktreeEntry, worktrees } from "../git.js";
import { forgetSession } from "../launch.js";
import { type Output, UsageError, warn } from "../output.js";
import { claimPortBase, nextPortBase, portBase } from "../ports.js";
import { isStale, LOCK_REASON } from "../session-lock.js";
import { StartError } from "../start-state.js";
import { runSetup, type StepPlace, teardownWorktree } from "../worktree-steps.js";

/** The reason `claude --worktree` locks the worktrees it makes while its session lives. */
const CLAUDE_LOCK_REASON = "claude session";

/** Options of `issue-flow worktree`. */
export interface WorktreeOptions {
  repo: string | null;
  config: FlowConfig;
  cwd: string;
  yes: boolean;
  only: string | null;
  path: string | null;
  next: boolean;
}

/**
 * The base branch: the config's, or origin's default as git knows it, or `main`.
 * @param config - The config.
 * @param mainRoot - The main checkout.
 * @returns The branch.
 * @example baseBranch(config, "/repo") // "main"
 */
export function baseBranch(config: FlowConfig, mainRoot: string): string {
  if (config.baseBranch !== null) return config.baseBranch;
  const head = git(mainRoot, ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]);
  return head.ok && head.out.startsWith("origin/") ? head.out.slice("origin/".length) : "main";
}

/**
 * Where the steps of the checkout `cwd` is in run.
 * @param options - The options.
 * @param out - Where to write.
 * @returns The place.
 * @throws StartError outside git.
 * @example placeOf(options, out).root
 */
export function stepPlace(options: Pick<WorktreeOptions, "config" | "cwd">, out: Output): StepPlace {
  const located = locateRepo(options.cwd);
  const root = checkoutRoot(options.cwd);
  if (located === null || root === null) throw new StartError("run this inside a checkout of the repo.");
  const { mainRoot } = located;
  return { root, mainRoot, base: baseBranch(options.config, mainRoot), config: options.config, out, remote: process.env.CLAUDE_CODE_REMOTE === "true" };
}

/**
 * `worktree setup [--only <step>]`: prepares this worktree.
 * @param options - The options.
 * @param out - Where to write.
 * @returns 0, or 1 if a step failed.
 * @throws UsageError if `--only` names no step.
 * @example await worktreeSetup(options, out)
 */
export async function worktreeSetup(options: WorktreeOptions, out: Output): Promise<number> {
  const names = options.config.worktrees.setup.map((step) => step.name);
  if (options.only !== null && !names.includes(options.only))
    throw new UsageError(`--only expects a setup step of .agents/flow.json (${names.join(", ") || "it has none"}): ${options.only}`);
  return (await runSetup(stepPlace(options, out), options.only)) ? 0 : 1;
}

/**
 * `worktree teardown [--path <dir>]`: cleans a worktree before deleting it (its steps, its
 * ports and its Docker). With `--path` the folder may be gone already; if it is there, it
 * must be one of the repo's worktrees. Never the main checkout, by any path to it.
 * @param options - The options.
 * @param out - Where to write.
 * @returns 0, or 1 if something could not be cleaned.
 * @throws StartError for the main checkout or a folder that is not a worktree.
 * @example worktreeTeardown(options, out)
 */
export function worktreeTeardown(options: WorktreeOptions, out: Output): number {
  const place = stepPlace(options, out);
  const root = options.path === null ? place.root : canonicalPath(resolve(options.cwd, options.path));
  if (root === place.mainRoot) throw new StartError("teardown is for worktrees, not the main checkout.");
  if (existsSync(root) && !worktrees(place.mainRoot).some((entry) => entry.path === root))
    throw new StartError(`${root} is not a worktree of this repo.`);
  return teardownWorktree({ ...place, root }) ? 0 : 1;
}

/**
 * `worktree ports [--next]`: prints the first port of this worktree's block, fixing it if
 * it was not yet; with `--next`, moves it to the next free block.
 * @param options - The options.
 * @param out - Where to write.
 * @returns The exit code.
 * @throws StartError without ports in the config, in the main checkout, or with no free block.
 * @example await worktreePorts(options, out)
 */
export async function worktreePorts(options: WorktreeOptions, out: Output): Promise<number> {
  const ports = options.config.worktrees.ports;
  if (ports === null) throw new StartError('this repo has no ports for worktrees: add "worktrees.ports" to .agents/flow.json.');
  const place = stepPlace(options, out);
  if (place.root === place.mainRoot) throw new StartError("ports are for worktrees, not the main checkout.");
  const start = options.next ? nextPortBase(ports, portBase(ports, place.root)) : null;
  const base = await claimPortBase(ports, place.root, start);
  if (base === null) throw new StartError("no block of ports is free on this machine; delete worktrees you no longer use.");
  if (options.next) warn(out, `the worktree moves to block ${base}: restart what runs in it.`);
  out.stdout(`${base}\n`);
  return 0;
}

/**
 * `worktree cleanup [--path <dir>]`: deletes the Docker of worktrees that are gone, or of
 * one folder.
 * @param options - The options.
 * @param out - Where to write.
 * @returns 0, or 1 if a project could not be deleted.
 * @example worktreeCleanup(options, out)
 */
export function worktreeCleanup(options: WorktreeOptions, out: Output): number {
  const result = dockerCleanup(options.config.worktrees.dockerProjects, options.path);
  if (!result.dockerRunning) {
    warn(out, "Docker is not running; nothing was cleaned. Start it and run 'issue-flow worktree cleanup'.");
    return 0;
  }
  for (const project of result.removed) out.stdout(`deleted: ${project}\n`);
  for (const project of result.failed) warn(out, `could not delete ${project}; see what holds it with 'docker ps -a --filter label=com.docker.compose.project=${project}'.`);
  return result.failed.length === 0 ? 0 : 1;
}

/**
 * Why `prune` leaves a locked worktree alone, or null if it is not locked.
 * @param entry - The worktree.
 * @returns The message, or null.
 */
function lockedReason(entry: WorktreeEntry): string | null {
  const { lock, path } = entry;
  if (lock === null) return null;
  if (lock.startsWith(`${LOCK_REASON} `))
    return isStale(lock)
      ? `locked by an issue-flow session that is gone, not touched: ${path} (free it with: git worktree unlock ${path})`
      : `in use by a Claude session, not touched: ${path}`;
  if (lock.startsWith(CLAUDE_LOCK_REASON)) return `in use by a Claude session, not touched: ${path}`;
  return `locked${lock === "" ? "" : ` (${lock})`}, not touched: ${path}`;
}

/** A worktree `prune` can delete, with the tip of its branch when it was checked. */
interface Doomed {
  path: string;
  branch: string;
  tip: string;
}

/**
 * Whether a worktree is as it was when checked: same tip, clean, not locked. Someone may
 * have gone on working in it while the question was open.
 * @param mainRoot - The main checkout.
 * @param doomed - The worktree.
 * @returns True if it did not change.
 */
function unchanged(mainRoot: string, doomed: Doomed): boolean {
  const tip = git(mainRoot, ["rev-parse", "-q", "--verify", `refs/heads/${doomed.branch}`]).out;
  const entry = worktrees(mainRoot).find((item) => item.path === doomed.path);
  return tip === doomed.tip && isClean(doomed.path) && entry !== undefined && entry.lock === null;
}

/**
 * The worktrees `prune` may delete: linked, on a branch, not locked, with the last PR of
 * the branch merged or closed, clean and with nothing unpushed. It says why it skips the
 * others.
 * @param options - The options.
 * @param mainRoot - The main checkout.
 * @param out - Where to write.
 * @returns The worktrees.
 */
async function pruneCandidates(options: WorktreeOptions, mainRoot: string, out: Output): Promise<Doomed[]> {
  const only = options.only === null ? null : checkoutRoot(options.only);
  if (options.only !== null && only === null) throw new StartError(`${options.only} is not a worktree.`);
  const found: Doomed[] = [];
  const unread: string[] = [];
  for (const entry of worktrees(mainRoot).slice(1)) {
    const { path, branch } = entry;
    if (branch === null || (only !== null && path !== only)) continue;
    const locked = lockedReason(entry);
    if (locked !== null) {
      out.stdout(`${locked}\n`);
      continue;
    }
    const pr = options.repo === null ? null : await findPr(options.repo, branch).catch(() => {
      unread.push(branch);
      return null;
    });
    if (pr === null || (pr.state !== "MERGED" && pr.state !== "CLOSED")) continue;
    if (!isClean(path)) {
      out.stdout(`PR ${pr.state}, but with uncommitted changes, not deleted: ${path}\n`);
      continue;
    }
    if (!safeToDelete(mainRoot, branch, pr.head)) {
      out.stdout(`PR ${pr.state}, but with commits that are not in origin, not deleted: ${path}\n`);
      continue;
    }
    out.stdout(`PR ${pr.state}: ${path} (${branch})\n`);
    found.push({ path, branch, tip: git(mainRoot, ["rev-parse", `refs/heads/${branch}`]).out });
  }
  if (unread.length > 0) warn(out, `could not read the PRs of ${unread.join(", ")} from GitHub; they were left alone.`);
  return found;
}

/**
 * `worktree prune [--only <dir>] [--yes]`: deletes the worktrees whose PR was merged or
 * closed, after asking: their teardown, the folder, the local branch and the session id.
 * It never touches one with uncommitted changes, unpushed commits, or a lock (a live
 * session of `claude --worktree` or `issue start`, or by hand), and checks each again just
 * before deleting it.
 * @param options - The options.
 * @param out - Where to write.
 * @returns The exit code.
 * @throws StartError outside git.
 * @example await worktreePrune(options, out)
 */
export async function worktreePrune(options: WorktreeOptions, out: Output): Promise<number> {
  const place = stepPlace(options, out);
  const { mainRoot } = place;
  const doomed = await pruneCandidates(options, mainRoot, out);
  if (doomed.length === 0) {
    out.stdout("No worktrees to delete.\n");
    return 0;
  }
  if (!options.yes && !(await confirm(out, "Delete the worktrees above with their local branch and their Docker?"))) {
    out.stdout("Deleted nothing.\n");
    return 0;
  }
  const { commonDir } = locateRepo(mainRoot) ?? { commonDir: "" };
  for (const item of doomed) {
    if (!unchanged(mainRoot, item)) {
      out.stdout(`changed since the check, not deleted: ${item.path}\n`);
      continue;
    }
    teardownWorktree({ ...place, root: item.path });
    if (!git(mainRoot, ["worktree", "remove", item.path]).ok) {
      warn(out, `could not delete ${item.path} (its teardown already ran: its Docker and ports are gone); see 'git -C ${item.path} status'.`);
      continue;
    }
    if (!git(mainRoot, ["branch", "-q", "-D", item.branch]).ok) warn(out, `could not delete the local branch ${item.branch}.`);
    forgetSession(commonDir, item.branch);
    out.stdout(`deleted: ${item.path} (${item.branch})\n`);
  }
  return 0;
}
