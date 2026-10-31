/**
 * @file `issue-flow apply [--yes] [--dry-run] [--json] [--recipe <name>,...]`: leaves the
 * repo as the version that runs needs it, and running it again changes nothing. It writes
 * `.agents/flow.json` the first time (from `paseo.json` if the repo has one, plus the recipes
 * it picks), runs the config's migrations, pins `@ramon-sg/issue-flow` to this version, adds
 * `github-rest` and the scripts if they are missing, and moves the hooks and the `$schema`
 * to this version. It changes no other version: who updates picks the version by picking
 * which one to run (`npx @ramon-sg/issue-flow@<version> apply`). It refuses when the repo
 * already has a newer issue-flow, or a range, since the hooks need an exact one. The skills,
 * `claude-cloud` and `claude-repo-guard` are `agent-kitchen`'s, which runs this command.
 */
import { confirm } from "../ask.js";
import { CONFIG_PATH, isObject } from "../config-base.js";
import { parseConfig } from "../config.js";
import { checkoutRoot, locateRepo } from "../git.js";
import { emitJson, type Output, UsageError, warn } from "../output.js";
import { dependencyVersion, isNewer, KEPT, withFlowPackages } from "../package-edits.js";
import { applyRecipe, detectedRecipes, loadRecipes, projectPrefix, type Recipe } from "../recipes.js";
import { hookVersions, registerHooks } from "../settings-hooks.js";
import { isStaleSchema, type OwnVersions, ownVersions, PACKAGE, packageManager, readJson, schemaUrl, SETTINGS_FILE, SetupError, writeJson } from "../setup-files.js";

/** Options of `issue-flow apply`. */
export interface ApplyOptions {
  cwd: string;
  /** Takes the recipes the repo's files suggest without asking. */
  yes: boolean;
  dryRun: boolean;
  json: boolean;
  /** The recipes named with `--recipe`, or null to pick them the first time. */
  recipes: string[] | null;
}

/** An exact version, as the hooks need one (a leading `=` means the same). */
const EXACT = /^=?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** A change to the config between versions: it leaves alone a config that has it already. */
interface Migration {
  name: string;
  run: (raw: Record<string, unknown>) => Record<string, unknown> | null;
}

/**
 * The config's migrations, oldest first. Each one sees the config as the earlier ones left
 * it and returns the new config, or null when there is nothing to do, so running them twice
 * changes nothing. A key the flow renames goes here.
 */
const MIGRATIONS: Migration[] = [];

/**
 * Runs the migrations and moves the `$schema` to this version (a `$schema` that is not the
 * flow's stays).
 * @param raw - The config.
 * @param version - This package's version.
 * @returns The config and what changed.
 */
