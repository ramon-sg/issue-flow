/**
 * @file `issue-flow init`: sets a repo up for the flow, and can run again to fill in what
 * is missing. It writes `.agents/flow.json` (from `paseo.json` if the repo has one, plus the
 * recipes it picks), the flow's dev dependencies and scripts in `package.json`, and the
 * `SessionStart`, `WorktreeCreate` and `WorktreeRemove` hooks. Then, each after asking, it
 * runs `claude-cloud init`, installs `claude-repo-guard` with what the flow needs in its
 * options, and opens the skills menu of `skills-manager` with the two catalogs (`init` if
 * the repo has no manifest, `add` if it has one, because `init` stops then). A tool that
 * fails is reported and the rest goes on.
 */
import { confirm } from "../ask.js";
import { CONFIG_PATH, isObject } from "../config-base.js";
import { parseConfig } from "../config.js";
import { checkoutRoot, locateRepo } from "../git.js";
import { guardOptions } from "../guard-config.js";
import { type Output, UsageError, warn } from "../output.js";
import { withFlowPackages } from "../package-edits.js";
import { applyRecipe, detectedRecipes, loadRecipes, projectPrefix, type Recipe } from "../recipes.js";
import { registerHooks } from "../settings-hooks.js";
import {
  CLOUD_SPEC,
  FLOW_CATALOG,
  GENERAL_CATALOG,
  GUARD_CONFIG,
  GUARD_SPEC,
  type OwnVersions,
  ownVersions,
  packageManager,
  readJson,
  runNpx,
  SETTINGS_FILE,
  SetupError,
  SKILLS_MANIFEST,
  writeJson,
} from "../setup-files.js";

/** Options of `issue-flow init`. */
export interface InitOptions {
  cwd: string;
  yes: boolean;
  recipes: string[] | null;
  skills: boolean;
  guard: boolean;
  cloud: boolean;
}

/** The skills picked without a terminal: the flow's, and the audit `close-pr` uses. */
const DEFAULT_SKILLS = [
  ...["github-issues", "start-issue", "close-pr", "pr-review-comments", "pr-worktree"].map((name) => `catalog:${FLOW_CATALOG}/${name}`),
  `catalog:${GENERAL_CATALOG}/code-audit`,
];

/**
 * The URL of the config's schema at a version.
 * @param version - This package's version.
 * @returns The URL.
 * @example schemaUrl("0.1.0") // "https://raw.githubusercontent.com/ramon-sg/issue-flow/v0.1.0/schema.json"
 */
export function schemaUrl(version: string): string {
  return `https://raw.githubusercontent.com/${FLOW_CATALOG}/v${version}/schema.json`;
}

/**
 * A new config: the schema, and the branch rules of `paseo.json` if the repo has one.
 * @param root - The repo.
 * @param version - This package's version.
 * @returns The config and what it took from `paseo.json`.
 */
function freshConfig(root: string, version: string): { raw: Record<string, unknown>; changes: string[] } {
  const raw: Record<string, unknown> = { $schema: schemaUrl(version) };
  const issues = readJson(root, "paseo.json")?.project;
  const paseo = isObject(issues) && isObject(issues.issues) ? issues.issues : null;
  if (paseo === null) return { raw, changes: ["new"] };
  const branch: Record<string, unknown> = {};
  if (typeof paseo.branchTemplate === "string") branch.template = paseo.branchTemplate;
  if (isObject(paseo.types)) branch.types = paseo.types;
  if (Object.keys(branch).length > 0) raw.branch = branch;
  return { raw, changes: ["new, with the branch rules of paseo.json"] };
}

/**
 * The recipes to apply: the ones named with `--recipe`, or each one the repo's files
 * suggest, after asking (all of them with `--yes`).
 * @param root - The repo.
 * @param options - The options.
 * @param out - Where to ask.
 * @returns The recipes.
 * @throws UsageError if `--recipe` names one that does not exist.
 */
