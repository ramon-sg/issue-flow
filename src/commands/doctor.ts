/**
 * @file `issue-flow doctor [--json]`: whether the repo's flow files are as `apply` leaves
 * them, at this version: the config and its `$schema`, `.agents/runner.json` (valid, its
 * runner installed, `issue-flow` and `github-rest` pinned in it), that the hooks and the
 * `package.json` shortcuts run the pinned version with the repo's runner, and that the old
 * devDependencies are gone. It changes nothing; each problem says what fixes it:
 * `agent-kitchen apply` when the repo pins another issue-flow (it also moves the skills),
 * and `issue-flow apply` (with the runner of runner.json) when the version is this one but its files fell behind. `--json`
 * prints the checks for `agent-kitchen`, which adds those of the skills and the other tools.
 */
import { checkRunner, checkToolPins, effectiveRunner, type Check as LibraryCheck, type Runner, type RunnerConfig } from "@ramon-sg/runner";
import { CONFIG_PATH, ConfigError } from "../config-base.js";
import { loadConfig } from "../config.js";
import { locateRepo } from "../git.js";
import { type Messages, messages } from "../messages/index.js";
import type { Output } from "../output.js";
import { dependencyVersion, GITHUB_REST, reaches } from "../package-edits.js";
import { FLOW_OWNED, applyCommand, readRunnerFile } from "../runner-file.js";
import { HOOK_EVENTS, hookCommand, hookVersions, ourHookCommands } from "../settings-hooks.js";
import { isStaleSchema, ownVersions, PACKAGE, readJson, SETTINGS_FILE, SetupError } from "../setup-files.js";

/** One check: whether it passed, and what it found or what fixes it. */
interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * What fixes a problem: `issue-flow apply` if the repo pins this version, else agent-kitchen.
 * @param pinned - The issue-flow the repo pins, or null.
 * @param version - This package's version.
 * @param runner - The repo's runner, or null if `runner.json` cannot say.
 * @param t - The messages.
 * @returns The hint.
 */
function fix(pinned: string | null, version: string, runner: Runner | null, t: Messages): string {
  return pinned === version ? t.doctor.runApply(applyCommand(runner, version)) : t.doctor.runAgentKitchen;
}

/**
 * Checks the config, and that its `$schema` (if it is the flow's) is at this version.
 * @param root - The repo.
 * @param hint - What fixes a stale `$schema`.
 * @param version - This package's version.
 * @param t - The messages.
 * @returns The check.
 */
function configCheck(root: string, hint: string, version: string, t: Messages): Check {
  try {
    loadConfig(root, t);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return { name: CONFIG_PATH, ok: false, detail: error.message };
  }
  const stale = isStaleSchema(readJson(root, CONFIG_PATH, t)?.$schema, version);
  return stale ? { name: CONFIG_PATH, ok: false, detail: t.doctor.staleSchema(version, hint) } : { name: CONFIG_PATH, ok: true, detail: t.doctor.valid };
}

/**
 * Reads `runner.json` for the checks that need its entries.
 * @param root - The repo.
 * @returns The config (null if missing), or the error message if it cannot be used.
 */
function readRunner(root: string): { config: RunnerConfig | null } | { error: string } {
  try {
    return { config: readRunnerFile(root) };
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    return { error: error.message };
  }
}

/**
 * Turns the library's checks into ours: a warning passes, a failure does not.
 * @param checks - The library's checks.
 * @param name - The name to show, or undefined to keep the library's.
 * @returns Our checks.
 */
function fromLibrary(checks: LibraryCheck[], name?: string): Check[] {
  return checks.map((check) => ({ name: name ?? check.name, ok: check.status !== "fail", detail: check.detail }));
}

/**
 * Checks the tools pinned in `runner.json`: `issue-flow` at this version and `github-rest`,
 * which the skills call, at the version bundled inside or newer.
 * @param root - The repo.
 * @param versions - This package's version and the lowest github-rest.
 * @param t - The messages.
 * @returns The checks.
 */
function toolChecks(root: string, versions: { issueFlow: string; githubRest: string }, t: Messages): Check[] {
  const read = readRunner(root);
  if ("error" in read) return [PACKAGE, GITHUB_REST].map((name) => ({ name, ok: false, detail: read.error }));
  const tools = read.config?.tools ?? {};
  const runner = read.config === null ? null : effectiveRunner(read.config);
  const flow = Object.hasOwn(tools, PACKAGE) ? (tools[PACKAGE] ?? null) : null;
  const rest = Object.hasOwn(tools, GITHUB_REST) ? (tools[GITHUB_REST] ?? null) : null;
  const version = versions.issueFlow;
  const restDetail = rest === null ? t.doctor.restMissing(fix(flow, version, runner, t)) : reaches(rest, versions.githubRest) ? rest : t.doctor.restOld(rest, versions.githubRest);
  return [
    { name: PACKAGE, ok: flow === version, detail: flow === null ? t.doctor.flowMissing(t.doctor.runAgentKitchen) : flow === version ? version : t.doctor.flowOther(flow, version, t.doctor.runAgentKitchen) },
    { name: GITHUB_REST, ok: rest !== null && reaches(rest, versions.githubRest), detail: restDetail },
  ];
}

