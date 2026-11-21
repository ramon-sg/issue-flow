/**
 * @file `issue-flow apply [--yes] [--dry-run] [--json] [--recipe <name>,...]`: leaves the
 * repo as the version that runs needs it, and running it again changes nothing. It writes
 * `.agents/flow.json` the first time (from `paseo.json` if the repo has one, plus the recipes
 * it picks), runs the config's migrations, and writes `.agents/runner.json` (the runner,
 * Bun or Node, and the exact `@ramon-sg/issue-flow` and `github-rest` it runs), the hooks
 * and the `package.json` shortcuts with that runner. It adds no devDependency and removes
 * the ones older versions added. It never lowers a version: who updates picks the version by
 * picking which one to run. It refuses when the repo already has a newer issue-flow, or a
 * range, since the hooks need an exact one. The skills, `agent-cloud-kit` and
 * `claude-repo-guard` are `agent-kitchen`'s, which runs this command.
 */
import { effectiveRunner, RUNNER_FILE, type Runner, writeRunnerConfig, writeScripts } from "@ramon-sg/runner";
import { confirm } from "../ask.js";
import { CONFIG_PATH, isObject } from "../config-base.js";
import { parseConfig } from "../config.js";
import { checkoutRoot, locateRepo } from "../git.js";
import { type Messages, messages } from "../messages/index.js";
import { emitJson, type Output, UsageError, warn } from "../output.js";
import { dependencyVersion, GITHUB_REST, isNewer } from "../package-edits.js";
import { applyRecipe, detectedRecipes, loadRecipes, projectPrefix, type Recipe } from "../recipes.js";
import { FLOW_OWNED, applyCommand, flowScripts, loadRunnerFile, pickScripts, predictScripts, readRunnerFile, withFlowTools, withoutLegacy } from "../runner-file.js";
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
 * @param t - The messages.
 * @returns The config and what changed.
 */
function migrate(raw: Record<string, unknown>, version: string, t: Messages): { raw: Record<string, unknown>; changes: string[] } {
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
    changes.push(t.apply.schemaAt(version));
  }
  return { raw: next, changes };
}

/**
 * A new config: the schema, and the branch rules of `paseo.json` if the repo has one.
 * @param root - The repo.
 * @param version - This package's version.
 * @param t - The messages.
 * @returns The config and what it took from `paseo.json`.
 */
function freshConfig(root: string, version: string, t: Messages): { raw: Record<string, unknown>; changes: string[] } {
  const raw: Record<string, unknown> = { $schema: schemaUrl(version) };
  const issues = readJson(root, "paseo.json", t)?.project;
  const paseo = isObject(issues) && isObject(issues.issues) ? issues.issues : null;
  if (paseo === null) return { raw, changes: [t.apply.freshNew] };
  const branch: Record<string, unknown> = {};
  if (typeof paseo.branchTemplate === "string") branch.template = paseo.branchTemplate;
  if (isObject(paseo.types)) branch.types = paseo.types;
  if (Object.keys(branch).length > 0) raw.branch = branch;
  return { raw, changes: [t.apply.freshPaseo] };
}

/**
 * The recipes to apply: the ones named with `--recipe`; with no config yet, each one the
 * repo's files suggest, after asking (all of them with `--yes`); otherwise none.
 * @param root - The repo.
 * @param options - The options.
 * @param fresh - Whether the config is new.
 * @param out - Where to ask.
 * @param t - The messages.
 * @returns The recipes, or null when it would have to ask and cannot.
 * @throws UsageError if `--recipe` names one that does not exist.
 */
async function pickRecipes(root: string, options: ApplyOptions, fresh: boolean, out: Output, t: Messages): Promise<Recipe[] | null> {
  const recipes = loadRecipes();
  if (options.recipes !== null) {
    const unknown = options.recipes.find((name) => !recipes.some((recipe) => recipe.name === name));
    if (unknown !== undefined) throw new UsageError(t.apply.unknownRecipe(unknown, recipes.map((recipe) => recipe.name).join(", ")));
    return recipes.filter((recipe) => options.recipes?.includes(recipe.name));
  }
  if (!fresh) return [];
  const detected = detectedRecipes(root, recipes);
  const suggested = recipes.filter((item) => detected.includes(item.name));
  // NOTE: a dry run shows what --yes would write, so the first apply can be previewed.
  if (options.yes || options.dryRun || suggested.length === 0) return suggested;
  if (!out.interactive) return null;
  const picked: Recipe[] = [];
  for (const recipe of suggested) if (await confirm(out, t.apply.askRecipe(recipe.name, t.recipeDescription(recipe.name, recipe.description)))) picked.push(recipe);
  return picked;
}

