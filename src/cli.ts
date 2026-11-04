#!/usr/bin/env node
/**
 * @file `issue-flow` CLI. Warnings on stderr; exits 0 on success, 1 if GitHub, an edit or
 * the start of an issue failed (or was declined) and 2 on bad usage or a bad
 * `.agents/flow.json`.
 */
import { parseArgs } from "node:util";
import { COMMAND_FLAGS, type Flags, OPTIONS } from "./cli-flags.js";
import { GitHubError, InvalidRepoEnvError, resolveRepo } from "@ramon-sg/github-rest";
import { branchMissing, branchOf } from "./commands/issue-branch.js";
import { issueStart } from "./commands/issue-start.js";
import { labelsSync } from "./commands/labels.js";
import { ADAPTER_COMMANDS, HOOK_COMMANDS, runAdapter, runHook, runSession, runWorktree, WORKTREE_COMMANDS } from "./cli-worktree.js";
import { runSetupCommand, SETUP_COMMANDS } from "./cli-setup.js";
import { prWorktree } from "./commands/pr-worktree.js";
import { ConfigError } from "./config-base.js";
import { type FlowConfig, loadConfig, type Namer } from "./config.js";
import type { Permissions } from "./launch.js";
import { LangError, resolveLang } from "./lang.js";
import { messages } from "./messages/index.js";
import { type Output, processOutput, UsageError } from "./output.js";
import type { Messages } from "./messages/index.js";
import { usageOf } from "./usage.js";

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
 * @param t - The messages of the terminal.
 * @returns `owner/repo`.
 * @throws UsageError if `-R` or `GH_REPO` is malformed; GitHubError if there is no repo.
 */
