/**
 * @file `issue-flow doctor`: whether the repo is set up as `init` leaves it, at this
 * version. It checks the config, the dev dependencies, the hooks, the tag of the flow's
 * skills, and `claude-repo-guard` (its own doctor and, on macOS, `weakerNetworkIsolation`,
 * which `gh` needs inside the sandbox). It changes nothing; each problem says what fixes it.
 */
import { ConfigError, isObject } from "../config-base.js";
import { loadConfig } from "../config.js";
import { locateRepo } from "../git.js";
import { WEAKER_NETWORK } from "../guard-config.js";
import type { Output } from "../output.js";
import { dependencyVersion } from "../package-edits.js";
import { hookVersions } from "../settings-hooks.js";
import {
  captureNpx,
  flowSkills,
  GUARD_CONFIG,
  GUARD_SPEC,
  ownVersions,
  PACKAGE,
  readJson,
  SETTINGS_FILE,
  SetupError,
  SKILLS_LOCK,
} from "../setup-files.js";

/** One check: whether it passed, and what it found or what fixes it. */
interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/** What fixes most problems. */
const RUN_INIT = "run issue-flow init";

/**
 * Checks the config.
 * @param root - The repo.
 * @returns The check.
 */
function configCheck(root: string): Check {
  try {
    loadConfig(root);
    return { name: ".agents/flow.json", ok: true, detail: "valid" };
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return { name: ".agents/flow.json", ok: false, detail: error.message };
  }
}

/**
 * Checks the dev dependencies: `issue-flow` at this version and `github-rest`, which the
 * skills call.
 * @param root - The repo.
 * @param version - This package's version.
 * @returns The checks.
 */
function packageChecks(root: string, version: string): Check[] {
  const pkg = readJson(root, "package.json");
  const flow = dependencyVersion(pkg, PACKAGE);
  const rest = dependencyVersion(pkg, "@ramon-sg/github-rest");
  return [
    { name: PACKAGE, ok: flow === version, detail: flow === null ? `not in package.json: ${RUN_INIT}` : flow === version ? version : `package.json has ${flow}, this is ${version}: run issue-flow upgrade` },
    { name: "@ramon-sg/github-rest", ok: rest !== null, detail: rest ?? `not in package.json, and the skills call it: ${RUN_INIT}` },
  ];
}

/**
 * Checks that each hook is there at this version.
 * @param root - The repo.
 * @param version - This package's version.
 * @returns The checks.
 */
function hookChecks(root: string, version: string): Check[] {
  return Object.entries(hookVersions(readJson(root, SETTINGS_FILE))).map(([event, found]) => ({
    name: `${event} hook`,
    ok: found === version,
    detail: found === null ? `not in ${SETTINGS_FILE}: ${RUN_INIT}` : found === version ? version : `at ${found}, this is ${version}: run issue-flow upgrade`,
  }));
}

/**
 * Checks that the flow's skills are at this version's tag: they call this CLI, so they go
 * together.
 * @param root - The repo.
 * @param version - This package's version.
 * @returns The check.
 */
function skillsCheck(root: string, version: string): Check {
  const skills = flowSkills(readJson(root, SKILLS_LOCK));
  const tag = `v${version}`;
  const off = skills.filter((skill) => skill.tag !== tag);
  if (skills.length === 0) return { name: "flow skills", ok: false, detail: `none in ${SKILLS_LOCK}: ${RUN_INIT}` };
  if (off.length === 0) return { name: "flow skills", ok: true, detail: `${skills.length} at ${tag}` };
  return { name: "flow skills", ok: false, detail: `${off.map((skill) => `${skill.name} at ${skill.tag ?? "no tag"}`).join(", ")}, this is ${tag}: run issue-flow upgrade` };
}

/**
 * Checks `claude-repo-guard`, if the repo has it: its own doctor and, on macOS, the option
 * `gh` needs.
 * @param root - The repo.
 * @returns The checks.
 */
function guardChecks(root: string): Check[] {
  const options = readJson(root, GUARD_CONFIG);
  if (options === null) return [{ name: "claude-repo-guard", ok: true, detail: "not installed (Claude opens with your own permissions)" }];
  const checks: Check[] = [];
  if (process.platform === "darwin" && options[WEAKER_NETWORK] !== true)
    checks.push({ name: WEAKER_NETWORK, ok: false, detail: `not true in ${GUARD_CONFIG}, so gh fails inside the macOS sandbox: ${RUN_INIT}` });
  const result = captureNpx(root, [GUARD_SPEC, "doctor", "--json"]);
  let found: unknown;
  try {
    found = JSON.parse(result?.out ?? "");
  } catch {
    found = null;
  }
  if (!Array.isArray(found)) return [...checks, { name: "claude-repo-guard", ok: false, detail: `could not run its doctor; run 'npx ${GUARD_SPEC} doctor'` }];
  const failed = found.filter((check: unknown) => !isObject(check) || check.ok !== true).map((check: unknown) => (isObject(check) ? check : { name: "?", detail: String(check) }));
  if (failed.length === 0) return [...checks, { name: "claude-repo-guard", ok: true, detail: "its doctor passes" }];
  return [...checks, ...failed.map((check) => ({ name: `claude-repo-guard: ${String(check.name)}`, ok: false, detail: String(check.detail) }))];
}

/**
 * Checks the repo; see the file's header.
 * @param cwd - Where it runs.
 * @param out - Where to write.
 * @returns 0 if everything passes, 1 if not.
 * @throws SetupError outside a checkout.
 * @example doctor(process.cwd(), out)
 */
export function doctor(cwd: string, out: Output): number {
  const located = locateRepo(cwd);
  if (located === null) throw new SetupError("run doctor inside a checkout of the repo.");
  const root = located.mainRoot;
  const { issueFlow } = ownVersions();
  const checks = [configCheck(root), ...packageChecks(root, issueFlow), ...hookChecks(root, issueFlow), skillsCheck(root, issueFlow), ...guardChecks(root)];
  for (const check of checks) out.stdout(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}\n`);
  return checks.every((check) => check.ok) ? 0 : 1;
}