/**
 * Refuses to move the repo back, or to pin over a range: package.json (the old way) must
 * have an exact issue-flow, and neither it, runner.json nor any hook may be newer than this one.
 * @param root - The repo.
 * @param versions - This package's versions.
 * @param t - The messages.
 * @throws SetupError if the repo has a newer issue-flow or one that is not exact, or its
 * runner.json cannot be used.
 */
function checkVersion(root: string, versions: OwnVersions, t: Messages): void {
  const pinned = dependencyVersion(readJson(root, "package.json", t), PACKAGE);
  if (pinned !== null && !EXACT.test(pinned))
    throw new SetupError(t.apply.notExact(pinned, versions.issueFlow, applyCommand(null, "<that version>")));
  const config = readRunnerFile(root);
  const runner = config === null ? null : effectiveRunner(config);
  const tool = config?.tools[PACKAGE];
  const found = [
    ...(tool === undefined ? [] : [{ where: RUNNER_FILE, version: tool }]),
    ...(pinned === null ? [] : [{ where: "package.json", version: pinned.replace(/^=/, "") }]),
    ...Object.values(hookVersions(readJson(root, SETTINGS_FILE, t)))
      .filter((version): version is string => version !== null)
      .map((version) => ({ where: t.apply.hookOf(SETTINGS_FILE), version })),
  ];
  const newer = found.find((item) => isNewer(item.version, versions.issueFlow));
  if (newer !== undefined)
    throw new SetupError(t.apply.newer(newer.where, newer.version, versions.issueFlow, applyCommand(runner, newer.version)));
}

/** A file `apply` writes, with what changes in it and what it keeps as the repo had it. */
interface Planned {
  path: string;
  changes: string[];
  kept: string[];
  /** Writes it to the repo. */
  write: (root: string) => void;
}

/**
 * The `package.json` of the repo as the flow leaves it, with what changes: the old
 * devDependencies and scripts out, the shortcuts of the runner in.
 * @param root - The repo.
 * @param runner - The runner of the shortcuts.
 * @param versions - This package's versions.
 * @param t - The messages.
 * @returns The two writes of package.json (the clean-up and the shortcuts), and whether the
 * clean-up removed a dependency while the repo still has others to install.
 */
function planPackage(root: string, runner: Runner, versions: OwnVersions, t: Messages): { files: Planned[]; installable: boolean } {
  const pkg = readJson(root, "package.json", t);
  const legacy = pkg === null ? null : withoutLegacy(pkg, t);
  const cleaned = legacy?.pkg ?? null;
  const picked = pickScripts(cleaned, flowScripts(runner, versions.issueFlow), t);
  const predicted = predictScripts(cleaned, picked.scripts, t);
  const files: Planned[] = [];
  if (legacy !== null && legacy.changes.length > 0)
    files.push({ path: "package.json", changes: legacy.changes, kept: [], write: (dir) => writeJson(dir, "package.json", legacy.pkg) });
  files.push({
    path: "package.json",
    changes: predicted.changes,
    kept: [...picked.kept, ...predicted.clashes.map((name) => t.setup.keptScript(name))],
    write: (dir) => void writeScripts(dir, runner, picked.scripts, FLOW_OWNED),
  });
  const has = (field: unknown): boolean => isObject(field) && Object.keys(field).length > 0;
  return { files, installable: legacy !== null && legacy.removedDependencies && (has(legacy.pkg.dependencies) || has(legacy.pkg.devDependencies)) };
}

/**
 * What `apply` would write: the settings' hooks, runner.json, the config and package.json.
 * @param root - The repo.
 * @param versions - This package's versions.
 * @param options - The options.
 * @param out - Where to ask.
 * @param t - The messages.
 * @returns The files and whether to run an install; null if it had to ask and could not, or
 * the answer was no.
 * @throws ConfigError if the resulting config is invalid; SetupError if a file is broken.
 */
