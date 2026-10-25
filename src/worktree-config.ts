/**
 * @file The `worktrees` section of `.agents/flow.json`: where worktrees go, the steps that
 * prepare one and clean it before deleting it, its block of ports, and the prefixes of its
 * Docker Compose projects. Everything that belongs to one project (installing, a database,
 * Docker) is a step here; `issue-flow` only runs them.
 */
import { CONFIG_PATH, ConfigError, isObject, onlyKeys, text } from "./config-base.js";

/** A command of the setup or the teardown of a worktree. */
export interface Step {
  name: string;
  run: string;
  trusted: boolean;
  once: boolean;
}

/** The range of ports split in blocks, one block per worktree. */
export interface PortsConfig {
  start: number;
  blockSize: number;
  blocks: number;
}

/** The `worktrees` section, with its defaults. */
export interface WorktreesConfig {
  dir: string;
  setup: Step[];
  teardown: Step[];
  ports: PortsConfig | null;
  dockerProjects: string[];
}

/**
 * The ports with `"ports": true`: 1000 blocks of 10 from 20000, far from the usual ones
 * (3000, 9000), from Docker's ephemeral ones (from 32768) and the same as Abastio's.
 */
export const DEFAULT_PORTS: PortsConfig = { start: 20000, blockSize: 10, blocks: 1000 };

/** The first port a block can use: below it, ports need root. */
const MIN_PORT = 1024;

/** One past the last port. */
const PORT_LIMIT = 65536;

/** A step's name: lowercase, for `--only` and the marker of `once`. */
const STEP_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** A Docker Compose project prefix, as Compose accepts project names. */
const PROJECT = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * An optional boolean of a step.
 * @param value - The value, or undefined.
 * @param where - Its path, for the error.
 * @returns The value, false if missing.
 * @throws ConfigError if it is not a boolean.
 */
function flag(value: unknown, where: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new ConfigError(`${CONFIG_PATH}: "${where}" must be true or false.`);
  return value;
}

/**
 * A list of steps. A teardown step has no `trusted` nor `once`: it cleans up, whatever the
 * code.
 * @param value - The list, or undefined.
 * @param where - Its path (`worktrees.setup`).
 * @param teardown - Whether these are teardown steps.
 * @returns The steps.
 * @throws ConfigError if a step is invalid or two share a name.
 */
function steps(value: unknown, where: string, teardown: boolean): Step[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ConfigError(`${CONFIG_PATH}: "${where}" must be a list of steps.`);
  const names = new Set<string>();
  return value.map((raw: unknown, index) => {
    const at = `${where}[${index}]`;
    if (!isObject(raw)) throw new ConfigError(`${CONFIG_PATH}: "${at}" must be an object with "name" and "run".`);
    onlyKeys(raw, teardown ? ["name", "run"] : ["name", "run", "trusted", "once"], at);
    const name = text(raw.name, `${at}.name`, null);
    if (name === null || !STEP_NAME.test(name))
      throw new ConfigError(`${CONFIG_PATH}: "${at}.name" must be lowercase letters, digits and dashes.`);
    if (names.has(name)) throw new ConfigError(`${CONFIG_PATH}: "${where}" has two steps named "${name}".`);
    names.add(name);
    const run = text(raw.run, `${at}.run`, null);
    if (run === null) throw new ConfigError(`${CONFIG_PATH}: "${at}.run" must be a non-empty string.`);
    return { name, run, trusted: flag(raw.trusted, `${at}.trusted`), once: flag(raw.once, `${at}.once`) };
  });
}

/**
 * A whole number of the ports.
 * @param value - The value, or undefined.
 * @param key - Its key.
 * @returns The number, or the default's.
 * @throws ConfigError if it is not a positive whole number.
 */
function count(value: unknown, key: keyof PortsConfig): number {
  if (value === undefined) return DEFAULT_PORTS[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    throw new ConfigError(`${CONFIG_PATH}: "worktrees.ports.${key}" must be a positive whole number.`);
  return value;
}

/**
 * The ports: off (absent or false), the defaults (true), or a range. Its blocks are split
 * in two halves, one for macOS and one for the rest, so they must be even.
 * @param value - The value, or undefined.
 * @returns The ports, or null if off.
 * @throws ConfigError if the range does not fit.
 */
function ports(value: unknown): PortsConfig | null {
  if (value === undefined || value === false) return null;
  if (value === true) return DEFAULT_PORTS;
  if (!isObject(value)) throw new ConfigError(`${CONFIG_PATH}: "worktrees.ports" must be true, false or an object.`);
  onlyKeys(value, ["start", "blockSize", "blocks"], "worktrees.ports");
  const range = { start: count(value.start, "start"), blockSize: count(value.blockSize, "blockSize"), blocks: count(value.blocks, "blocks") };
  if (range.blocks % 2 !== 0) throw new ConfigError(`${CONFIG_PATH}: "worktrees.ports.blocks" must be even.`);
  if (range.start < MIN_PORT || range.start + range.blockSize * range.blocks > PORT_LIMIT)
    throw new ConfigError(`${CONFIG_PATH}: "worktrees.ports" must stay between ${MIN_PORT} and ${PORT_LIMIT - 1}.`);
  return range;
}

/**
 * The Docker Compose project prefixes of a worktree (each worktree's project is
 * `<prefix>-<folder>-<hash>`); the cleanup only ever deletes projects that start with one.
 * @param value - The list, or undefined.
 * @returns The prefixes.
 * @throws ConfigError if one is not a valid project name.
 */
function dockerProjects(value: unknown): string[] {
  if (value === undefined) return [];
  const valid = Array.isArray(value) && value.every((item) => typeof item === "string" && PROJECT.test(item));
  if (!valid)
    throw new ConfigError(`${CONFIG_PATH}: "worktrees.dockerProjects" must be a list of Compose project prefixes (lowercase letters, digits, - and _).`);
  return value as string[];
}

/**
 * The `worktrees` section, with its defaults.
 * @param value - The section, or undefined.
 * @param fallback - The defaults.
 * @returns The section.
 * @throws ConfigError if something is invalid.
 * @example worktreesSection({ ports: true }, defaults).ports // { start: 20000, blockSize: 10, blocks: 1000 }
 */
export function worktreesSection(value: unknown, fallback: WorktreesConfig): WorktreesConfig {
  if (value === undefined) return fallback;
  if (!isObject(value)) throw new ConfigError(`${CONFIG_PATH}: "worktrees" must be an object.`);
  onlyKeys(value, ["dir", "setup", "teardown", "ports", "dockerProjects"], "worktrees");
  return {
    dir: text(value.dir, "worktrees.dir", fallback.dir),
    setup: steps(value.setup, "worktrees.setup", false),
    teardown: steps(value.teardown, "worktrees.teardown", true),
    ports: ports(value.ports),
    dockerProjects: dockerProjects(value.dockerProjects),
  };
}
