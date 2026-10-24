/**
 * @file The repo's config, `.agents/flow.json`. Every key is optional: without the file,
 * or with a key missing, the default applies. An unknown key or a value of the wrong kind
 * is an error that names the key, so a typo never silently falls back to the default.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Where the config lives, relative to the repo root. */
export const CONFIG_PATH = ".agents/flow.json";

/** Who proposes a branch name when the issue has none: Claude, or the title's slug. */
export type Namer = "claude" | "title";

/** How issues map to the branch type: by label first, then by title prefix. */
export interface TypeRules {
  labels: Record<string, string>;
  titlePrefixes: Record<string, string>;
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
  worktrees: { dir: string };
  start: { commitMessage: string; prBody: string };
}

/** Error in the config: exits 2 with the message. */
export class ConfigError extends Error {}

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
  worktrees: { dir: ".claude/worktrees" },
  start: {
    commitMessage: "chore: empieza el trabajo en la issue #{number}",
    prBody: "{keyword} #{number}\n\nEn progreso.",
  },
};

/** Placeholders the branch template must have. */
const TEMPLATE_PLACEHOLDERS = ["{number}", "{slug}"];

/** `owner/repo`. */
const REPO = /^[^/\s]+\/[^/\s]+$/;

/** A branch type: lowercase, as it goes in the branch name. */
const TYPE = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Whether a value is a plain object (not null nor an array).
 * @param value - The value.
 * @returns True if it is an object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks that an object only has known keys.
 * @param value - The object.
 * @param known - The keys it may have.
 * @param where - Its path in the config, for the error (`branch`).
 * @throws ConfigError if a key is unknown.
 */
function onlyKeys(
  value: Record<string, unknown>,
  known: string[],
  where: string,
): void {
  for (const key of Object.keys(value)) {
    if (key === "$schema" && where === "") continue;
    if (!known.includes(key))
      throw new ConfigError(
        `${CONFIG_PATH}: unknown key "${where === "" ? key : `${where}.${key}`}". Known: ${known.join(", ")}.`,
      );
  }
}

/**
 * An optional string of the config.
 * @param value - The value, or undefined.
 * @param where - Its path, for the error.
 * @param fallback - The default.
 * @returns The value or the default.
 * @throws ConfigError if it is not a non-empty string.
 */
function text<T extends string | null>(
  value: unknown,
  where: string,
  fallback: T,
): string | T {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.trim() === "")
    throw new ConfigError(`${CONFIG_PATH}: "${where}" must be a non-empty string.`);
  return value;
}

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
 * A section made only of optional strings (`worktrees`, `start`).
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
 * Validates a parsed config and fills in the defaults.
 * @param raw - The parsed JSON.
 * @returns The config.
 * @throws ConfigError if something is invalid.
 * @example parseConfig({ branch: { namer: "title" } }).branch.template // "{type}/{number}-{slug}"
 */
export function parseConfig(raw: unknown): FlowConfig {
  if (!isObject(raw)) throw new ConfigError(`${CONFIG_PATH} must be a JSON object.`);
  onlyKeys(raw, ["repo", "baseBranch", "branch", "worktrees", "start"], "");
  const repo = text(raw.repo, "repo", null);
  if (repo !== null && !REPO.test(repo))
    throw new ConfigError(`${CONFIG_PATH}: "repo" must be owner/repo.`);
  return {
    repo,
    baseBranch: text(raw.baseBranch, "baseBranch", null),
    branch: branchSection(raw.branch),
    worktrees: textSection(raw.worktrees, "worktrees", DEFAULT_CONFIG.worktrees),
    start: textSection(raw.start, "start", DEFAULT_CONFIG.start),
  };
}

/**
 * The root of the checkout that holds a directory, or null outside git.
 * @param cwd - The directory.
 * @returns The root.
 */
export function repoRoot(cwd: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Reads the config of the checkout that holds `cwd`. Outside git, or without the file,
 * every default applies.
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
