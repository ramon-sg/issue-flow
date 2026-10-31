/**
 * @file The repo's config, `.agents/flow.json`. Every key is optional: without the file,
 * or with a key missing, the default applies. An unknown key or a value of the wrong kind
 * is an error that names the key, so a typo never silently falls back to the default.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { locateRepo } from "./git.js";
import { CONFIG_PATH, ConfigError, isObject, onlyKeys, text } from "./config-base.js";
import { type WorktreesConfig, worktreesSection } from "./worktree-config.js";

/** Who proposes a branch name when the issue has none: Claude, or the title's slug. */
export type Namer = "claude" | "title";

/** How issues map to the branch type: by label first, then by title prefix. */
export interface TypeRules {
  labels: Record<string, string>;
  titlePrefixes: Record<string, string>;
}

/** A label the flow wants in the repo: its color (hex, no `#`) and description. */
export interface LabelSpec {
  color: string;
  description: string;
}

/** The whole config, with every default applied. */
export interface FlowConfig {
  repo: string | null;
  baseBranch: string | null;
  branch: {
    template: string;
    namer: Namer;
    claudeModel: string;
    types: TypeRules;
  };
  worktrees: WorktreesConfig;
  start: {
    commitMessage: string;
    prBody: string;
    prompt: string;
    resumePrompt: string;
    summaryPrompt: string;
    summaryPlanPrompt: string;
    cloudPrompt: string;
  };
  plans: { dirs: string[] };
  colors: Record<string, string>;
  labels: Record<string, LabelSpec>;
}

/** The defaults, the same rules Abastio uses. */
export const DEFAULT_CONFIG: FlowConfig = {
  repo: null,
  baseBranch: null,
  branch: {
    template: "{type}/{number}-{slug}",
    namer: "claude",
    claudeModel: "haiku",
    types: {
      labels: {
        bug: "fix",
        enhancement: "feat",
        documentation: "docs",
        spike: "spike",
      },
      titlePrefixes: {
        "bug:": "fix",
        "mejora:": "feat",
        "docs:": "docs",
        "spike:": "spike",
      },
    },
  },
  worktrees: { dir: ".claude/worktrees", setup: [], teardown: [], ports: null, dockerProjects: [] },
  start: {
    commitMessage: "chore: empieza el trabajo en la issue #{number} [skip ci]",
    prBody: "{keyword} #{number}\n\nIssue: {url}\n\nEn progreso.",
    prompt:
      "Issue #{number}. Lee la issue con `npx @ramon-sg/github-rest issue view {number}`, resúmela en lenguaje llano y sigue la skill start-issue para elegir el flujo.",
    resumePrompt:
      "Issue #{number}. Lee la issue con `npx @ramon-sg/github-rest issue view {number}`, resúmela en lenguaje llano y retoma el trabajo según {plan}: revisa qué tareas quedan.",
    summaryPrompt:
      "Issue #{number}. Lee la issue con `npx @ramon-sg/github-rest issue view {number}` y resúmela en lenguaje llano. No empieces a trabajar ni a planificar: espera mi pedido.",
    summaryPlanPrompt:
      "Issue #{number}. Lee la issue con `npx @ramon-sg/github-rest issue view {number}` y resúmela en lenguaje llano. Tiene un plan abierto en {plan}: di en una línea qué tareas quedan. No empieces a trabajar ni a planificar: espera mi pedido.",
    cloudPrompt: "/start-issue {number} --yes{flags}",
  },
  plans: { dirs: ["docs/plans", "docs/specs"] },
  colors: {
    "critical-path": "red",
    "P1:": "red",
    "P2:": "orange",
    "P3:": "yellow",
    "P4:": "cyan",
  },
  labels: {
    bug: { color: "d73a4a", description: "Something isn't working" },
    enhancement: { color: "a2eeef", description: "New feature or request" },
    documentation: { color: "0075ca", description: "Improvements or additions to documentation" },
    spike: { color: "fbca04", description: "Time-boxed research before building" },
    "P1: urgent": { color: "B60205", description: "Breaks production or blocks work" },
    "P2: important": { color: "F9D0C4", description: "Real impact, with some slack" },
    "P3: minor": { color: "FEF2C0", description: "Default when in doubt" },
    "P4: low": { color: "BFDADC", description: "Nice-to-have" },
  },
};

/** The colors a Claude session takes with `/color`. */
export const SESSION_COLORS = ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"];

/** Placeholders the branch template must have. */
const TEMPLATE_PLACEHOLDERS = ["{number}", "{slug}"];

/** `owner/repo`. */
const REPO = /^[^/\s]+\/[^/\s]+$/;

/** A branch type: lowercase, as it goes in the branch name. */
const TYPE = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * A map of name to branch type (`{"bug": "fix"}`), merged over nothing: when the repo
 * gives one, it replaces the default whole, so a label can be dropped.
 * @param value - The value, or undefined.
 * @param where - Its path, for the error.
 * @param fallback - The default map.
 * @returns The map.
 * @throws ConfigError if it is not an object of valid types.
 */
