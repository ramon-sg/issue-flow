/**
 * @file The `worktree` and `session` commands of the CLI: their flags turned into options.
 */
import type { Flags } from "./cli.js";
import { session } from "./commands/session.js";
import {
  worktreeCleanup,
  type WorktreeOptions,
  worktreePorts,
  worktreePrune,
  worktreeSetup,
  worktreeTeardown,
} from "./commands/worktree.js";
import { DEFAULT_CONFIG, type FlowConfig, loadConfig } from "./config.js";
import type { Output } from "./output.js";

/** The commands of `issue-flow worktree`. */
export const WORKTREE_COMMANDS = ["setup", "teardown", "ports", "cleanup", "prune"];

/** What a `worktree` command needs from the CLI. */
interface WorktreeRun {
  out: Output;
  cwd: string;
  config: FlowConfig;
  repo: () => string;
}

/**
 * Runs `issue-flow worktree <command>`. Only `prune` needs the repo (it asks GitHub for
 * the PRs), so the others work without one.
 * @param command - The command.
 * @param flags - The flags.
 * @param run - Where it writes and runs, the config and how to get the repo.
 * @returns The exit code.
 * @throws What the command throws.
 * @example await runWorktree("ports", { next: true }, run)
 */
export async function runWorktree(command: string, flags: Flags, run: WorktreeRun): Promise<number> {
  const options: WorktreeOptions = {
    repo: command === "prune" ? run.repo() : null,
    config: run.config,
    cwd: run.cwd,
    yes: flags.yes ?? false,
    only: flags.only ?? null,
    path: flags.path ?? null,
    next: flags.next ?? false,
  };
  if (command === "setup") return worktreeSetup(options, run.out);
  if (command === "teardown") return worktreeTeardown(options, run.out);
  if (command === "ports") return worktreePorts(options, run.out);
  if (command === "cleanup") return worktreeCleanup(options, run.out);
  return worktreePrune(options, run.out);
}

/**
 * Runs `issue-flow session`. A bad config never makes the session fail: it says so and
 * goes on with the defaults.
 * @param out - Where to write.
 * @param cwd - Where it runs.
 * @returns Always 0.
 * @example await runSession(out, process.cwd())
 */
export async function runSession(out: Output, cwd: string): Promise<number> {
  let config = DEFAULT_CONFIG;
  try {
    config = loadConfig(process.env.CLAUDE_PROJECT_DIR ?? cwd);
  } catch (error) {
    out.stdout(`issue-flow session: ${error instanceof Error ? error.message : String(error)}; going on with the defaults.\n`);
  }
  return session({ config, cwd }, out);
}
