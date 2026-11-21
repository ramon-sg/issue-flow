/**
 * @file The one place that talks to `@ramon-sg/runner`: it reads or creates the repo's
 * `.agents/runner.json`, pins the tools the flow runs in it, builds the `package.json`
 * shortcuts that call them, and strips what the old devDependencies mode left behind.
 * Nothing here writes: `apply` does.
 */
import {
  RUNNER_FILE,
  RunnerFileError,
  type Runner,
  type RunnerConfig,
  chooseRunner,
  effectiveRunner,
  readRunnerConfig,
  setTool,
  toolCommandText,
} from "@ramon-sg/runner";
import type { Messages } from "./messages/index.js";
import { FREE_SCRIPT, GITHUB_REST, LEGACY_SCRIPTS, START_SCRIPT, isNewer } from "./package-edits.js";
import { type OwnVersions, PACKAGE, SetupError } from "./setup-files.js";

/** What marks a script as the flow's: the `writeScripts` `owned` text. */
export const FLOW_OWNED = `${PACKAGE}@`;

/** An exact version, as `runner.json` demands. */
const EXACT = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

/**
 * Reads the repo's `runner.json` without creating it.
 * @param root - The repo.
 * @returns The config, or null if the repo has none.
 * @throws SetupError if the file cannot be used (with the library's message).
 */
export function readRunnerFile(root: string): RunnerConfig | null {
  try {
    return readRunnerConfig(root);
  } catch (error) {
    if (error instanceof RunnerFileError) throw new SetupError(error.message);
    throw error;
  }
}

/** What stands for the `github-rest` command when `runner.json` cannot say. */
const GITHUB_REST_FALLBACK = `${GITHUB_REST} (con el ejecutor y la versión de ${RUNNER_FILE})`;

/**
 * The command that runs `github-rest`, for the prompts: the repo's runner and pinned
 * version, or a sentence that points at `runner.json` if the file is missing, has no entry
 * or cannot be used (a bad file must not stop a start).
 * @param root - The repo.
 * @returns The command, without arguments.
 * @example githubRestCommand(root) // "bunx --bun @ramon-sg/github-rest@0.6.0"
 */
export function githubRestCommand(root: string): string {
  try {
    const config = readRunnerFile(root);
    const version = config !== null && Object.hasOwn(config.tools, GITHUB_REST) ? config.tools[GITHUB_REST] : undefined;
    return config === null || version === undefined ? GITHUB_REST_FALLBACK : toolCommandText(effectiveRunner(config), GITHUB_REST, version);
  } catch (error) {
    if (error instanceof SetupError) return GITHUB_REST_FALLBACK;
    throw error;
  }
}

/**
 * The command that runs `issue-flow apply` at a version, to suggest it in a message.
 * @param runner - The repo's runner, or null if it is not known.
 * @param version - The version to run.
 * @returns The command; without the runner, just the package at that version.
 * @example applyCommand("node", "0.6.0") // "npx --yes", then the package at 0.6.0 and "apply"
 */
export function applyCommand(runner: Runner | null, version: string): string {
  return runner === null ? `${PACKAGE}@${version} apply` : toolCommandText(runner, PACKAGE, version, ["apply"]);
}

/**
 * Reads the repo's `runner.json`, or prepares a new one in memory (it writes nothing).
 * @param root - The repo.
 * @param ask - Asks the user for a runner when Bun is missing; undefined to fall back to Node.
 * @returns The config, whether it is new and a warning to show; null if the user chose to quit.
 * @throws SetupError if the file cannot be used.
 */
export async function loadRunnerFile(
  root: string,
  ask: (() => Promise<Runner | null>) | undefined,
): Promise<{ config: RunnerConfig; created: boolean; warning: string | null } | null> {
  try {
    const found = readRunnerFile(root);
    if (found !== null) return { config: found, created: false, warning: null };
    const chosen = await chooseRunner({ ask });
    if (chosen === null) return null;
    return { config: { runner: chosen.runner, tools: {}, extra: {} }, created: true, warning: chosen.warning };
  } catch (error) {
    if (error instanceof RunnerFileError) throw new SetupError(error.message);
    throw error;
  }
}

/**
 * Pins `issue-flow` to the version that runs and `github-rest` if the file lacks it (at
 * the version the repo had as an exact dependency, else the bundled one). Never lowers a version.
 * @param config - The runner config.
 * @param versions - This package's versions.
 * @param legacyRest - The repo's old `github-rest` dependency, if any.
 * @param t - The messages.
 * @returns The new config, what changed and what was kept.
 */
export function withFlowTools(
  config: RunnerConfig,
  versions: OwnVersions,
  legacyRest: string | null,
  t: Messages,
): { config: RunnerConfig; changes: string[]; kept: string[] } {
  const changes: string[] = [];
  const kept: string[] = [];
  let next = config;
  const pin = (name: string, version: string, ifMissing: boolean): void => {
    const from = Object.hasOwn(next.tools, name) ? next.tools[name] : null;
    const result = setTool(next, name, version, { ifMissing });
    next = result.config;
    if (result.changed) changes.push(t.setup.toolPinned(name, from, version));
  };
  pin(PACKAGE, versions.issueFlow, false);
  pin(GITHUB_REST, legacyRest !== null && EXACT.test(legacyRest) ? legacyRest : versions.githubRest, true);
  const rest = next.tools[GITHUB_REST];
  if (rest !== undefined && isNewer(versions.githubRest, rest))
    kept.push(t.setup.keptRest(GITHUB_REST, rest, versions.githubRest));
  return { config: next, changes, kept };
}