/**
 * Checks that the hooks and the shortcuts name the version `runner.json` pins.
 * @param root - The repo.
 * @param settings - The repo's Claude Code settings, or null.
 * @param t - The messages.
 * @returns The checks.
 */
function pinChecks(root: string, settings: Record<string, unknown> | null, t: Messages): Check[] {
  const scripts = readJson(root, "package.json", t)?.scripts;
  const ours = typeof scripts === "object" && scripts !== null ? Object.values(scripts).filter((text): text is string => typeof text === "string" && text.includes(FLOW_OWNED)) : [];
  return fromLibrary(checkToolPins(root, PACKAGE, [...ourHookCommands(settings), ...ours]), t.doctor.pinsName);
}

/**
 * Checks that each hook is there, at this version and run by the repo's runner.
 * @param root - The repo.
 * @param settings - The repo's Claude Code settings, or null.
 * @param version - This package's version.
 * @param hint - What fixes a missing or stale hook.
 * @param t - The messages.
 * @returns The checks.
 */
function hookChecks(root: string, settings: Record<string, unknown> | null, version: string, hint: string, t: Messages): Check[] {
  const read = readRunner(root);
  const runner = effectiveRunner("config" in read ? read.config : null);
  const commands = ourHookCommands(settings);
  const versions = hookVersions(settings);
  return HOOK_EVENTS.map((event) => {
    const found = versions[event] ?? null;
    const name = t.doctor.hookName(event);
    if (found === null) return { name, ok: false, detail: t.doctor.hookMissing(SETTINGS_FILE, hint) };
    if (found !== version) return { name, ok: false, detail: t.doctor.hookAt(found, version, hint) };
    if (!commands.includes(hookCommand(event, runner, version))) return { name, ok: false, detail: t.doctor.hookRunner(runner, hint) };
    return { name, ok: true, detail: version };
  });
}

/**
 * Checks that the old devDependencies mode left nothing behind.
 * @param root - The repo.
 * @param hint - What fixes it.
 * @param t - The messages.
 * @returns The check.
 */
function legacyCheck(root: string, hint: string, t: Messages): Check {
  const pkg = readJson(root, "package.json", t);
  const left = [PACKAGE, GITHUB_REST].filter((name) => dependencyVersion(pkg, name) !== null);
  return { name: "devDependencies", ok: left.length === 0, detail: left.length === 0 ? t.doctor.noLegacy : t.doctor.legacyLeft(left.join(", "), hint) };
}

/**
 * Checks the repo; see the file's header.
 * @param cwd - Where it runs.
 * @param json - Whether to print the checks as JSON.
 * @param out - Where to write.
 * @returns 0 if everything passes, 1 if not.
 * @throws SetupError outside a checkout; a broken file is a failed check.
 * @example doctor(process.cwd(), false, out)
 */
export function doctor(cwd: string, json: boolean, out: Output): number {
  // NOTE: --json is read by agent-kitchen, so its checks are always in English.
  const t = json ? messages("en") : out.t;
  const located = locateRepo(cwd);
  if (located === null) throw new SetupError(t.doctor.insideCheckout);
  const root = located.mainRoot;
  const versions = ownVersions();
  let checks: Check[];
  try {
    const read = readRunner(root);
    const pinned = "config" in read ? (read.config?.tools[PACKAGE] ?? null) : null;
    const hint = fix(pinned, versions.issueFlow, "config" in read && read.config !== null ? effectiveRunner(read.config) : null, t);
    const settings = readJson(root, SETTINGS_FILE, t);
    checks = [
      configCheck(root, hint, versions.issueFlow, t),
      ...fromLibrary(checkRunner(root)),
      ...toolChecks(root, versions, t),
      ...pinChecks(root, settings, t),
      ...hookChecks(root, settings, versions.issueFlow, hint, t),
      legacyCheck(root, hint, t),
    ];
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    checks = [{ name: t.doctor.filesName, ok: false, detail: error.message }];
  }
  if (json) out.stdout(`${JSON.stringify(checks)}\n`);
  else for (const check of checks) out.stdout(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}\n`);
  return checks.every((check) => check.ok) ? 0 : 1;
}