function typeMap(
  value: unknown,
  where: string,
  fallback: Record<string, string>,
): Record<string, string> {
  if (value === undefined) return fallback;
  if (!isObject(value))
    throw new ConfigError(`${CONFIG_PATH}: "${where}" must be an object.`);
  for (const [key, type] of Object.entries(value)) {
    if (typeof type !== "string" || !TYPE.test(type))
      throw new ConfigError(
        `${CONFIG_PATH}: "${where}.${key}" must be a lowercase branch type such as "feat".`,
      );
  }
  return value as Record<string, string>;
}

/**
 * The `branch` section, with its defaults.
 * @param value - The section, or undefined.
 * @returns The section.
 * @throws ConfigError if something is invalid.
 */
function branchSection(value: unknown): FlowConfig["branch"] {
  const fallback = DEFAULT_CONFIG.branch;
  if (value === undefined) return fallback;
  if (!isObject(value))
    throw new ConfigError(`${CONFIG_PATH}: "branch" must be an object.`);
  onlyKeys(value, ["template", "namer", "claudeModel", "types"], "branch");
  const template = text(value.template, "branch.template", fallback.template);
  const missing = TEMPLATE_PLACEHOLDERS.filter((part) => !template.includes(part));
  if (missing.length > 0)
    throw new ConfigError(
      `${CONFIG_PATH}: "branch.template" needs ${missing.join(" and ")}.`,
    );
  const namer = value.namer ?? fallback.namer;
  if (namer !== "claude" && namer !== "title")
    throw new ConfigError(`${CONFIG_PATH}: "branch.namer" must be "claude" or "title".`);
  const types = value.types;
  if (types !== undefined && !isObject(types))
    throw new ConfigError(`${CONFIG_PATH}: "branch.types" must be an object.`);
  if (types !== undefined) onlyKeys(types, ["labels", "titlePrefixes"], "branch.types");
  return {
    template,
    namer,
    claudeModel: text(value.claudeModel, "branch.claudeModel", fallback.claudeModel),
    types: {
      labels: typeMap(types?.labels, "branch.types.labels", fallback.types.labels),
      titlePrefixes: typeMap(
        types?.titlePrefixes,
        "branch.types.titlePrefixes",
        fallback.types.titlePrefixes,
      ),
    },
  };
}

/**
 * A section made only of optional strings (`start`).
 * @param value - The section, or undefined.
 * @param name - Its key.
 * @param fallback - Its defaults.
 * @returns The section.
 * @throws ConfigError if something is invalid.
 */
function textSection<T extends Record<string, string>>(
  value: unknown,
  name: string,
  fallback: T,
): T {
  if (value === undefined) return fallback;
  if (!isObject(value))
    throw new ConfigError(`${CONFIG_PATH}: "${name}" must be an object.`);
  onlyKeys(value, Object.keys(fallback), name);
  const out: Record<string, string> = {};
  for (const [key, standard] of Object.entries(fallback))
    out[key] = text(value[key], `${name}.${key}`, standard);
  return out as T;
}

/**
 * The `plans` section: the folders where an issue's plan is looked for, in order of
 * preference.
 * @param value - The section, or undefined.
 * @returns The section.
 * @throws ConfigError if something is invalid.
 */
function plansSection(value: unknown): FlowConfig["plans"] {
  if (value === undefined) return DEFAULT_CONFIG.plans;
  if (!isObject(value)) throw new ConfigError(`${CONFIG_PATH}: "plans" must be an object.`);
  onlyKeys(value, ["dirs"], "plans");
  const dirs = value.dirs ?? DEFAULT_CONFIG.plans.dirs;
  const valid =
    Array.isArray(dirs) &&
    dirs.length > 0 &&
    dirs.every((dir) => typeof dir === "string" && dir.trim() !== "" && !dir.startsWith("/"));
  if (!valid)
    throw new ConfigError(`${CONFIG_PATH}: "plans.dirs" must be a non-empty list of folders relative to the repo.`);
  return { dirs: (dirs as string[]).map((dir) => dir.replace(/\/+$/, "")) };
}

/**
 * The `colors` map: label prefix to session color. When the repo gives one, it replaces the
 * default whole.
 * @param value - The map, or undefined.
 * @returns The map.
 * @throws ConfigError if a color is not one Claude knows.
 */
function colorsSection(value: unknown): Record<string, string> {
  if (value === undefined) return DEFAULT_CONFIG.colors;
  if (!isObject(value)) throw new ConfigError(`${CONFIG_PATH}: "colors" must be an object.`);
  for (const [prefix, color] of Object.entries(value)) {
    if (typeof color !== "string" || !SESSION_COLORS.includes(color))
      throw new ConfigError(`${CONFIG_PATH}: "colors.${prefix}" must be one of ${SESSION_COLORS.join(", ")}.`);
  }
  return value as Record<string, string>;
}

/** A label color: six hex digits, without `#`. */
const LABEL_COLOR = /^[0-9a-fA-F]{6}$/;

