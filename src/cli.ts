#!/usr/bin/env node
/**
 * @file `issue-flow` CLI. Warnings on stderr; exits 0 on success, 1 if GitHub, an edit or
 * the start of an issue failed (or was declined) and 2 on bad usage or a bad
 * `.agents/flow.json`.
 */
import { parseArgs } from "node:util";
import { GitHubError, InvalidRepoEnvError, resolveRepo } from "@ramon-sg/github-rest";
import { branchMissing, branchOf } from "./commands/issue-branch.js";
import { issueStart } from "./commands/issue-start.js";
import { runSession, runWorktree, WORKTREE_COMMANDS } from "./cli-worktree.js";
import { ConfigError } from "./config-base.js";
import { type FlowConfig, loadConfig, type Namer } from "./config.js";
import type { Permissions } from "./launch.js";
import { type Output, processOutput, UsageError } from "./output.js";

/** Usage text. */
const USAGE = `Usage:
  issue-flow issue branch <n>... [--namer claude|title] [--json] [-R owner/repo]
  issue-flow issue branch --missing [--limit <n>] [--namer claude|title] [--dry-run | --yes] [--json] [-R owner/repo]
  issue-flow issue start <n> [--branch] [--dry-run | --yes] [--resume <branch> | --new] [--no-launch]
                             [--ask-permissions | --free] [--namer claude|title] [-R owner/repo]
  issue-flow issue start <n> --plan [--ask-permissions | --free] [--namer claude|title] [-R owner/repo]
  issue-flow issue start <n> --cloud | --here | --teleport | --adopt [...]
  issue-flow worktree setup [--only <step>]
  issue-flow worktree teardown [--path <dir>]
  issue-flow worktree ports [--next]
  issue-flow worktree cleanup [--path <dir>]
  issue-flow worktree prune [--only <dir>] [--yes] [-R owner/repo]
  issue-flow session

The slug comes from the issue's "Slug de rama" block, then from Claude, then from the title,
and the branch from the repo's template (an older "Rama sugerida" block is used if it fits).
--missing adds the slug block to every open issue without a block, after confirming.

issue start makes the branch in a worktree (or, with --branch, in this checkout), the
start commit, the push, the draft PR and the assignment, after confirming, and opens
Claude: in auto mode if the repo has claude-repo-guard, with your settings with
--ask-permissions, and with no sandbox nor questions with --free. --plan prints the branch
and the prompt as JSON and changes nothing.

--cloud confirms here and opens a Claude cloud session that starts the issue there.
--here, inside a cloud session, starts it in this checkout and opens nothing. --teleport
brings the cloud session noted in the PR to the worktree. --adopt starts it in the
worktree another tool (Orca, Paseo) just made, without asking nor opening Claude.

worktree runs the steps of "worktrees" in .agents/flow.json: setup prepares this worktree,
teardown cleans it before it goes (steps, ports, Docker), ports prints or moves its block
of ports, cleanup deletes the Docker of deleted worktrees, and prune deletes the worktrees
whose PR was merged or closed. session is the SessionStart hook of Claude Code.`;

/** Options of the CLI. */
const OPTIONS = {
  repo: { type: "string", short: "R" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  missing: { type: "boolean" },
  limit: { type: "string" },
  namer: { type: "string" },
  yes: { type: "boolean", short: "y" },
  "dry-run": { type: "boolean" },
  branch: { type: "boolean" },
  resume: { type: "string" },
  new: { type: "boolean" },
  "no-launch": { type: "boolean" },
  "ask-permissions": { type: "boolean" },
  free: { type: "boolean" },
  plan: { type: "boolean" },
  cloud: { type: "boolean" },
  here: { type: "boolean" },
  teleport: { type: "boolean" },
  adopt: { type: "boolean" },
  only: { type: "string" },
  path: { type: "string" },
  next: { type: "boolean" },
} as const;

/** The parsed flags. */
export type Flags = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true; strict: true }>>["values"];

/** Flags each command takes, besides `--repo`, `--help` and `--namer`. */
const COMMAND_FLAGS: Record<string, (keyof Flags)[]> = {
  branch: ["json", "missing", "limit", "yes", "dry-run"],
  start: [
    "yes",
    "dry-run",
    "branch",
    "resume",
    "new",
    "no-launch",
    "ask-permissions",
    "free",
    "plan",
    "cloud",
    "here",
    "teleport",
    "adopt",
  ],
  "worktree setup": ["only"],
  "worktree teardown": ["path"],
  "worktree ports": ["next"],
  "worktree cleanup": ["path"],
  "worktree prune": ["only", "yes"],
  session: [],
};