function migrate(raw: Record<string, unknown>, version: string): { raw: Record<string, unknown>; changes: string[] } {
  let next = raw;
  const changes: string[] = [];
  for (const migration of MIGRATIONS) {
    const moved = migration.run(next);
    if (moved === null) continue;
    next = moved;
    changes.push(migration.name);
  }
  if (isStaleSchema(next.$schema, version)) {
    next = { ...next, $schema: schemaUrl(version) };
    changes.push(`$schema at v${version}`);
  }
  return { raw: next, changes };
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
 * The recipes to apply: the ones named with `--recipe`; with no config yet, each one the
 * repo's files suggest, after asking (all of them with `--yes`); otherwise none.
 * @param root - The repo.
 * @param options - The options.
 * @param fresh - Whether the config is new.
 * @param out - Where to ask.
 * @returns The recipes, or null when it would have to ask and cannot.
 * @throws UsageError if `--recipe` names one that does not exist.
 */
async function pickRecipes(root: string, options: ApplyOptions, fresh: boolean, out: Output): Promise<Recipe[] | null> {
  const recipes = loadRecipes();
  if (options.recipes !== null) {
    const unknown = options.recipes.find((name) => !recipes.some((recipe) => recipe.name === name));
    if (unknown !== undefined) throw new UsageError(`unknown recipe ${unknown}; there are ${recipes.map((recipe) => recipe.name).join(", ")}.`);
    return recipes.filter((recipe) => options.recipes?.includes(recipe.name));
  }
  if (!fresh) return [];
  const detected = detectedRecipes(root, recipes);
  const suggested = recipes.filter((item) => detected.includes(item.name));
  // NOTE: a dry run shows what --yes would write, so the first apply can be previewed.
  if (options.yes || options.dryRun || suggested.length === 0) return suggested;
  if (!out.interactive) return null;
  const picked: Recipe[] = [];
  for (const recipe of suggested) if (await confirm(out, `Recipe ${recipe.name}: ${recipe.description} Add it?`)) picked.push(recipe);
  return picked;
}

/**
 * Refuses to move the repo back, or to pin over a range: package.json must have an exact
 * issue-flow, and neither it nor any hook may be newer than this one.
 * @param root - The repo.
 * @param versions - This package's versions.
 * @throws SetupError if the repo has a newer issue-flow or one that is not exact.
 */
function checkVersion(root: string, versions: OwnVersions): void {
  const pinned = dependencyVersion(readJson(root, "package.json"), PACKAGE);
  if (pinned !== null && !EXACT.test(pinned))
    throw new SetupError(`package.json has issue-flow ${pinned}, not an exact version: the hooks need one. Pin one (such as ${versions.issueFlow}) and run 'npx ${PACKAGE}@<that version> apply'.`);
  const found = [
    ...(pinned === null ? [] : [{ where: "package.json", version: pinned.replace(/^=/, "") }]),
    ...Object.values(hookVersions(readJson(root, SETTINGS_FILE)))
      .filter((version): version is string => version !== null)
      .map((version) => ({ where: `a hook of ${SETTINGS_FILE}`, version })),
  ];
  const newer = found.find((item) => isNewer(item.version, versions.issueFlow));
  if (newer !== undefined)
    throw new SetupError(`${newer.where} has issue-flow ${newer.version}, newer than this ${versions.issueFlow}; run 'npx ${PACKAGE}@${newer.version} apply', or install first if package.json was bumped by hand.`);
}

/** A file `apply` writes, with what changes in it and what it keeps as the repo had it. */
interface Planned {
  path: string;
  value: Record<string, unknown>;
  changes: string[];
  kept: string[];
}

/**
 * What `apply` would write: the config, `package.json` and the settings' hooks.
 * @param root - The repo.
 * @param versions - This package's versions.
 * @param options - The options.
 * @param out - Where to ask about the recipes.
 * @returns The files, or null if it had to ask about the recipes and could not.
 * @throws ConfigError if the resulting config is invalid; SetupError if a file is broken.
 */
async function plan(root: string, versions: OwnVersions, options: ApplyOptions, out: Output): Promise<Planned[] | null> {
  const existing = readJson(root, CONFIG_PATH);
  const recipes = await pickRecipes(root, options, existing === null, out);
  if (recipes === null) return null;
  const start = existing === null ? freshConfig(root, versions.issueFlow) : migrate(existing, versions.issueFlow);
  let { raw } = start;
  const configChanges = [...start.changes];
  for (const recipe of recipes) {
    const applied = applyRecipe(raw, recipe, projectPrefix(root));
    raw = applied.raw;
    configChanges.push(...applied.changes.map((change) => (change.startsWith(KEPT) ? `${change} (${recipe.name})` : `${recipe.name}: ${change}`)));
  }
  parseConfig(raw);
  const pkg = withFlowPackages(readJson(root, "package.json"), versions);
  const hooks = registerHooks(readJson(root, SETTINGS_FILE), versions.issueFlow);
  const file = (path: string, value: Record<string, unknown>, lines: string[]): Planned => ({
    path,
    value,
    changes: lines.filter((line) => !line.startsWith(KEPT)).map((line) => `${path}: ${line}`),
    kept: lines.filter((line) => line.startsWith(KEPT)).map((line) => `${path}: ${line}`),
  });
  // NOTE: the settings go first: the sandbox of claude-repo-guard is likeliest to block them,
  // and then nothing else has been written.
  return [file(SETTINGS_FILE, hooks.settings, hooks.changes), file(CONFIG_PATH, raw, configChanges), file("package.json", pkg.pkg, pkg.changes)];
}

/**
 * Writes a file, saying what to do if the sandbox of `claude-repo-guard` blocks it.
 * @param root - The repo.
 * @param file - The file.
 * @param done - The files already written, to say so if this one fails.
 * @throws SetupError if it cannot be written for lack of permission.
 */
function write(root: string, file: Planned, done: string[]): void {
  try {
    writeJson(root, file.path, file.value);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EACCES") throw error;
    const already = done.length === 0 ? "" : ` It already wrote ${done.join(" and ")}; running it again finishes the rest.`;
    throw new SetupError(`could not write ${file.path} (${code}): inside a Claude session the sandbox blocks it; run apply from your terminal.${already}`);
  }
}

/**
 * Applies the flow to the repo; see the file's header.
 * @param options - The options.
 * @param out - Where to write and ask.
 * @returns 0 when applied or already there, 1 when it had to ask and could not.
 * @throws SetupError outside the main checkout, with a broken file, or when it refuses the
 * version; ConfigError if the config would be invalid; UsageError for an unknown recipe.
 * @example await apply({ cwd, yes: true, dryRun: false, json: false, recipes: null }, out)
 */
export async function apply(options: ApplyOptions, out: Output): Promise<number> {
  const located = locateRepo(options.cwd);
  if (located === null) throw new SetupError("run apply inside a checkout of the repo.");
  if (checkoutRoot(options.cwd) !== located.mainRoot) throw new SetupError(`run apply in the main checkout, ${located.mainRoot}, not in a worktree.`);
  const root = located.mainRoot;
  const versions = ownVersions();
  checkVersion(root, versions);
  const planned = await plan(root, versions, options, out);
  if (planned === null) {
    warn(out, "nothing written: the repo's files suggest recipes; pass --yes to take them, or --recipe to pick.");
    if (options.json) emitJson(out, { version: versions.issueFlow, changes: [], kept: [], written: false, next: ["pass --yes or --recipe"] });
    return 1;
  }
  const files = planned.filter((file) => file.changes.length > 0);
  const changes = files.flatMap((file) => file.changes);
  const kept = planned.flatMap((file) => file.kept);
  for (const line of kept) warn(out, line);
  const written = !options.dryRun && files.length > 0;
  const done: string[] = [];
  if (written)
    for (const file of files) {
      write(root, file, done);
      done.push(file.path);
    }
  const pkgChanged = files.some((file) => file.path === "package.json");
  const next = files.length === 0 ? [] : [...(pkgChanged ? [`${packageManager(root, readJson(root, "package.json"))} install`] : []), "review the diff and commit it"];
  if (options.json) {
    emitJson(out, { version: versions.issueFlow, changes, kept, written, next });
    return 0;
  }
  if (changes.length === 0) out.stdout(`Already at issue-flow ${versions.issueFlow}.\n`);
  else out.stdout(`issue-flow ${versions.issueFlow}${options.dryRun ? " would write" : ""}:\n${changes.map((line) => `  ${line}\n`).join("")}`);
  if (written) out.stdout(`Next: ${pkgChanged ? `run '${next[0]}', ` : ""}review the diff and commit it.\n`);
  return 0;
}
