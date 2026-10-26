/**
 * @file `issue-flow doctor [--json]`: whether the repo's flow files are as `init` leaves
 * them, at this version: the config, the dev dependencies and the hooks. It changes nothing;
 * each problem says what fixes it. `--json` prints the checks for `@ramon-sg/agent-kit`,
 * which adds those of the skills and the other tools.
 */
import { ConfigError } from "../config-base.js";
import { loadConfig } from "../config.js";
import { locateRepo } from "../git.js";
import type { Output } from "../output.js";
import { dependencyVersion } from "../package-edits.js";
import { hookVersions } from "../settings-hooks.js";
import { ownVersions, PACKAGE, readJson, SETTINGS_FILE, SetupError } from "../setup-files.js";

/** One check: whether it passed, and what it found or what fixes it. */
interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/** What fixes every problem: it runs init or upgrade at the right version. */
const RUN_AGENT_KIT = "run npx @ramon-sg/agent-kit";

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
    { name: PACKAGE, ok: flow === version, detail: flow === null ? `not in package.json: ${RUN_AGENT_KIT}` : flow === version ? version : `package.json has ${flow}, this is ${version}: ${RUN_AGENT_KIT}` },
    { name: "@ramon-sg/github-rest", ok: rest !== null, detail: rest ?? `not in package.json, and the skills call it: ${RUN_AGENT_KIT}` },
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
    detail: found === null ? `not in ${SETTINGS_FILE}: ${RUN_AGENT_KIT}` : found === version ? version : `at ${found}, this is ${version}: ${RUN_AGENT_KIT}`,
  }));
}

/**
 * Checks the repo; see the file's header.
 * @param cwd - Where it runs.
 * @param json - Whether to print the checks as JSON.
 * @param out - Where to write.
 * @returns 0 if everything passes, 1 if not.
 * @throws SetupError outside a checkout.
 * @example doctor(process.cwd(), false, out)
 */
export function doctor(cwd: string, json: boolean, out: Output): number {
  const located = locateRepo(cwd);
  if (located === null) throw new SetupError("run doctor inside a checkout of the repo.");
  const root = located.mainRoot;
  const { issueFlow } = ownVersions();
  const checks = [configCheck(root), ...packageChecks(root, issueFlow), ...hookChecks(root, issueFlow)];
  if (json) out.stdout(`${JSON.stringify(checks)}\n`);
  else for (const check of checks) out.stdout(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}\n`);
  return checks.every((check) => check.ok) ? 0 : 1;
}