/** An issue number: digits only. */
const NUMBER = /^\d+$/;

/** A positive whole number. */
const POSITIVE = /^[1-9]\d*$/;

/** `owner/repo`. */
const REPO = /^[^/\s]+\/[^/\s]+$/;

/**
 * The repo of the command: `-R`, then the config's `repo`, then `GH_REPO`, then origin.
 * @param flag - The `-R` value.
 * @param config - The config.
 * @param cwd - Where the command runs.
 * @returns `owner/repo`.
 * @throws UsageError if `-R` or `GH_REPO` is malformed; GitHubError if there is no repo.
 */
export function repoOf(flag: string | undefined, config: FlowConfig, cwd: string): string {
  if (flag !== undefined && !REPO.test(flag))
    throw new UsageError(`-R expects owner/repo: ${flag}`);
  let repo: string | null;
  try {
    repo = resolveRepo(flag ?? config.repo ?? undefined, cwd);
  } catch (error) {
    if (error instanceof InvalidRepoEnvError) throw new UsageError(error.message);
    throw error;
  }
  if (repo === null)
    throw new GitHubError(
      "can't tell which repo this is: run inside a checkout whose origin is on GitHub, pass -R owner/repo, set GH_REPO or \"repo\" in .agents/flow.json.",
      0,
    );
  return repo;
}

/**
 * The `--namer` value.
 * @param value - The flag, or undefined.
 * @returns The namer, or undefined to use the config's.
 * @throws UsageError if it is not claude or title.
 */
function namerOf(value: string | undefined): Namer | undefined {
  if (value === undefined || value === "claude" || value === "title") return value;
  throw new UsageError(`--namer expects claude or title: ${value}`);
}

/**
 * Checks that only the command's own flags were given.
 * @param command - The command (`start`, `worktree prune`, `session`).
 * @param flags - The flags.
 * @throws UsageError if one belongs to another command.
 * @example ownFlags("worktree ports", { next: true })
 */
export function ownFlags(command: string, flags: Flags): void {
  const shared = command === "branch" || command === "start" ? ["repo", "help", "namer"] : ["repo", "help"];
  const allowed = new Set<string>([...shared, ...(COMMAND_FLAGS[command] ?? [])]);
  const other = Object.keys(flags).find((flag) => !allowed.has(flag));
  const name = command === "branch" || command === "start" ? `issue ${command}` : command;
  if (other !== undefined) throw new UsageError(`--${other} does not go with ${name}.`);
}

/**
 * The permission mode of `issue start`.
 * @param flags - The flags.
 * @returns The mode.
 * @throws UsageError if both were given.
 */
function permissionsOf(flags: Flags): Permissions {
  if (flags["ask-permissions"] && flags.free) throw new UsageError("use --ask-permissions or --free, not both.");
  if (flags.free) return "free";
  return flags["ask-permissions"] ? "ask" : "default";
}

/**
 * Checks the flags of `issue start`.
 * @param flags - The flags.
 * @param rest - The positionals after the command.
 * @returns The issue number.
 * @throws UsageError if they do not fit.
 */
function startArgs(flags: Flags, rest: string[]): number {
  const [text, ...extra] = rest;
  if (text === undefined || extra.length > 0 || !NUMBER.test(text))
    throw new UsageError("issue start needs one issue number.");
  if (flags.resume !== undefined && flags.new) throw new UsageError("--resume does not go with --new.");
  const conflicting = flags.branch || flags["dry-run"] || flags.yes || flags.resume !== undefined || flags.new;
  if (flags.plan && conflicting)
    throw new UsageError("--plan does not go with --branch, --dry-run, --yes, --resume nor --new.");
  cloudArgs(flags);
  return Number(text);
}

/** The flags that do not go together with each way of starting, besides each other. */
const EXCLUSIVE: Record<"cloud" | "here" | "teleport" | "adopt", (keyof Flags)[]> = {
  cloud: ["branch", "plan", "ask-permissions", "free"],
  here: ["branch", "plan", "ask-permissions", "free"],
  teleport: ["plan", "new", "no-launch"],
  adopt: ["branch", "plan", "resume", "new", "ask-permissions", "free"],
};

/**
 * Checks `--cloud`, `--here`, `--teleport` and `--adopt`: at most one, and none with the
 * flags it has no use for (only `--teleport` opens Claude here, and it needs a branch).
 * @param flags - The flags.
 * @throws UsageError if they do not fit.
 */
