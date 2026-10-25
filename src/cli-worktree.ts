/**
 * @file The `worktree`, `session`, `adapter` and `hook` commands of the CLI: their flags
 * turned into options.
 */
import type { Flags } from "./cli.js";
import { adapterArchive, adapterIssue, type AdapterOptions, adapterSetup } from "./commands/adapter.js";
import { hookInput, worktreeCreate, worktreeRemove } from "./commands/claude-hooks.js";
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
import { type Output, UsageError } from "./output.js";

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
 * The folder of a Claude session: the `cwd` of the hook's input, which is the worktree's
 * with `claude --worktree`, then `CLAUDE_PROJECT_DIR` (the folder the session started in),
 * then where the command runs.
 * @param input - The hook's input.
 * @param cwd - Where the command runs.
 * @returns The folder.
 * @example sessionDir({ cwd: "/repo/.claude/worktrees/x" }, "/repo") // "/repo/.claude/worktrees/x"
 */
export function sessionDir(input: Record<string, unknown>, cwd: string): string {
  if (typeof input.cwd === "string" && input.cwd !== "") return input.cwd;
  return process.env.CLAUDE_PROJECT_DIR || cwd;
}

/**
 * Runs `issue-flow session`. A bad config never makes the session fail: it says so and
 * goes on with the defaults. It reads the hook's input only when Claude runs it
 * (`CLAUDE_PROJECT_DIR` is set), so run by hand with an open pipe it does not wait.
 * @param out - Where to write.
 * @param cwd - Where it runs.
 * @returns Always 0.
 * @example await runSession(out, process.cwd())
 */
export async function runSession(out: Output, cwd: string): Promise<number> {
  const dir = sessionDir(process.env.CLAUDE_PROJECT_DIR ? hookInput() : {}, cwd);
  let config = DEFAULT_CONFIG;
  try {
    config = loadConfig(dir);
  } catch (error) {
    out.stdout(`issue-flow session: ${error instanceof Error ? error.message : String(error)}; going on with the defaults.\n`);
  }
  return session({ config, cwd: dir }, out);
}

/** The commands of `issue-flow adapter`. */
export const ADAPTER_COMMANDS = ["setup", "issue", "archive"];

/**
 * Runs `issue-flow adapter <command>`. A bad config does not stop `setup` nor `archive`,
 * which always exit 0: they say so and go on with the defaults. `issue` with a URL, run
 * by hand, stops.
 * @param command - The command.
 * @param flags - The flags.
 * @param rest - The positionals after the command (the URL of `issue`).
 * @param run - Where it writes and runs, and how to get the repo.
 * @returns The exit code.
 * @throws What the command throws.
 * @example await runAdapter("setup", {}, [], run)
 */
export async function runAdapter(command: string, flags: Flags, rest: string[], run: Omit<WorktreeRun, "config">): Promise<number> {
  if (rest.length > (command === "issue" ? 1 : 0)) throw new UsageError(`adapter ${command} takes ${command === "issue" ? "at most one URL" : "no arguments"}.`);
  let config = DEFAULT_CONFIG;
  try {
    config = loadConfig(run.cwd);
  } catch (error) {
    if (command === "issue" && rest.length > 0) throw error;
    run.out.stderr(`issue-flow: ${error instanceof Error ? error.message : String(error)}; going on with the defaults.\n`);
  }
  const options: AdapterOptions = { config, cwd: run.cwd, only: flags.only ?? null, url: rest[0] ?? null, repo: run.repo };
  if (command === "setup") return adapterSetup(options, run.out);
  if (command === "issue") return adapterIssue(options, run.out);
  return adapterArchive(options, run.out);
}

/** The hooks of Claude Code that `issue-flow hook` implements. */
export const HOOK_COMMANDS = ["worktree-create", "worktree-remove"];

/**
 * Runs `issue-flow hook <name>` with the JSON Claude Code sends on stdin.
 * @param command - The hook.
 * @param run - Where it writes and runs.
 * @returns The exit code.
 * @throws What the hook throws, which tells Claude it failed.
 * @example await runHook("worktree-create", run)
 */
export async function runHook(command: string, run: Pick<WorktreeRun, "out" | "cwd">): Promise<number> {
  const input = hookInput();
  const dir = sessionDir(input, run.cwd);
  const config = loadConfig(dir);
  if (command === "worktree-create") return worktreeCreate(input, config, dir, run.out);
  return worktreeRemove(input, config, dir, run.out);
}
