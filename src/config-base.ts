/**
 * @file What every part of the config's validation shares: where the file lives, its error
 * and the checks of objects, keys and strings.
 */

import type { Messages } from "./messages/index.js";

/** Where the config lives, relative to the repo root. */
export const CONFIG_PATH = ".agents/flow.json";

/** Error in the config: exits 2 with the message. */
export class ConfigError extends Error {}

/**
 * An error about a part of the config, with the file's path in front.
 * @param message - What is wrong.
 * @returns The error.
 * @example configError('"art" must be true or false.').message // '.agents/flow.json: "art" must be ...'
 */
export function configError(message: string): ConfigError {
  return new ConfigError(`${CONFIG_PATH}: ${message}`);
}

/**
 * Whether a value is a plain object (not null nor an array).
 * @param value - The value.
 * @returns True if it is an object.
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks that an object only has known keys.
 * @param value - The object.
 * @param known - The keys it may have.
 * @param where - Its path in the config, for the error (`branch`).
 * @param t - The messages, for the error.
 * @throws ConfigError if a key is unknown.
 */
export function onlyKeys(
  value: Record<string, unknown>,
  known: string[],
  where: string,
  t: Messages,
): void {
  for (const key of Object.keys(value)) {
    if (key === "$schema" && where === "") continue;
    if (!known.includes(key))
      throw configError(t.config.unknownKey(where === "" ? key : `${where}.${key}`, known.join(", ")));
  }
}

/**
 * An optional string of the config.
 * @param value - The value, or undefined.
 * @param where - Its path, for the error.
 * @param fallback - The default.
 * @param t - The messages, for the error.
 * @returns The value or the default.
 * @throws ConfigError if it is not a non-empty string.
 */
export function text<T extends string | null>(
  value: unknown,
  where: string,
  fallback: T,
  t: Messages,
): string | T {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.trim() === "")
    throw configError(t.config.nonEmptyString(where));
  return value;
}
