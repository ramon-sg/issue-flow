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
import { ConfigError, type FlowConfig, loadConfig, type Namer } from "./config.js";
import type { Permissions } from "./launch.js";
import { type Output, processOutput, UsageError } from "./output.js";

/** Usage text. */
const USAGE = `Usage:
  issue-flow issue branch <n>... [--namer claude|title] [--json] [-R owner/repo]
  issue-flow issue branch --missing [--limit <n>] [--namer claude|title] [--dry-run | --yes] [--json] [-R owner/repo]
  issue-flow issue start <n> [--branch] [--dry-run | --yes] [--resume <branch> | --new] [--no-launch]
                             [--ask-permissions | --free] [--namer claude|title] [-R owner/repo]
  issue-flow issue start <n> --plan [--ask-permissions | --free] [--namer claude|title] [-R owner/repo]

The slug comes from the issue's "Slug de rama" block, then from Claude, then from the title,
and the branch from the repo's template (an older "Rama sugerida" block is used if it fits).
--missing adds the slug block to every open issue without a block, after confirming.

issue start makes the branch in a worktree (or, with --branch, in this checkout), the
start commit, the push, the draft PR and the assignment, after confirming, and opens
Claude: in auto mode if the repo has claude-repo-guard, with your settings with
--ask-permissions, and with no sandbox nor questions with --free. --plan prints the branch
and the prompt as JSON and changes nothing.`;

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
} as const;

/** The parsed flags. */
type Flags = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true; strict: true }>>["values"];

/** Flags each command takes, besides `--repo`, `--help` and `--namer`. */
const COMMAND_FLAGS: Record<string, (keyof Flags)[]> = {
  branch: ["json", "missing", "limit", "yes", "dry-run"],
  start: ["yes", "dry-run", "branch", "resume", "new", "no-launch", "ask-permissions", "free", "plan"],
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
function repoOf(flag: string | undefined, config: FlowConfig, cwd: string): string {
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
 * @param command - The command.
 * @param flags - The flags.
 * @throws UsageError if one belongs to another command.
 */
function ownFlags(command: string, flags: Flags): void {
  const allowed = new Set<string>(["repo", "help", "namer", ...(COMMAND_FLAGS[command] ?? [])]);
  const other = Object.keys(flags).find((flag) => !allowed.has(flag));
  if (other !== undefined) throw new UsageError(`--${other} does not go with issue ${command}.`);
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
  return Number(text);
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
