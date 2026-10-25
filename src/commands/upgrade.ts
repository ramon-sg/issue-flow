/**
 * @file `issue-flow upgrade [--to <version>] [--dry-run]`: moves the repo to another version
 * of the flow, the latest on npm by default. The CLI and the flow's skills go together,
 * because the skills call the CLI: it moves the dev dependencies to the ones that version
 * pins, the hooks and the config's schema to it, and the flow's catalog in the skills
 * manifest to its tag, and then runs `skills-manager update` on the flow's skills only (the
 * general ones keep their own versions). The versions come from npm, not from the CLI
 * that runs, which may be the old one.
 */
import { spawnSync } from "node:child_process";
import { CONFIG_PATH, isObject } from "../config-base.js";
import { checkoutRoot, locateRepo } from "../git.js";
import type { Output } from "../output.js";
import { withFlowPackages } from "../package-edits.js";
import { registerHooks } from "../settings-hooks.js";
import {
  FLOW_CATALOG,
  flowSkills,
  type OwnVersions,
  PACKAGE,
  packageManager,
  readJson,
  runNpx,
  SETTINGS_FILE,
  SetupError,
  SKILLS_LOCK,
  SKILLS_MANIFEST,
  writeJson,
} from "../setup-files.js";
import { schemaUrl } from "./init.js";

/** Options of `issue-flow upgrade`. */
export interface UpgradeOptions {
  cwd: string;
  to: string | null;
  dryRun: boolean;
}

/** A release version. */
const VERSION = /^\d+\.\d+\.\d+$/;

/** The start of the schema URL `init` writes, at any version. */
const SCHEMA_PREFIX = `https://raw.githubusercontent.com/${FLOW_CATALOG}/`;

/**
 * The versions a release of this package pins, from npm.
 * @param to - The version, or null for the latest.
 * @returns The versions.
 * @throws SetupError if npm cannot tell, or the release lacks them.
 */
function releaseVersions(to: string | null): OwnVersions {
  const spec = `${PACKAGE}@${to ?? "latest"}`;
  const result = spawnSync("npm", ["view", spec, "version", "dependencies", "devDependencies", "--json"], { encoding: "utf8" });
  let info: unknown;
  try {
    info = JSON.parse(result.stdout);
  } catch {
    info = null;
  }
  if (result.status !== 0 || !isObject(info)) throw new SetupError(`npm could not find ${spec}${result.stderr ? `: ${result.stderr.trim()}` : "."}`);
  const deps = isObject(info.dependencies) ? info.dependencies : {};
  const devDeps = isObject(info.devDependencies) ? info.devDependencies : {};
  const githubRest = deps["@ramon-sg/github-rest"];
  const skillsManager = devDeps["@ramon-sg/skills-manager"];
  if (typeof info.version !== "string" || !VERSION.test(info.version) || typeof githubRest !== "string" || typeof skillsManager !== "string")
    throw new SetupError(`${spec} on npm lacks its version or those of github-rest and skills-manager.`);
  return { issueFlow: info.version, githubRest, skillsManager };
}

/**
 * The skills manifest with the flow's catalog at a tag.
 * @param manifest - The manifest, or null.
 * @param tag - The tag.
 * @returns The new manifest and whether it changed, or null if the flow's catalog is not in it.
 */
function movedManifest(manifest: Record<string, unknown> | null, tag: string): { manifest: Record<string, unknown>; changed: boolean } | null {
  const sources = Array.isArray(manifest?.sources) ? manifest.sources : [];
  const index = sources.findIndex((source) => isObject(source) && source.catalog === FLOW_CATALOG);
  const source = sources[index];
  if (manifest === null || !isObject(source)) return null;
  if (source.ref === tag) return { manifest, changed: false };
  return { manifest: { ...manifest, sources: sources.map((item, at) => (at === index ? { ...source, ref: tag } : item)) }, changed: true };
}

/**
 * Moves the repo to another version of the flow; see the file's header.
 * @param options - The options.
 * @param out - Where to write.
 * @returns 0, or 1 if `skills-manager` failed.
 * @throws SetupError outside the main checkout, if npm cannot tell the version or a file is broken.
 * @example upgrade({ cwd, to: null, dryRun: false }, out)
 */
export function upgrade(options: UpgradeOptions, out: Output): number {
  const located = locateRepo(options.cwd);
  if (located === null) throw new SetupError("run upgrade inside a checkout of the repo.");
  const root = located.mainRoot;
  if (checkoutRoot(options.cwd) !== root) throw new SetupError(`run upgrade in the main checkout, ${root}, not in a worktree.`);
  if (options.to !== null && !VERSION.test(options.to)) throw new SetupError(`--to expects a version like 0.2.0: ${options.to}`);
  const versions = releaseVersions(options.to);
  const tag = `v${versions.issueFlow}`;
  const writes: { path: string; value: Record<string, unknown> }[] = [];
  const lines: string[] = [];
  const pkg = withFlowPackages(readJson(root, "package.json"), versions, true);
  if (pkg.changes.length > 0) writes.push({ path: "package.json", value: pkg.pkg });
  lines.push(...pkg.changes.map((change) => `package.json: ${change}`));
  const hooks = registerHooks(readJson(root, SETTINGS_FILE), versions.issueFlow);
  if (hooks.changes.length > 0) writes.push({ path: SETTINGS_FILE, value: hooks.settings });
  lines.push(...hooks.changes.map((change) => `${SETTINGS_FILE}: ${change}`));
  const config = readJson(root, CONFIG_PATH);
  if (config !== null && typeof config.$schema === "string" && config.$schema.startsWith(SCHEMA_PREFIX) && config.$schema !== schemaUrl(versions.issueFlow)) {
    writes.push({ path: CONFIG_PATH, value: { ...config, $schema: schemaUrl(versions.issueFlow) } });
    lines.push(`${CONFIG_PATH}: $schema at ${tag}`);
  }
  const manifest = movedManifest(readJson(root, SKILLS_MANIFEST), tag);
  if (manifest?.changed === true) {
    writes.push({ path: SKILLS_MANIFEST, value: manifest.manifest });
    lines.push(`${SKILLS_MANIFEST}: ${FLOW_CATALOG} at ${tag}`);
  }
  const skills = flowSkills(readJson(root, SKILLS_LOCK)).map((skill) => skill.name);
  out.stdout(lines.length === 0 ? `Already at issue-flow ${versions.issueFlow}.\n` : `To issue-flow ${versions.issueFlow}:\n${lines.map((line) => `  ${line}\n`).join("")}`);
  if (manifest === null) out.stdout(`  the flow's skills are not in ${SKILLS_MANIFEST}: issue-flow init installs them\n`);
  if (options.dryRun) return 0;
  for (const write of writes) writeJson(root, write.path, write.value);
  const updated = manifest === null || skills.length === 0 || runNpx(root, [`@ramon-sg/skills-manager@${versions.skillsManager}`, "update", ...skills]);
  if (!updated) out.stderr(`issue-flow: skills-manager update failed; run 'npx @ramon-sg/skills-manager@${versions.skillsManager} update ${skills.join(" ")}' to retry.\n`);
  out.stdout(`Next: run '${packageManager(root, readJson(root, "package.json"))} install', review the diff and commit it.\n`);
  return updated ? 0 : 1;
}
