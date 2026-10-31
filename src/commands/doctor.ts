/**
 * @file `issue-flow doctor [--json]`: whether the repo's flow files are as `apply` leaves
 * them, at this version: the config and its `$schema`, the dev dependencies and the hooks.
 * It changes nothing; each problem says what fixes it: `npx agent-kitchen apply` when the
 * repo pins another issue-flow (it also moves the skills), and `issue-flow apply` when the
 * version is this one but its files fell behind. `--json` prints the checks for `agent-kitchen`,
 * which adds those of the skills and the other tools.
 */
import { CONFIG_PATH, ConfigError } from "../config-base.js";
import { loadConfig } from "../config.js";
import { locateRepo } from "../git.js";
import type { Output } from "../output.js";
import { dependencyVersion, GITHUB_REST, reaches } from "../package-edits.js";
import { hookVersions } from "../settings-hooks.js";
import { isStaleSchema, ownVersions, PACKAGE, readJson, SETTINGS_FILE, SetupError } from "../setup-files.js";

/** One check: whether it passed, and what it found or what fixes it. */
interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/** What fixes a repo at another version: it runs apply at the right one and moves the skills. */
const RUN_AGENT_KITCHEN = "run npx agent-kitchen apply";

/** What fixes the files of a repo already at this version. */
const RUN_APPLY = `run npx ${PACKAGE} apply`;

/**
 * What fixes a problem: `issue-flow apply` if the repo pins this version, else agent-kitchen.
 * @param pinned - The issue-flow the repo pins, or null.
 * @param version - This package's version.
 * @returns The hint.
 */
function fix(pinned: string | null, version: string): string {
  return pinned === version ? RUN_APPLY : RUN_AGENT_KITCHEN;
}

/**
 * Checks the config, and that its `$schema` (if it is the flow's) is at this version.
 * @param root - The repo.
 * @param hint - What fixes a stale `$schema`.
 * @param version - This package's version.
 * @returns The check.
 */
function configCheck(root: string, hint: string, version: string): Check {
  try {
    loadConfig(root);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return { name: CONFIG_PATH, ok: false, detail: error.message };
  }
  const stale = isStaleSchema(readJson(root, CONFIG_PATH)?.$schema, version);
  return stale ? { name: CONFIG_PATH, ok: false, detail: `valid, but its $schema is not at v${version}: ${hint}` } : { name: CONFIG_PATH, ok: true, detail: "valid" };
}

/**
 * Checks the dev dependencies: `issue-flow` at this version and `github-rest`, which the
 * skills call, at the version the flow needs or newer.
 * @param root - The repo.
 * @param versions - This package's version and the lowest github-rest.
 * @returns The checks.
 */
function packageChecks(root: string, versions: { issueFlow: string; githubRest: string }): Check[] {
  const pkg = readJson(root, "package.json");
  const flow = dependencyVersion(pkg, PACKAGE);
  const rest = dependencyVersion(pkg, GITHUB_REST);
  const version = versions.issueFlow;
  const restDetail = rest === null ? `not in package.json, and the skills call it: ${fix(flow, version)}` : reaches(rest, versions.githubRest) ? rest : `${rest}, and the skills need ${versions.githubRest} or newer: raise it in package.json`;
  return [
    { name: PACKAGE, ok: flow === version, detail: flow === null ? `not in package.json: ${RUN_AGENT_KITCHEN}` : flow === version ? version : `package.json has ${flow}, this is ${version}: ${RUN_AGENT_KITCHEN}` },
    { name: GITHUB_REST, ok: rest !== null && reaches(rest, versions.githubRest), detail: restDetail },
  ];
}

/**
 * Checks that each hook is there at this version.
 * @param root - The repo.
 * @param version - This package's version.
 * @param hint - What fixes a missing or stale hook.
 * @returns The checks.
 */
function hookChecks(root: string, version: string, hint: string): Check[] {
  return Object.entries(hookVersions(readJson(root, SETTINGS_FILE))).map(([event, found]) => ({
    name: `${event} hook`,
    ok: found === version,
    detail: found === null ? `not in ${SETTINGS_FILE}: ${hint}` : found === version ? version : `at ${found}, this is ${version}: ${hint}`,
  }));
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
  const located = locateRepo(cwd);
  if (located === null) throw new SetupError("run doctor inside a checkout of the repo.");
  const root = located.mainRoot;
  const versions = ownVersions();
  let checks: Check[];
  try {
    const hint = fix(dependencyVersion(readJson(root, "package.json"), PACKAGE), versions.issueFlow);
    checks = [configCheck(root, hint, versions.issueFlow), ...packageChecks(root, versions), ...hookChecks(root, versions.issueFlow, hint)];
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    checks = [{ name: "files", ok: false, detail: error.message }];
  }
  if (json) out.stdout(`${JSON.stringify(checks)}\n`);
  else for (const check of checks) out.stdout(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}\n`);
  return checks.every((check) => check.ok) ? 0 : 1;
}