/** A label name: no spaces at the ends, since GitHub trims them. */
const LABEL_NAME = /^\S(?:.*\S)?$/;

/** GitHub's limits for a label's name and description, in characters. */
const LABEL_NAME_MAX = 50;
const LABEL_DESCRIPTION_MAX = 100;

/**
 * The `labels` map: the labels `labels sync` makes in the repo. Unlike the other maps, it
 * merges over the default, because a repo usually adds labels: a name replaces the default
 * of the same name (ignoring case, as GitHub does) and `null` drops it.
 * @param value - The map, or undefined.
 * @returns The labels.
 * @throws ConfigError if a label is invalid.
 * @example labelsSection({ spike: null, "area:api": { color: "1d76db" } })["area:api"].description // ""
 */
function labelsSection(value: unknown): Record<string, LabelSpec> {
  if (value === undefined) return DEFAULT_CONFIG.labels;
  if (!isObject(value)) throw new ConfigError(`${CONFIG_PATH}: "labels" must be an object.`);
  // NOTE: a Map, so a "__proto__" key from JSON.parse stays a label and not the prototype.
  const labels = new Map(Object.entries(DEFAULT_CONFIG.labels));
  const seen = new Set<string>();
  for (const [name, spec] of Object.entries(value)) {
    const where = `labels.${name}`;
    if (!LABEL_NAME.test(name) || [...name].length > LABEL_NAME_MAX)
      throw new ConfigError(`${CONFIG_PATH}: "${where}" needs a name of 1 to ${LABEL_NAME_MAX} characters, without spaces at the ends.`);
    const key = name.toLowerCase();
    if (seen.has(key)) throw new ConfigError(`${CONFIG_PATH}: "labels" has "${name}" twice (names ignore case).`);
    seen.add(key);
    for (const known of [...labels.keys()]) if (known.toLowerCase() === key) labels.delete(known);
    if (spec === null) continue;
    if (!isObject(spec)) throw new ConfigError(`${CONFIG_PATH}: "${where}" must be an object or null.`);
    onlyKeys(spec, ["color", "description"], where);
    if (typeof spec.color !== "string" || !LABEL_COLOR.test(spec.color))
      throw new ConfigError(`${CONFIG_PATH}: "${where}.color" must be six hex digits, without #, such as "1d76db".`);
    const description = spec.description ?? "";
    if (typeof description !== "string" || [...description].length > LABEL_DESCRIPTION_MAX)
      throw new ConfigError(`${CONFIG_PATH}: "${where}.description" must be a string of up to ${LABEL_DESCRIPTION_MAX} characters.`);
    labels.set(name, { color: spec.color, description });
  }
  return Object.fromEntries(labels);
}

/**
 * Validates a parsed config and fills in the defaults.
 * @param raw - The parsed JSON.
 * @returns The config.
 * @throws ConfigError if something is invalid.
 * @example parseConfig({ branch: { namer: "title" } }).branch.template // "{type}/{number}-{slug}"
 */
export function parseConfig(raw: unknown): FlowConfig {
  if (!isObject(raw)) throw new ConfigError(`${CONFIG_PATH} must be a JSON object.`);
  onlyKeys(raw, ["repo", "baseBranch", "branch", "worktrees", "start", "plans", "colors", "labels"], "");
  const repo = text(raw.repo, "repo", null);
  if (repo !== null && !REPO.test(repo))
    throw new ConfigError(`${CONFIG_PATH}: "repo" must be owner/repo.`);
  return {
    repo,
    baseBranch: text(raw.baseBranch, "baseBranch", null),
    branch: branchSection(raw.branch),
    worktrees: worktreesSection(raw.worktrees, DEFAULT_CONFIG.worktrees),
    start: textSection(raw.start, "start", DEFAULT_CONFIG.start),
    plans: plansSection(raw.plans),
    colors: colorsSection(raw.colors),
    labels: labelsSection(raw.labels),
  };
}

/**
 * The main checkout of the repo that holds a directory, or null outside git. The config
 * is always the main checkout's, also from a worktree: a branch cannot change the steps
 * its own worktree runs.
 * @param cwd - The directory.
 * @returns The root.
 * @example repoRoot("/repo/.claude/worktrees/feat+42-x") // "/repo"
 */
export function repoRoot(cwd: string): string | null {
  return locateRepo(cwd)?.mainRoot ?? null;
}

/**
 * Reads the config of the main checkout of the repo that holds `cwd`. Outside git, or
 * without the file, every default applies.
 * @param cwd - A directory inside the checkout.
 * @returns The config.
 * @throws ConfigError if the file is not valid JSON or something in it is invalid.
 * @example loadConfig(process.cwd()).branch.namer // "claude"
 */
export function loadConfig(cwd: string): FlowConfig {
  const root = repoRoot(cwd);
  const file = root === null ? null : join(root, CONFIG_PATH);
  if (file === null || !existsSync(file)) return DEFAULT_CONFIG;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new ConfigError(
      `${CONFIG_PATH} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseConfig(raw);
}