/**
 * The `package.json` shortcuts of the flow, one command per runner.
 * @param runner - The runner.
 * @param version - The `issue-flow` version they pin.
 * @returns Script name to command.
 * @example flowScripts("bun", "0.6.0")["issue:start"] // "bunx --bun @ramon-sg/issue-flow@0.6.0 issue start"
 */
export function flowScripts(runner: Runner, version: string): Record<string, string> {
  const run = (...args: string[]): string => toolCommandText(runner, PACKAGE, version, args);
  return {
    [START_SCRIPT]: run("issue", "start"),
    [FREE_SCRIPT]: run("issue", "start", "--free"),
    "worktree:prune": run("worktree", "prune"),
    "pr:worktree": run("pr", "worktree"),
  };
}

/**
 * The scripts object of a package.json, if it has one.
 * @param pkg - The package.json.
 * @returns The scripts that are strings.
 */
function scriptsOf(pkg: Record<string, unknown> | null): Record<string, string> {
  const scripts = pkg?.scripts;
  if (typeof scripts !== "object" || scripts === null) return {};
  return Object.fromEntries(Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

/**
 * Takes out what the devDependencies mode left: `issue-flow` and `github-rest` as
 * dependencies and the scripts that call the repo's copy.
 * @param pkg - The package.json.
 * @param t - The messages, for the changes.
 * @returns The new package.json, what changed and whether a dependency went.
 */
export function withoutLegacy(
  pkg: Record<string, unknown>,
  t: Messages,
): { pkg: Record<string, unknown>; changes: string[]; removedDependencies: boolean } {
  const next: Record<string, unknown> = { ...pkg };
  const changes: string[] = [];
  let removedDependencies = false;
  for (const field of ["dependencies", "devDependencies"]) {
    const deps = next[field];
    if (typeof deps !== "object" || deps === null || Array.isArray(deps)) continue;
    const rest: Record<string, unknown> = { ...(deps as Record<string, unknown>) };
    for (const name of [PACKAGE, GITHUB_REST]) {
      if (!Object.hasOwn(rest, name)) continue;
      delete rest[name];
      changes.push(t.setup.droppedDependency(field, name));
      removedDependencies = true;
    }
    if (Object.keys(rest).length === Object.keys(deps).length) continue;
    if (Object.keys(rest).length === 0) delete next[field];
    else next[field] = rest;
  }
  const scripts = next.scripts;
  if (typeof scripts === "object" && scripts !== null && !Array.isArray(scripts)) {
    const left: Record<string, unknown> = {};
    const legacy = Object.values(LEGACY_SCRIPTS);
    for (const [name, command] of Object.entries(scripts)) {
      if (typeof command === "string" && legacy.includes(command)) changes.push(t.setup.droppedScript(name));
      else left[name] = command;
    }
    if (Object.keys(left).length !== Object.keys(scripts).length) {
      if (Object.keys(left).length === 0) delete next.scripts;
      else next.scripts = left;
    }
  }
  return { pkg: next, changes, removedDependencies };
}

/**
 * What `writeScripts` would do, without doing it: a script is written if it is missing or
 * already the flow's; any other value is a clash and stays.
 * @param pkg - The package.json, or null if there is none.
 * @param scripts - The shortcuts to write.
 * @param t - The messages, for the changes.
 * @returns The scripts that change and the ones left alone.
 */
export function predictScripts(
  pkg: Record<string, unknown> | null,
  scripts: Record<string, string>,
  t: Messages,
): { changes: string[]; clashes: string[] } {
  const current = scriptsOf(pkg);
  const changes: string[] = [];
  const clashes: string[] = [];
  for (const [name, command] of Object.entries(scripts)) {
    const found = Object.hasOwn(current, name) ? current[name] : undefined;
    if (found === command) continue;
    if (found === undefined || found.includes(FLOW_OWNED)) changes.push(t.setup.scriptSet(name));
    else clashes.push(name);
  }
  return { changes, clashes };
}

/**
 * Drops `issue:start:free` when the repo has its own `issue:start` (a wrapper): the shortcut
 * would skip it. The one note says so if the repo already had the flow's.
 * @param pkg - The package.json, or null if there is none.
 * @param scripts - The shortcuts to offer.
 * @param t - The messages, for the note.
 * @returns The shortcuts to write and the notes.
 */
export function pickScripts(
  pkg: Record<string, unknown> | null,
  scripts: Record<string, string>,
  t: Messages,
): { scripts: Record<string, string>; kept: string[] } {
  const current = scriptsOf(pkg);
  const flows = (command: string | undefined): boolean =>
    command !== undefined && (command.includes(FLOW_OWNED) || Object.values(LEGACY_SCRIPTS).includes(command));
  const start = current[START_SCRIPT];
  if (start === undefined || flows(start)) return { scripts: { ...scripts }, kept: [] };
  const { [FREE_SCRIPT]: _free, ...offered } = scripts;
  return { scripts: offered, kept: flows(current[FREE_SCRIPT]) ? [t.setup.keptFree(FREE_SCRIPT, START_SCRIPT)] : [] };
}