function cloudArgs(flags: Flags): void {
  const ways = (Object.keys(EXCLUSIVE) as (keyof typeof EXCLUSIVE)[]).filter((way) => flags[way] === true);
  if (ways.length > 1) throw new UsageError(`use one of --${ways.join(", --")}, not several.`);
  const [way] = ways;
  if (way === undefined) return;
  const other = EXCLUSIVE[way].find((flag) => flags[flag] !== undefined && flags[flag] !== false);
  if (other !== undefined) throw new UsageError(`--${way} does not go with --${other}.`);
}

/**
 * Runs the CLI.
 * @param argv - Arguments without `node` or the script.
 * @param out - Where to write.
 * @param cwd - Where it runs.
 * @returns The exit code.
 * @throws UsageError, ConfigError or GitHubError, which the entry point handles.
 */
export async function main(argv: string[], out: Output, cwd: string): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values: flags, positionals } = parsed;
  if (flags.help) {
    out.stdout(`${USAGE}\n`);
    return 0;
  }
  const [group, command, ...rest] = positionals;
  if (group === "session") {
    ownFlags("session", flags);
    if (positionals.length > 1) throw new UsageError("session takes no arguments.");
    return runSession(out, cwd);
  }
  if (group === "worktree") {
    if (command === undefined || !WORKTREE_COMMANDS.includes(command))
      throw new UsageError(`worktree expects ${WORKTREE_COMMANDS.join(", ")}.`);
    ownFlags(`worktree ${command}`, flags);
    if (rest.length > 0) throw new UsageError(`worktree ${command} takes no arguments.`);
    const config = loadConfig(cwd);
    return runWorktree(command, flags, { out, cwd, config, repo: () => repoOf(flags.repo, config, cwd) });
  }
  if (group !== "issue" || (command !== "branch" && command !== "start"))
    throw new UsageError(group === undefined ? "missing the command." : `unknown command: ${positionals.join(" ")}`);
  ownFlags(command, flags);
  if (flags.yes && flags["dry-run"]) throw new UsageError("use --yes or --dry-run, not both.");
  const namer = namerOf(flags.namer);
  if (command === "start") {
    const number = startArgs(flags, rest);
    const permissions = permissionsOf(flags);
    const config = loadConfig(cwd);
    return issueStart(
      {
        repo: repoOf(flags.repo, config, cwd),
        config,
        cwd,
        number,
        ...(namer === undefined ? {} : { namer }),
        dryRun: flags["dry-run"] ?? false,
        yes: flags.yes ?? false,
        resume: flags.resume ?? null,
        forceNew: flags.new ?? false,
        branchMode: flags.branch ?? false,
        launch: !(flags["no-launch"] ?? false),
        permissions,
        plan: flags.plan ?? false,
        cloud: flags.cloud ?? false,
        here: flags.here ?? false,
        teleport: flags.teleport ?? false,
        adopt: flags.adopt ?? false,
        remoteSession: process.env.CLAUDE_CODE_REMOTE_SESSION_ID || null,
      },
      out,
    );
  }
  if (flags.limit !== undefined && !POSITIVE.test(flags.limit))
    throw new UsageError(`--limit expects a positive number: ${flags.limit}`);
  if (flags.missing && rest.length > 0) throw new UsageError("--missing takes no issue numbers.");
  if (!flags.missing && (rest.length === 0 || !rest.every((text) => NUMBER.test(text))))
    throw new UsageError("issue branch needs issue numbers, or --missing.");
  if (!flags.missing && (flags.yes || flags["dry-run"] || flags.limit !== undefined))
    throw new UsageError("--yes, --dry-run and --limit go with --missing.");
  const config = loadConfig(cwd);
  const options = {
    repo: repoOf(flags.repo, config, cwd),
    config,
    cwd,
    ...(namer === undefined ? {} : { namer }),
    json: flags.json ?? false,
    ...(flags.limit === undefined ? {} : { limit: Number(flags.limit) }),
    yes: flags.yes ?? false,
    dryRun: flags["dry-run"] ?? false,
  };
  return flags.missing ? branchMissing(options, out) : branchOf(rest.map(Number), options, out);
}

const out = processOutput();
main(process.argv.slice(2), out, process.cwd()).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const usage = error instanceof UsageError;
    const config = error instanceof ConfigError;
    out.stderr(`issue-flow: ${error instanceof Error ? error.message : String(error)}\n${usage ? `${USAGE}\n` : ""}`);
    process.exitCode = usage || config ? 2 : 1;
  },
);
