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
import { show } from "../banner.js";
import type { FlowConfig } from "../config.js";
import { fromOrigin } from "../credentials.js";
import { canonicalPath } from "../docker.js";
import { checkedOutAt, failure, git, hasLocal, locateRepo, trackOrigin, untracked, worktrees } from "../git.js";
import { permissionArgs } from "../launch.js";
import type { Messages } from "../messages/index.js";
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
 * @param t - The messages.
 * @throws StartError if git fails.
 */
function mustGit(cwd: string, args: string[], message: string, t: Messages): void {
  const result = git(cwd, args);
  if (!result.ok) throw new StartError(failure(message, result, t));
}

/**
 * Makes the worktree on the PR's branch: the local branch if there is one (moved forward to
 * origin's when it can be), or a new one; either way tracking origin's when it can.
 * @param mainRoot - The main checkout.
 * @param branch - The PR's branch.
 * @param path - The worktree.
 * @param out - Where a warning or a question goes.
 * @param config - The config.
 * @throws StartError if git cannot make it, or the branch is checked out somewhere else.
 */
async function addWorktree(mainRoot: string, branch: string, path: string, out: Output, config: FlowConfig): Promise<void> {
  const fetched = await fromOrigin(out, config, mainRoot, ["fetch", "-q", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
  if (!fetched.ok) throw new StartError(failure(out.t.pr.fetchFailed(branch), fetched, out.t));
  const elsewhere = checkedOutAt(mainRoot, branch);
  if (elsewhere !== null) throw new StartError(out.t.pr.elsewhere(branch, elsewhere));
  // NOTE: the tracking goes apart, after the worktree: it writes .git/config, which Claude
  // Code's sandbox forbids, and the worktree is still useful without it.
  const local = hasLocal(mainRoot, branch);
  const args = local ? [path, branch] : ["--no-track", "-b", branch, path, `origin/${branch}`];
  mustGit(mainRoot, ["worktree", "add", "-q", ...args], out.t.pr.makeFailed(branch), out.t);
  if (!trackOrigin(path, branch)) warn(out, untracked(branch, out.t));
  if (local && !git(path, ["merge", "-q", "--ff-only", `origin/${branch}`]).ok)
    warn(out, out.t.pr.noFastForward(branch));
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
  if (located === null) throw new StartError(out.t.worktree.insideCheckout);
  const { mainRoot } = located;
  const pr = await getPr(options.repo, options.number);
  if (pr === null) throw new StartError(out.t.pr.noPr(options.repo, options.number));
  if (pr.fork)
    throw new StartError(out.t.pr.fork(pr.number));
  out.stdout(`${out.t.pr.title(pr.number, pr.url)}\n`);
  if (pr.state !== "OPEN") warn(out, out.t.pr.notOpen(pr.state.toLowerCase()));
  const path = canonicalPath(prWorktreePath(mainRoot, options.config, pr.number));
  const existing = worktrees(mainRoot).find((entry) => entry.path === path);
  if (existing !== undefined && existing.branch !== pr.branch)
    throw new StartError(out.t.pr.wrongBranch(path, existing.branch ?? out.t.pr.detached, pr.branch));
  if (existing === undefined && existsSync(path)) throw new StartError(out.t.pr.notWorktree(path));
  if (existing === undefined) {
    await addWorktree(mainRoot, pr.branch, path, out, options.config);
    copyWorktreeIncludes(mainRoot, path, out);
    out.stdout(`${out.t.pr.created(pr.branch)}\n`);
  } else out.stdout(`${out.t.pr.reusing}\n`);
  const place = { root: path, mainRoot, base: baseBranch(options.config, mainRoot), config: options.config, out, remote: false };
  if (options.setup) await runSetup(place, null);
  if (options.command === null) {
    const say = out.t.start.say;
    show(out, { mood: "ok", title: say.readyPr(pr.number), rows: [[say.branchLabel, pr.branch]], next: { label: say.goIn, command: `cd ${path}` } }, options.config);
    return 0;
  }
  const [command, ...args] = options.command.length > 0
    ? options.command
    : ["claude", ...permissionArgs("default", path, mainRoot, out.t.start.permissions).args];
  if (command === undefined) return 0;
  const result = spawnSync(command, args, { cwd: path, stdio: "inherit" });
  if (result.error !== undefined) throw new StartError(out.t.pr.runFailed(command, result.error.message));
  return result.status ?? 1;
}
