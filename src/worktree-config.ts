/**
 * @file The `worktrees` section of `.agents/flow.json`: where worktrees go, the steps that
 * prepare one and clean it before deleting it, its block of ports, and the prefixes of its
 * Docker Compose projects. Everything that belongs to one project (installing, a database,
 * Docker) is a step here; `issue-flow` only runs them.
 */
import { configError, isObject, onlyKeys, text } from "./config-base.js";
import { type Messages, messages } from "./messages/index.js";

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
 * @param t - The messages.
 * @returns The value, false if missing.
 * @throws ConfigError if it is not a boolean.
 */
function flag(value: unknown, where: string, t: Messages): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw configError(t.config.mustBeBoolean(where));
  return value;
}

/**
 * A list of steps. A teardown step has no `trusted` nor `once`: it cleans up, whatever the
 * code.
 * @param value - The list, or undefined.
 * @param where - Its path (`worktrees.setup`).
 * @param teardown - Whether these are teardown steps.
 * @param t - The messages.
 * @returns The steps.
 * @throws ConfigError if a step is invalid or two share a name.
 */
function steps(value: unknown, where: string, teardown: boolean, t: Messages): Step[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw configError(t.config.stepsList(where));
  const names = new Set<string>();
  return value.map((raw: unknown, index) => {
    const at = `${where}[${index}]`;
    if (!isObject(raw)) throw configError(t.config.stepObject(at));
    onlyKeys(raw, teardown ? ["name", "run"] : ["name", "run", "trusted", "once"], at, t);
    const name = text(raw.name, `${at}.name`, null, t);
    if (name === null || !STEP_NAME.test(name))
      throw configError(t.config.stepName(at));
    if (names.has(name)) throw configError(t.config.stepTwice(where, name));
    names.add(name);
    const run = text(raw.run, `${at}.run`, null, t);
    if (run === null) throw configError(t.config.nonEmptyString(`${at}.run`));
    return { name, run, trusted: flag(raw.trusted, `${at}.trusted`, t), once: flag(raw.once, `${at}.once`, t) };
  });
}

/**
 * A whole number of the ports.
 * @param value - The value, or undefined.
 * @param key - Its key.
 * @param t - The messages.
 * @returns The number, or the default's.
 * @throws ConfigError if it is not a positive whole number.
 */
function count(value: unknown, key: keyof PortsConfig, t: Messages): number {
  if (value === undefined) return DEFAULT_PORTS[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    throw configError(t.config.portCount(key));
  return value;
}

/**
 * The ports: off (absent or false), the defaults (true), or a range. Its blocks are split
 * in two halves, one for macOS and one for the rest, so they must be even.
 * @param value - The value, or undefined.
 * @param t - The messages.
 * @returns The ports, or null if off.
 * @throws ConfigError if the range does not fit.
 */
function ports(value: unknown, t: Messages): PortsConfig | null {
  if (value === undefined || value === false) return null;
  if (value === true) return DEFAULT_PORTS;
  if (!isObject(value)) throw configError(t.config.portsShape);
  onlyKeys(value, ["start", "blockSize", "blocks"], "worktrees.ports", t);
  const range = { start: count(value.start, "start", t), blockSize: count(value.blockSize, "blockSize", t), blocks: count(value.blocks, "blocks", t) };
  if (range.blocks % 2 !== 0) throw configError(t.config.portsEven);
  if (range.start < MIN_PORT || range.start + range.blockSize * range.blocks > PORT_LIMIT)
    throw configError(t.config.portsRange(MIN_PORT, PORT_LIMIT - 1));
  return range;
}

/**
 * The Docker Compose project prefixes of a worktree (each worktree's project is
 * `<prefix>-<folder>-<hash>`); the cleanup only ever deletes projects that start with one.
 * @param value - The list, or undefined.
 * @param t - The messages.
 * @returns The prefixes.
 * @throws ConfigError if one is not a valid project name.
 */
function dockerProjects(value: unknown, t: Messages): string[] {
  if (value === undefined) return [];
  const valid = Array.isArray(value) && value.every((item) => typeof item === "string" && PROJECT.test(item));
  if (!valid)
    throw configError(t.config.dockerProjects);
  return value as string[];
}

/**
 * The `worktrees` section, with its defaults.
 * @param value - The section, or undefined.
 * @param fallback - The defaults.
 * @param t - The messages, for the errors (English by default).
 * @returns The section.
 * @throws ConfigError if something is invalid.
 * @example worktreesSection({ ports: true }, defaults).ports // { start: 20000, blockSize: 10, blocks: 1000 }
 */
export function worktreesSection(value: unknown, fallback: WorktreesConfig, t: Messages = messages("en")): WorktreesConfig {
  if (value === undefined) return fallback;
  if (!isObject(value)) throw configError(t.config.mustBeObject("worktrees"));
  onlyKeys(value, ["dir", "setup", "teardown", "ports", "dockerProjects"], "worktrees", t);
  return {
    dir: text(value.dir, "worktrees.dir", fallback.dir, t),
    setup: steps(value.setup, "worktrees.setup", false, t),
    teardown: steps(value.teardown, "worktrees.teardown", true, t),
    ports: ports(value.ports, t),
    dockerProjects: dockerProjects(value.dockerProjects, t),
  };
}