async function pickRecipes(root: string, options: InitOptions, out: Output): Promise<Recipe[]> {
  const recipes = loadRecipes();
  if (options.recipes !== null) {
    const unknown = options.recipes.find((name) => !recipes.some((recipe) => recipe.name === name));
    if (unknown !== undefined) throw new UsageError(`unknown recipe ${unknown}; there are ${recipes.map((recipe) => recipe.name).join(", ")}.`);
    return recipes.filter((recipe) => options.recipes?.includes(recipe.name));
  }
  const picked: Recipe[] = [];
  for (const recipe of recipes.filter((item) => detectedRecipes(root, recipes).includes(item.name)))
    if (options.yes || (await confirm(out, `Recipe ${recipe.name}: ${recipe.description} Add it?`))) picked.push(recipe);
  return picked;
}

/** A file `init` writes, with what changes in it and what it keeps as the repo had it. */
interface Planned {
  path: string;
  value: Record<string, unknown>;
  changes: string[];
  kept: string[];
}

/** How a line of a change that keeps what the repo had starts. */
const KEPT = "kept ";

/**
 * What `init` would write: the config, `package.json` and the settings' hooks.
 * @param root - The repo.
 * @param versions - This package's versions.
 * @param recipes - The recipes to apply.
 * @returns The files that change.
 * @throws ConfigError if the resulting config is invalid; SetupError if a file is broken.
 */
function plan(root: string, versions: OwnVersions, recipes: Recipe[]): Planned[] {
  const existing = readJson(root, CONFIG_PATH);
  const start = existing === null ? freshConfig(root, versions.issueFlow) : { raw: existing, changes: [] as string[] };
  let { raw } = start;
  const configChanges = [...start.changes];
  for (const recipe of recipes) {
    const applied = applyRecipe(raw, recipe, projectPrefix(root));
    raw = applied.raw;
    configChanges.push(...applied.changes.map((change) => (change.startsWith(KEPT) ? `${change} (${recipe.name})` : `${recipe.name}: ${change}`)));
  }
  parseConfig(raw);
  const pkg = withFlowPackages(readJson(root, "package.json"), versions, false);
  const hooks = registerHooks(readJson(root, SETTINGS_FILE), versions.issueFlow);
  const file = (path: string, value: Record<string, unknown>, lines: string[]): Planned => ({
    path,
    value,
    changes: lines.filter((line) => !line.startsWith(KEPT)).map((line) => `${path}: ${line}`),
    kept: lines.filter((line) => line.startsWith(KEPT)).map((line) => `${path}: ${line}`),
  });
  return [file(CONFIG_PATH, raw, configChanges), file("package.json", pkg.pkg, pkg.changes), file(SETTINGS_FILE, hooks.settings, hooks.changes)];
}

/**
 * Runs one of the other tools after asking, and says if it failed.
 * @param step - What it is and how it runs.
 * @param options - The options.
 * @param out - Where to ask and write.
 * @returns False if it ran and failed.
 */
async function external(step: { question: string; run: () => boolean; failed: string }, options: InitOptions, out: Output): Promise<boolean> {
  if (!options.yes && !(await confirm(out, step.question))) return true;
  if (step.run()) return true;
  warn(out, step.failed);
  return false;
}

/**
 * Installs `claude-repo-guard`, after writing in its options what the flow needs.
 * @param root - The repo.
 * @param out - Where to write.
 * @returns Whether it installed.
 */
function installGuard(root: string, out: Output): boolean {
  const flow = readJson(root, CONFIG_PATH);
  const baseBranch = typeof flow?.baseBranch === "string" ? flow.baseBranch : null;
  const { options, changes } = guardOptions(readJson(root, GUARD_CONFIG), baseBranch, process.platform);
  if (changes.length > 0) writeJson(root, GUARD_CONFIG, options);
  for (const change of changes) out.stdout(`  ${change}\n`);
  return runNpx(root, [GUARD_SPEC, "install", "--yes"]);
}

/**
 * The ids of the default skills the manifest does not take yet: `skills-manager` leaves the
 * ones it has out of the candidates, and fails if `--select` names one.
 * @param manifest - The skills manifest, or null.
 * @returns The ids to pick.
 */
