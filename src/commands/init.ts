/**
 * @file `issue-flow init`: sets a repo up for the flow, and can run again to fill in what
 * is missing. It writes `.agents/flow.json` (from `paseo.json` if the repo has one, plus the
 * recipes it picks), the flow's dev dependencies and scripts in `package.json`, and the
 * `SessionStart`, `WorktreeCreate` and `WorktreeRemove` hooks. Only the flow's own files:
 * the skills, `claude-cloud` and `claude-repo-guard` are installed by `agent-kitchen`,
 * which runs this command.
 */
import { confirm } from "../ask.js";
import { CONFIG_PATH, isObject } from "../config-base.js";
import { parseConfig } from "../config.js";
import { checkoutRoot, locateRepo } from "../git.js";
import { type Output, UsageError, warn } from "../output.js";
import { withFlowPackages } from "../package-edits.js";
import { applyRecipe, detectedRecipes, loadRecipes, projectPrefix, type Recipe } from "../recipes.js";
import { registerHooks } from "../settings-hooks.js";
import { FLOW_REPO, type OwnVersions, ownVersions, packageManager, readJson, SETTINGS_FILE, SetupError, writeJson } from "../setup-files.js";

/** Options of `issue-flow init`. */
export interface InitOptions {
  cwd: string;
  yes: boolean;
  recipes: string[] | null;
}

/**
 * The URL of the config's schema at a version.
 * @param version - This package's version.
 * @returns The URL.
 * @example schemaUrl("0.1.0") // "https://raw.githubusercontent.com/ramon-sg/issue-flow/v0.1.0/schema.json"
 */
export function schemaUrl(version: string): string {
  return `https://raw.githubusercontent.com/${FLOW_REPO}/v${version}/schema.json`;
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
 * Sets the repo up for the flow; see the file's header.
 * @param options - The options.
 * @param out - Where to write and ask.
 * @returns 0, or 1 if the files were not written.
 * @throws SetupError outside the main checkout or with a broken file; ConfigError if the
 * config would be invalid; UsageError for an unknown recipe.
 * @example await init({ cwd, yes: true, recipes: null }, out)
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
  const manager = packageManager(root, readJson(root, "package.json"));
  out.stdout(`Next: run '${manager} install', and commit .agents/, .claude/ and package.json.\n`);
  return 0;
}
