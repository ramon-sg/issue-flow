/**
 * @file `issue-flow pr worktree <n>`: a PR in its own worktree, to review it without
 * leaving what you are doing. The worktree is on the PR's branch, tracking origin, so what
 * you commit and push updates the PR. It copies `.worktreeinclude` and runs the setup
 * steps, but a `trusted` step (an install) is skipped, because the PR's code is not in the
 * base branch yet: it says what to run once you checked it. It never touches the main
 * checkout, and a PR from a fork is refused, since its branch is not in origin. Cleaning up
 * is `worktree prune`, like every other worktree. Ported from Clean Queen's
 * `scripts/pr-worktree.sh`.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getPr } from "@ramon-sg/github-rest";
import type { FlowConfig } from "../config.js";
import { canonicalPath } from "../docker.js";
import { checkedOutAt, git, hasLocal, locateRepo, worktrees } from "../git.js";
import { permissionArgs } from "../launch.js";
import { type Output, warn } from "../output.js";
import { copyWorktreeIncludes } from "../start-place.js";
import { StartError } from "../start-state.js";
import { runSetup } from "../worktree-steps.js";
import { baseBranch } from "./worktree.js";

/** Options of `issue-flow pr worktree`. */
export interface PrWorktreeOptions {
  repo: string;
  config: FlowConfig;
  cwd: string;
  number: number;
  setup: boolean;
  command: string[] | null;
}

/**
 * The folder of a PR's worktree: `pr-<n>` in the config's worktrees folder.
 * @param mainRoot - The main checkout.
 * @param config - The config.
 * @param number - The PR.
 * @returns The path.
 * @example prWorktreePath("/repo", config, 7) // "/repo/.claude/worktrees/pr-7"
 */
export function prWorktreePath(mainRoot: string, config: FlowConfig, number: number): string {
  return join(mainRoot, config.worktrees.dir, `pr-${number}`);
}

/**
 * Runs git and stops with the message if it fails.
 * @param cwd - Where.
 * @param args - The arguments.
 * @param message - What failed, for the error.
 * @throws StartError if git fails.
 */
function mustGit(cwd: string, args: string[], message: string): void {
  const result = git(cwd, args);
  if (!result.ok) throw new StartError(`${message}: ${result.err || result.out}`);
}

/**
 * Makes the worktree on the PR's branch: the local branch if there is one (moved forward to
 * origin's when it can be), or a new one tracking origin's.
 * @param mainRoot - The main checkout.
 * @param branch - The PR's branch.
 * @param path - The worktree.
 * @param out - Where a warning goes.
 * @throws StartError if git cannot make it, or the branch is checked out somewhere else.
 */
function addWorktree(mainRoot: string, branch: string, path: string, out: Output): void {
  mustGit(mainRoot, ["fetch", "-q", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`], `could not fetch ${branch} from origin`);
  const elsewhere = checkedOutAt(mainRoot, branch);
  if (elsewhere !== null) throw new StartError(`${branch} is checked out in ${elsewhere}; review it there, or switch that checkout to another branch.`);
  if (!hasLocal(mainRoot, branch)) {
    mustGit(mainRoot, ["worktree", "add", "-q", "--track", "-b", branch, path, `origin/${branch}`], `could not make the worktree of ${branch}`);
    return;
  }
  mustGit(mainRoot, ["worktree", "add", "-q", path, branch], `could not make the worktree of ${branch}`);
  if (!git(path, ["branch", "-q", "--set-upstream-to", `origin/${branch}`]).ok)
    warn(out, `could not make ${branch} track origin/${branch}.`);
  if (!git(path, ["merge", "-q", "--ff-only", `origin/${branch}`]).ok)
    warn(out, `the local ${branch} does not move forward to origin/${branch}: you see other commits than the PR's.`);
}

/**
 * `pr worktree <n> [--no-setup] [-- <command>]`: makes or reuses the PR's worktree and
 * prints where it is; with `--`, runs the command there (Claude, with the repo's permission
 * mode, if it names none) and exits with its code.
 * @param options - The options.
 * @param out - Where to write.
 * @returns The exit code.
 * @throws StartError if the PR does not exist, comes from a fork or cannot be checked out.
 * @example await prWorktree({ ...options, number: 7 }, out)
 */
export async function prWorktree(options: PrWorktreeOptions, out: Output): Promise<number> {
  const located = locateRepo(options.cwd);
  if (located === null) throw new StartError("run this inside a checkout of the repo.");
  const { mainRoot } = located;
  const pr = await getPr(options.repo, options.number);
  if (pr === null) throw new StartError(`${options.repo} has no PR #${options.number}.`);
  if (pr.fork)
    throw new StartError(`PR #${pr.number} comes from a fork and its branch is not in origin; check it out by hand in a worktree with 'gh pr checkout ${pr.number}'.`);
  out.stdout(`PR #${pr.number}: ${pr.url}\n`);
  if (pr.state !== "OPEN") warn(out, `the PR is ${pr.state.toLowerCase()}.`);
  const path = canonicalPath(prWorktreePath(mainRoot, options.config, pr.number));
  const existing = worktrees(mainRoot).find((entry) => entry.path === path);
  if (existing !== undefined && existing.branch !== pr.branch)
    throw new StartError(`${path} is on ${existing.branch ?? "a detached HEAD"}, not on the PR's branch ${pr.branch}; delete it with 'git worktree remove ${path}'.`);
  if (existing === undefined && existsSync(path)) throw new StartError(`${path} exists and is not a worktree of this repo.`);
  if (existing === undefined) {
    addWorktree(mainRoot, pr.branch, path, out);
    copyWorktreeIncludes(mainRoot, path, out);
    out.stdout(`Worktree on ${pr.branch}: what you commit and push updates the PR.\n`);
  } else out.stdout(`The worktree already exists; reusing it.\n`);
  const place = { root: path, mainRoot, base: baseBranch(options.config, mainRoot), config: options.config, out, remote: false };
  if (options.setup) await runSetup(place, null);
  if (options.command === null) {
    out.stdout(`Ready. To go in: cd ${path}\n`);
    return 0;
  }
  const [command, ...args] = options.command.length > 0
    ? options.command
    : ["claude", ...permissionArgs("default", path, mainRoot).args];
  if (command === undefined) return 0;
  const result = spawnSync(command, args, { cwd: path, stdio: "inherit" });
  if (result.error !== undefined) throw new StartError(`could not run ${command}: ${result.error.message}`);
  return result.status ?? 1;
}