async function plan(root: string, versions: OwnVersions, options: ApplyOptions, out: Output, t: Messages): Promise<{ files: Planned[]; installable: boolean } | null> {
  const mayAsk = out.interactive && !options.yes && !options.dryRun && !options.json;
  const loaded = await loadRunnerFile(root, mayAsk ? async () => ((await confirm(out, t.apply.askNode)) ? "node" : null) : undefined);
  if (loaded === null) {
    warn(out, t.apply.nothingWrittenRunner);
    return null;
  }
  if (loaded.warning !== null) warn(out, loaded.warning);
  const existing = readJson(root, CONFIG_PATH, t);
  const recipes = await pickRecipes(root, options, existing === null, out, t);
  if (recipes === null) {
    warn(out, t.apply.nothingWritten);
    return null;
  }
  const start = existing === null ? freshConfig(root, versions.issueFlow, t) : migrate(existing, versions.issueFlow, t);
  let { raw } = start;
  const configChanges = [...start.changes];
  const configKept: string[] = [];
  for (const recipe of recipes) {
    const applied = applyRecipe(raw, recipe, projectPrefix(root), t);
    raw = applied.raw;
    configChanges.push(...applied.changes.map((change) => `${recipe.name}: ${change}`));
    configKept.push(...applied.kept.map((change) => `${change} (${recipe.name})`));
  }
  parseConfig(raw, t);
  const pinned = withFlowTools(loaded.config, versions, dependencyVersion(readJson(root, "package.json", t), GITHUB_REST), t);
  const runner = effectiveRunner(pinned.config);
  const hooks = registerHooks(readJson(root, SETTINGS_FILE, t), runner, versions.issueFlow, t);
  const runnerChanges = [...(loaded.created ? [`runner: ${runner}`] : []), ...pinned.changes];
  const packaged = planPackage(root, runner, versions, t);
  const file = (path: string, changes: string[], kept: string[], write: (dir: string) => void): Planned => ({ path, changes, kept, write });
  // NOTE: the settings go first: the sandbox of claude-repo-guard is likeliest to block them,
  // and then nothing else has been written.
  const files = [
    file(SETTINGS_FILE, hooks.changes, [], (dir) => writeJson(dir, SETTINGS_FILE, hooks.settings)),
    file(RUNNER_FILE, runnerChanges, pinned.kept, (dir) => writeRunnerConfig(dir, pinned.config)),
    file(CONFIG_PATH, configChanges, configKept, (dir) => writeJson(dir, CONFIG_PATH, raw)),
    ...packaged.files,
  ];
  return { files: files.map((item) => ({ ...item, changes: item.changes.map((line) => `${item.path}: ${line}`), kept: item.kept.map((line) => `${item.path}: ${line}`) })), installable: packaged.installable };
}

/**
 * Writes a file, saying what to do if the sandbox of `claude-repo-guard` blocks it.
 * @param root - The repo.
 * @param file - The file.
 * @param done - The files already written, to say so if this one fails.
 * @param t - The messages.
 * @throws SetupError if it cannot be written for lack of permission.
 */
function write(root: string, file: Planned, done: string[], t: Messages): void {
  try {
    file.write(root);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EACCES") throw error;
    const already = done.length === 0 ? "" : t.apply.alreadyWrote(done);
    throw new SetupError(t.apply.writeFailed(file.path, String(code), already));
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
  // NOTE: --json carries the changes and the hints as text, so it is always in English.
  const t = options.json ? messages("en") : out.t;
  const located = locateRepo(options.cwd);
  if (located === null) throw new SetupError(t.apply.insideCheckout);
  if (checkoutRoot(options.cwd) !== located.mainRoot) throw new SetupError(t.apply.mainCheckout(located.mainRoot));
  const root = located.mainRoot;
  const versions = ownVersions();
  checkVersion(root, versions, t);
  const planned = await plan(root, versions, options, out, t);
  if (planned === null) {
    if (options.json) emitJson(out, { version: versions.issueFlow, changes: [], kept: [], written: false, next: [t.apply.passYes] });
    return 1;
  }
  const files = planned.files.filter((file) => file.changes.length > 0);
  const changes = files.flatMap((file) => file.changes);
  const kept = planned.files.flatMap((file) => file.kept);
  for (const line of kept) warn(out, line);
  const written = !options.dryRun && files.length > 0;
  const done: string[] = [];
  if (written)
    for (const file of files) {
      write(root, file, done, t);
      if (!done.includes(file.path)) done.push(file.path);
    }
  const install = planned.installable ? `${packageManager(root, readJson(root, "package.json", t))} install` : null;
  const next = files.length === 0 ? [] : [...(install === null ? [] : [install]), t.apply.reviewCommit];
  if (options.json) {
    emitJson(out, { version: versions.issueFlow, changes, kept, written, next });
    return 0;
  }
  if (changes.length === 0) out.stdout(`${t.apply.already(versions.issueFlow)}\n`);
  else out.stdout(`${options.dryRun ? t.apply.wouldWrite(versions.issueFlow) : t.apply.writes(versions.issueFlow)}\n${changes.map((line) => `  ${line}\n`).join("")}`);
  if (written) out.stdout(`${t.apply.next(install)}\n`);
  return 0;
}
