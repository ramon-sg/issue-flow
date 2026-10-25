/**
 * @file Recipes: pieces of `.agents/flow.json` for what many repos share (installing with
 * npm, pnpm or bun, a Docker Compose project per worktree, direnv, a staging branch). Each
 * one is a JSON file in `recipes/` with a description, the files that suggest it and its
 * config. Applying one adds what is missing and never overwrites what the repo chose:
 * steps go in by name, and a key already set stays as it is.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isObject } from "./config-base.js";
import { SetupError } from "./setup-files.js";

/** Where the recipes are, next to `dist`. */
const RECIPES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "recipes");

/** What a recipe's strings say instead of the repo's Docker project prefix. */
const PROJECT_PLACEHOLDER = "{project}";

/** The worktree lists a recipe adds steps to. */
const STEP_LISTS = ["setup", "teardown"];

/** A recipe. */
export interface Recipe {
  name: string;
  description: string;
  detect: string[];
  config: Record<string, unknown>;
}

/**
 * Every recipe, by name.
 * @returns The recipes.
 * @throws SetupError if a recipe file is broken.
 * @example loadRecipes().map((recipe) => recipe.name) // ["bun", "direnv", …]
 */
export function loadRecipes(): Recipe[] {
  return readdirSync(RECIPES_DIR).filter((file) => file.endsWith(".json")).sort().map((file) => {
    const raw: unknown = JSON.parse(readFileSync(join(RECIPES_DIR, file), "utf8"));
    if (!isObject(raw) || typeof raw.description !== "string" || !Array.isArray(raw.detect) || !isObject(raw.config))
      throw new SetupError(`recipe ${file} is broken.`);
    return { name: basename(file, ".json"), description: raw.description, detect: raw.detect.map(String), config: raw.config };
  });
}

/**
 * The recipes the repo's files suggest: a lockfile, a compose file, an `.envrc`.
 * @param root - The repo.
 * @param recipes - The recipes.
 * @returns Their names.
 * @example detectedRecipes(root, loadRecipes()) // ["pnpm", "docker-compose"]
 */
export function detectedRecipes(root: string, recipes: Recipe[]): string[] {
  return recipes.filter((recipe) => recipe.detect.some((file) => existsSync(join(root, file)))).map((recipe) => recipe.name);
}

/**
 * The prefix of the repo's Docker projects: its folder name, in lowercase letters, digits
 * and dashes.
 * @param root - The repo.
 * @returns The prefix.
 * @example projectPrefix("/code/Acme Shop") // "acme-shop"
 */
export function projectPrefix(root: string): string {
  const slug = basename(root).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug === "" ? "app" : slug;
}

/**
 * Adds a recipe's steps to a list, those whose name is not there yet.
 * @param current - The repo's steps, or undefined.
 * @param added - The recipe's steps.
 * @returns The list, the names added and the names it already had.
 */
function mergeSteps(current: unknown, added: unknown): { steps: unknown[]; names: string[]; taken: string[] } {
  const steps = Array.isArray(current) ? [...current] : [];
  const names = new Set(steps.filter(isObject).map((step) => step.name));
  const recipeSteps = (Array.isArray(added) ? added : []).filter(isObject);
  const fresh = recipeSteps.filter((step) => !names.has(step.name));
  const taken = recipeSteps.filter((step) => names.has(step.name)).map((step) => String(step.name));
  return { steps: [...steps, ...fresh], names: fresh.map((step) => String(step.name)), taken };
}

/**
 * Merges a recipe's `worktrees` into the repo's.
 * @param current - The repo's `worktrees`, or undefined.
 * @param added - The recipe's.
 * @param changes - Where to note what changed.
 * @returns The merged `worktrees`.
 */
function mergeWorktrees(current: unknown, added: Record<string, unknown>, changes: string[]): Record<string, unknown> {
  const merged = isObject(current) ? { ...current } : {};
  for (const [key, value] of Object.entries(added)) {
    if (STEP_LISTS.includes(key)) {
      const { steps, names, taken } = mergeSteps(merged[key], value);
      merged[key] = steps;
      for (const name of names) changes.push(`worktrees.${key}: added "${name}"`);
      for (const name of taken) changes.push(`kept the "${name}" step of worktrees.${key}`);
    } else if (key === "dockerProjects") {
      const projects = [...new Set([...(Array.isArray(merged[key]) ? merged[key] : []), ...(Array.isArray(value) ? value : [])])];
      if (projects.length !== (Array.isArray(merged[key]) ? merged[key].length : 0)) changes.push(`worktrees.dockerProjects: ${projects.join(", ")}`);
      merged[key] = projects;
    } else if (merged[key] === undefined) {
      merged[key] = value;
      changes.push(`worktrees.${key}: ${JSON.stringify(value)}`);
    }
  }
  return merged;
}

/**
 * Applies a recipe to the repo's raw config: adds its missing steps and keys, and keeps
 * every key the repo already set.
 * @param raw - The repo's config, as JSON.
 * @param recipe - The recipe.
 * @param prefix - The repo's Docker project prefix, for `{project}`.
 * @returns The new config and what changed, one line each.
 * @example applyRecipe({}, npmRecipe, "acme").changes // ['worktrees.setup: added "deps"']
 */
export function applyRecipe(raw: Record<string, unknown>, recipe: Recipe, prefix: string): { raw: Record<string, unknown>; changes: string[] } {
  const config = JSON.parse(JSON.stringify(recipe.config).split(PROJECT_PLACEHOLDER).join(prefix)) as Record<string, unknown>;
  const next = { ...raw };
  const changes: string[] = [];
  for (const [key, value] of Object.entries(config)) {
    if (key === "worktrees" && isObject(value)) next.worktrees = mergeWorktrees(next.worktrees, value, changes);
    else if (next[key] === undefined) {
      next[key] = value;
      changes.push(`${key}: ${JSON.stringify(value)}`);
    } else if (JSON.stringify(next[key]) !== JSON.stringify(value)) changes.push(`kept ${key} ${JSON.stringify(next[key])} (the recipe says ${JSON.stringify(value)})`);
  }
  return { raw: next, changes };
}
