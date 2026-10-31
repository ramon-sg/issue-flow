/**
 * @file `issue-flow upgrade [--dry-run]`: moves the repo's flow files to the version that
 * runs: `@ramon-sg/issue-flow`, the hooks and the config's schema to it, and `github-rest`
 * and `skills-manager` up to the versions it was tested with only if they fall short (a
 * newer one, or a range that allows it, is kept and reported). `agent-kitchen` runs it as `npx @ramon-sg/issue-flow@<version> upgrade` and then
 * moves the flow's skills to the same tag, because the skills call this CLI.
 */
import { CONFIG_PATH } from "../config-base.js";
import { checkoutRoot, locateRepo } from "../git.js";
import { type Output, warn } from "../output.js";
import { dependencyVersion, isNewer, KEPT, withFlowPackages } from "../package-edits.js";
import { hookVersions, registerHooks } from "../settings-hooks.js";
import { FLOW_REPO, ownVersions, PACKAGE, packageManager, readJson, SETTINGS_FILE, SetupError, writeJson } from "../setup-files.js";
import { schemaUrl } from "./init.js";

/** Options of `issue-flow upgrade`. */
export interface UpgradeOptions {
  cwd: string;
  dryRun: boolean;
}

/** The start of the schema URL `init` writes, at any version. */
const SCHEMA_PREFIX = `https://raw.githubusercontent.com/${FLOW_REPO}/`;

/**
 * The newest version of the flow the repo already has, in package.json or a hook.
 * @param root - The repo.
 * @returns The version, or null if it has none.
 */
function repoVersion(root: string): string | null {
  const found = [dependencyVersion(readJson(root, "package.json"), PACKAGE), ...Object.values(hookVersions(readJson(root, SETTINGS_FILE)))];
  return found.filter((version): version is string => version !== null).reduce<string | null>((newest, version) => (newest === null || isNewer(version, newest) ? version : newest), null);
}

/**
 * Moves the repo's flow files to this version; see the file's header.
 * @param options - The options.
 * @param out - Where to write.
 * @returns 0.
 * @throws SetupError outside the main checkout, if a file is broken, or if the repo is
 * already at a newer version (a stale local copy must not move it back).
 * @example upgrade({ cwd, dryRun: false }, out)
 */
export function upgrade(options: UpgradeOptions, out: Output): number {
  const located = locateRepo(options.cwd);
  if (located === null) throw new SetupError("run upgrade inside a checkout of the repo.");
  const root = located.mainRoot;
  if (checkoutRoot(options.cwd) !== root) throw new SetupError(`run upgrade in the main checkout, ${root}, not in a worktree.`);
  const versions = ownVersions();
  const current = repoVersion(root);
  if (current !== null && isNewer(current, versions.issueFlow))
    throw new SetupError(`the repo is at issue-flow ${current}, newer than this ${versions.issueFlow}; run 'npx ${PACKAGE}@${current.replace(/^[\^~=]/, "")} upgrade' or 'npx agent-kitchen apply'.`);
  const writes: { path: string; value: Record<string, unknown> }[] = [];
  const lines: string[] = [];
  const pkg = withFlowPackages(readJson(root, "package.json"), versions, true);
  const kept = pkg.changes.filter((change) => change.startsWith(KEPT));
  const moved = pkg.changes.filter((change) => !change.startsWith(KEPT));
  for (const change of kept) warn(out, `package.json: ${change}`);
  if (moved.length > 0) writes.push({ path: "package.json", value: pkg.pkg });
  lines.push(...moved.map((change) => `package.json: ${change}`));
  const hooks = registerHooks(readJson(root, SETTINGS_FILE), versions.issueFlow);
  if (hooks.changes.length > 0) writes.push({ path: SETTINGS_FILE, value: hooks.settings });
  lines.push(...hooks.changes.map((change) => `${SETTINGS_FILE}: ${change}`));
  const config = readJson(root, CONFIG_PATH);
  if (config !== null && typeof config.$schema === "string" && config.$schema.startsWith(SCHEMA_PREFIX) && config.$schema !== schemaUrl(versions.issueFlow)) {
    writes.push({ path: CONFIG_PATH, value: { ...config, $schema: schemaUrl(versions.issueFlow) } });
    lines.push(`${CONFIG_PATH}: $schema at v${versions.issueFlow}`);
  }
  out.stdout(lines.length === 0 ? `Already at issue-flow ${versions.issueFlow}.\n` : `To issue-flow ${versions.issueFlow}:\n${lines.map((line) => `  ${line}\n`).join("")}`);
  if (options.dryRun || writes.length === 0) return 0;
  for (const write of writes) writeJson(root, write.path, write.value);
  out.stdout(`Next: run '${packageManager(root, readJson(root, "package.json"))} install', review the diff and commit it.\n`);
  return 0;
}