function missingDefaults(manifest: Record<string, unknown> | null): string[] {
  const sources = Array.isArray(manifest?.sources) ? manifest.sources.filter(isObject) : [];
  const taken = new Set(sources.flatMap((source) => (typeof source.catalog === "string" && Array.isArray(source.skills) ? source.skills.map((name) => `catalog:${String(source.catalog)}/${String(name)}`) : [])));
  return DEFAULT_SKILLS.filter((id) => !taken.has(id));
}

/**
 * Opens the skills menu with the flow's catalog, at this version, and the general one; without
 * a terminal or with `--yes`, it picks the flow's skills and `code-audit` that are not there yet.
 * @param root - The repo.
 * @param versions - This package's versions.
 * @param pick - Whether to pick without the menu.
 * @param out - Where to say there is nothing to add.
 * @returns Whether `skills-manager` worked, or true if there was nothing to pick.
 */
function installSkills(root: string, versions: OwnVersions, pick: boolean, out: Output): boolean {
  const manifest = readJson(root, SKILLS_MANIFEST);
  const command = manifest === null ? "init" : "add";
  const args = [`@ramon-sg/skills-manager@${versions.skillsManager}`, command, "--catalog", `${FLOW_CATALOG}#v${versions.issueFlow}`, "--catalog", GENERAL_CATALOG];
  if (!pick) return runNpx(root, args);
  const missing = missingDefaults(manifest);
  if (missing.length === 0) {
    out.stdout(`The flow's skills and code-audit are already in ${SKILLS_MANIFEST}.\n`);
    return true;
  }
  return runNpx(root, [...args, "--select", missing.join(",")]);
}

/**
 * Sets the repo up for the flow; see the file's header.
 * @param options - The options.
 * @param out - Where to write and ask.
 * @returns 0, or 1 if a file was not written or another tool failed.
 * @throws SetupError outside the main checkout or with a broken file; ConfigError if the
 * config would be invalid; UsageError for an unknown recipe.
 * @example await init({ cwd, yes: true, recipes: null, skills: true, guard: true, cloud: true }, out)
 */
export async function init(options: InitOptions, out: Output): Promise<number> {
  const located = locateRepo(options.cwd);
  if (located === null) throw new SetupError("run init inside a checkout of the repo.");
  if (checkoutRoot(options.cwd) !== located.mainRoot) throw new SetupError(`run init in the main checkout, ${located.mainRoot}, not in a worktree.`);
  const root = located.mainRoot;
  const versions = ownVersions();
  const files = plan(root, versions, await pickRecipes(root, options, out)).filter((file) => file.changes.length > 0 || file.kept.length > 0);
  for (const line of files.flatMap((file) => file.kept)) warn(out, line);
  const lines = files.flatMap((file) => file.changes);
  if (lines.length === 0) out.stdout("The config, package.json and the hooks are already set up.\n");
  else out.stdout(`issue-flow ${versions.issueFlow} will write:\n${lines.map((line) => `  ${line}\n`).join("")}`);
  if (lines.length > 0 && !options.yes && !(await confirm(out, "Write it?"))) {
    warn(out, "nothing written.");
    return 1;
  }
  for (const file of files.filter((item) => item.changes.length > 0)) writeJson(root, file.path, file.value);
  const results = [
    !options.cloud || await external({ question: "Set up Claude cloud sessions with claude-cloud init?", run: () => runNpx(root, [CLOUD_SPEC, "init"]), failed: `claude-cloud init failed; run 'npx ${CLOUD_SPEC} init' to retry.` }, options, out),
    !options.guard || await external({ question: "Install claude-repo-guard (auto mode, with the sandbox)?", run: () => installGuard(root, out), failed: `claude-repo-guard did not install; run 'npx ${GUARD_SPEC} install' to retry.` }, options, out),
    !options.skills || await external({ question: "Pick the skills now?", run: () => installSkills(root, versions, options.yes || !out.interactive, out), failed: "skills-manager failed; run issue-flow init again to retry." }, options, out),
  ];
  const manager = packageManager(root, readJson(root, "package.json"));
  out.stdout(`Next: run '${manager} install', and commit .agents/, .claude/ and package.json.\n`);
  return results.every(Boolean) ? 0 : 1;
}