export function repoOf(flag: string | undefined, config: FlowConfig, cwd: string, t: Messages): string {
  if (flag !== undefined && !REPO.test(flag))
    throw new UsageError(t.cli.repoFlag(flag));
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
 * @param t - The messages of the terminal.
 * @returns The namer, or undefined to use the config's.
 * @throws UsageError if it is not claude or title.
 */
function namerOf(value: string | undefined, t: Messages): Namer | undefined {
  if (value === undefined || value === "claude" || value === "title") return value;
  throw new UsageError(t.cli.namer(value));
}

/**
 * Checks that only the command's own flags were given.
 * @param command - The command (`start`, `worktree prune`, `session`).
 * @param flags - The flags.
 * @param t - The messages of the terminal.
 * @throws UsageError if one belongs to another command.
 * @example ownFlags("worktree ports", { next: true }, t)
 */
export function ownFlags(command: string, flags: Flags, t: Messages): void {
  const shared = command === "branch" || command === "start" ? ["repo", "help", "lang", "namer"] : ["repo", "help", "lang"];
  const allowed = new Set<string>([...shared, ...(COMMAND_FLAGS[command] ?? [])]);
  const other = Object.keys(flags).find((flag) => !allowed.has(flag));
  const name = command === "branch" || command === "start" ? `issue ${command}` : command;
  if (other !== undefined) throw new UsageError(t.cli.flagNotWith(other, name));
}

/**
 * The permission mode of `issue start`.
 * @param flags - The flags.
 * @param t - The messages of the terminal.
 * @returns The mode.
 * @throws UsageError if both were given.
 */
function permissionsOf(flags: Flags, t: Messages): Permissions {
  if (flags["ask-permissions"] && flags.free) throw new UsageError(t.cli.askOrFree);
  if (flags["no-repo-deny"] && !flags.free) throw new UsageError(t.cli.noRepoDenyNeedsFree);
  if (flags.free) return flags["no-repo-deny"] ? "free-no-repo-deny" : "free";
  return flags["ask-permissions"] ? "ask" : "default";
}

/**
 * Checks the flags of `issue start`.
 * @param flags - The flags.
 * @param rest - The positionals after the command.
 * @param t - The messages of the terminal.
 * @returns The issue number.
 * @throws UsageError if they do not fit.
 */
function startArgs(flags: Flags, rest: string[], t: Messages): number {
  const [text, ...extra] = rest;
  if (text === undefined || extra.length > 0 || !NUMBER.test(text))
    throw new UsageError(t.cli.startNeedsNumber);
  if (flags.resume !== undefined && flags.new) throw new UsageError(t.cli.resumeWithNew);
  const conflicting = flags.branch || flags["dry-run"] || flags.yes || flags.resume !== undefined || flags.new || flags["no-repo-deny"];
  if (flags.plan && conflicting)
    throw new UsageError(t.cli.planConflicts);
  cloudArgs(flags, t);
  return Number(text);
}

/** The flags that do not go together with each way of starting, besides each other. */
const EXCLUSIVE: Record<"cloud" | "here" | "teleport" | "adopt", (keyof Flags)[]> = {
  cloud: ["branch", "plan", "ask-permissions", "free", "no-repo-deny"],
  here: ["branch", "plan", "ask-permissions", "free", "no-repo-deny"],
  teleport: ["plan", "new", "no-launch"],
  adopt: ["branch", "plan", "resume", "new", "ask-permissions", "free", "no-repo-deny"],
};

/**
 * Checks `--cloud`, `--here`, `--teleport` and `--adopt`: at most one, and none with the
 * flags it has no use for (only `--teleport` opens Claude here, and it needs a branch).
 * @param flags - The flags.
 * @param t - The messages of the terminal.
 * @throws UsageError if they do not fit.
 */
function cloudArgs(flags: Flags, t: Messages): void {
  const ways = (Object.keys(EXCLUSIVE) as (keyof typeof EXCLUSIVE)[]).filter((way) => flags[way] === true);
  if (ways.length > 1) throw new UsageError(t.cli.oneWay(ways));
  const [way] = ways;
  if (way === undefined) return;
  const other = EXCLUSIVE[way].find((flag) => flags[flag] !== undefined && flags[flag] !== false);
  if (other !== undefined) throw new UsageError(t.cli.wayNotWith(way, other));
}

/**
 * The positionals of some arguments, with each flag's value left out (`-R o/r` is a flag).
 * @param args - The arguments.
 * @returns The positionals.
 */
function positionalsOf(args: string[]): string[] {
  return parseArgs({ args, options: OPTIONS, allowPositionals: true, strict: false }).positionals;
}

/**
 * Splits the arguments from the command that `pr worktree` runs after `--`. Anywhere else
 * a `--` is dropped, since pnpm passes it on as it is (`pnpm issue:start -- 42` runs
 * `issue start -- 42`), and so is one right after `pr worktree` with no PR number before it
 * (`pnpm pr:worktree -- 5`).
 * @param argv - The arguments.
 * @returns The arguments for issue-flow, and the command, or null if there is none.
 * @example splitArgs(["pr", "worktree", "5", "--", "npm", "test"]) // { args: ["pr", "worktree", "5"], command: ["npm", "test"] }
 */
export function splitArgs(argv: string[]): { args: string[]; command: string[] | null } {
  let args = argv;
  for (let dashes = args.indexOf("--"); dashes !== -1; dashes = args.indexOf("--")) {
    const words = positionalsOf(args.slice(0, dashes));
    if (words[0] === "pr" && words[1] === "worktree" && words.length > 2) return { args: args.slice(0, dashes), command: args.slice(dashes + 1) };
    args = args.filter((_, index) => index !== dashes);
  }
  return { args, command: null };
}

/**
 * The command's words, as `usageOf` takes them.
 * @param argv - The arguments.
 * @returns The positionals, without the flags nor their values.
 */
function commandWords(argv: string[]): string[] {
  return positionalsOf(splitArgs(argv).args);
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
  const { args, command } = splitArgs(argv);
  let parsed;
  try {
    parsed = parseArgs({ args, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values: flags, positionals } = parsed;
  if (flags.help) {
    out.stdout(`${usageOf(positionals, out.t)}\n`);
    return 0;
  }
  const { t } = out;
  const [group, sub, ...rest] = positionals;
  if (group === "pr") return runPr(sub, rest, flags, { out, cwd, command });
  if (group === "labels") return runLabels(sub, rest, flags, { out, cwd });
  if (group !== undefined && SETUP_COMMANDS.includes(group)) {
    ownFlags(group, flags, t);
    return runSetupCommand(group, flags, [sub, ...rest].filter((item) => item !== undefined), { out, cwd });
  }
  if (group === "adapter" || group === "hook") {
    const commands = group === "adapter" ? ADAPTER_COMMANDS : HOOK_COMMANDS;
    if (sub === undefined || !commands.includes(sub)) throw new UsageError(t.cli.groupExpects(group, commands));
    ownFlags(`${group} ${sub}`, flags, t);
    if (group === "hook") {
      if (rest.length > 0) throw new UsageError(t.cli.takesNoArguments(`hook ${sub}`));
      return runHook(sub, { out, cwd });
    }
    return runAdapter(sub, flags, rest, { out, cwd, repo: () => repoOf(flags.repo, loadConfig(cwd), cwd, t) });
  }
  return runIssue(group, sub, rest, flags, { out, cwd });
}

/**
 * Runs `issue-flow pr worktree <n>`.
 * @param sub - The word after `pr`.
 * @param rest - The positionals after it.
 * @param flags - The flags.
 * @param run - Where it writes and runs, and the command after `--` (null without `--`).
 * @returns The exit code.
 * @throws UsageError if the arguments do not fit.
 */
async function runPr(sub: string | undefined, rest: string[], flags: Flags, run: { out: Output; cwd: string; command: string[] | null }): Promise<number> {
  if (sub !== "worktree") throw new UsageError(run.out.t.cli.prExpects);
  ownFlags("pr worktree", flags, run.out.t);
  const [text, ...extra] = rest;
  if (text === undefined || extra.length > 0 || !NUMBER.test(text)) throw new UsageError(run.out.t.cli.prNeedsNumber);
  const config = loadConfig(run.cwd);
  return prWorktree(
    { repo: repoOf(flags.repo, config, run.cwd, run.out.t), config, cwd: run.cwd, number: Number(text), setup: !(flags["no-setup"] ?? false), command: run.command },
    run.out,
  );
}

/**
 * Runs `issue-flow labels sync`.
 * @param sub - The word after `labels`.
 * @param rest - The positionals after it.
 * @param flags - The flags.
 * @param run - Where it writes and runs.
 * @returns The exit code.
 * @throws UsageError if the arguments do not fit; GitHubError if GitHub fails.
 */
async function runLabels(sub: string | undefined, rest: string[], flags: Flags, run: { out: Output; cwd: string }): Promise<number> {
  if (sub !== "sync") throw new UsageError(run.out.t.cli.labelsExpects);
  ownFlags("labels sync", flags, run.out.t);
  if (rest.length > 0) throw new UsageError(run.out.t.cli.takesNoArguments("labels sync"));
  const config = loadConfig(run.cwd);
  return labelsSync(
    { repo: repoOf(flags.repo, config, run.cwd, run.out.t), labels: config.labels, update: flags.update ?? false, dryRun: flags["dry-run"] ?? false, json: flags.json ?? false },
    run.out,
  );
}

/**
 * Runs the `issue`, `worktree` and `session` commands.
 * @param group - The first word.
 * @param command - The second word.
 * @param rest - The positionals after them.
 * @param flags - The flags.
 * @param run - Where it writes and runs.
 * @returns The exit code.
 * @throws UsageError, ConfigError or GitHubError.
 */
async function runIssue(group: string | undefined, command: string | undefined, rest: string[], flags: Flags, run: { out: Output; cwd: string }): Promise<number> {
  const { out, cwd } = run;
  const { t } = out;
  const positionals = [group, command, ...rest].filter((item) => item !== undefined);
  if (group === "session") {
    ownFlags("session", flags, t);
    if (positionals.length > 1) throw new UsageError(t.cli.takesNoArguments("session"));
    return runSession(out, cwd);
  }
  if (group === "worktree") {
    if (command === undefined || !WORKTREE_COMMANDS.includes(command))
      throw new UsageError(t.cli.groupExpects("worktree", WORKTREE_COMMANDS));
    ownFlags(`worktree ${command}`, flags, t);
    if (rest.length > 0) throw new UsageError(t.cli.takesNoArguments(`worktree ${command}`));
    const config = loadConfig(cwd);
    return runWorktree(command, flags, { out, cwd, config, repo: () => repoOf(flags.repo, config, cwd, t) });
  }
  if (group !== "issue" || (command !== "branch" && command !== "start"))
    throw new UsageError(group === undefined ? t.cli.missingCommand : t.cli.unknownCommand(positionals));
  ownFlags(command, flags, t);
  if (flags.yes && flags["dry-run"]) throw new UsageError(t.cli.yesOrDryRun);
  const namer = namerOf(flags.namer, t);
  if (command === "start") {
    const number = startArgs(flags, rest, t);
    const permissions = permissionsOf(flags, t);
    const config = loadConfig(cwd);
    return issueStart(
      {
        repo: repoOf(flags.repo, config, cwd, t),
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
    throw new UsageError(t.cli.limit(flags.limit));
  if (flags.missing && rest.length > 0) throw new UsageError(t.cli.missingNoNumbers);
  if (!flags.missing && (rest.length === 0 || !rest.every((text) => NUMBER.test(text))))
    throw new UsageError(t.cli.branchNeeds);
  if (!flags.missing && (flags.yes || flags["dry-run"] || flags.limit !== undefined))
    throw new UsageError(t.cli.missingFlags);
  const config = loadConfig(cwd);
  const options = {
    repo: repoOf(flags.repo, config, cwd, t),
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

/**
 * The `--lang` value of some arguments, read before anything else.
 * @param argv - The arguments.
 * @returns The value, or undefined.
 */
function langFlagOf(argv: string[]): string | undefined {
  const { values } = parseArgs({ args: splitArgs(argv).args, options: OPTIONS, allowPositionals: true, strict: false });
  return typeof values.lang === "string" ? values.lang : undefined;
}

const argv = process.argv.slice(2);
let lang;
try {
  lang = resolveLang(langFlagOf(argv), process.env);
} catch (error) {
  if (!(error instanceof LangError)) throw error;
  process.stderr.write(`issue-flow: ${messages("es").lang.invalid(error.source, error.value)}\n${usageOf(commandWords(argv), messages("es"))}\n`);
  process.exit(2);
}
const out = processOutput(lang);
main(argv, out, process.cwd()).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const usage = error instanceof UsageError;
    const config = error instanceof ConfigError;
    out.stderr(`issue-flow: ${error instanceof Error ? error.message : String(error)}\n${usage ? `${usageOf(commandWords(argv), out.t)}\n` : ""}`);
    process.exitCode = usage || config ? 2 : 1;
  },
);
