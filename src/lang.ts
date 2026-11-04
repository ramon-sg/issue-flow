/**
 * @file The language of the terminal: `--lang`, then `ISSUE_FLOW_LANG`, then Spanish.
 * `LANG` and `LC_ALL` are not read.
 */
import { UsageError } from "./output.js";

/** A language the terminal speaks. */
export type Lang = "es" | "en";

/** A `--lang` or `ISSUE_FLOW_LANG` value that is neither `es` nor `en`. */
export class LangError extends UsageError {
  /**
   * @param source - Where the value came from (`--lang` or `ISSUE_FLOW_LANG`).
   * @param value - The value.
   */
  constructor(
    readonly source: string,
    readonly value: string,
  ) {
    super(`${source} expects es or en: ${value}`);
  }
}

/**
 * Whether a value is a language.
 * @param value - The value.
 * @returns True for `es` and `en`.
 */
function isLang(value: string): value is Lang {
  return value === "es" || value === "en";
}

/**
 * The language of the terminal.
 * @param flag - The `--lang` value, or undefined.
 * @param env - The environment.
 * @returns The language: the flag, else `ISSUE_FLOW_LANG` (empty counts as unset), else `es`.
 * @throws LangError if the value is neither `es` nor `en`.
 * @example resolveLang(undefined, { ISSUE_FLOW_LANG: "en" }) // "en"
 */
export function resolveLang(flag: string | undefined, env: NodeJS.ProcessEnv): Lang {
  const fromEnv = env.ISSUE_FLOW_LANG?.trim() === "" ? undefined : env.ISSUE_FLOW_LANG;
  const source = flag !== undefined ? "--lang" : "ISSUE_FLOW_LANG";
  const value = flag ?? fromEnv;
  if (value === undefined) return "es";
  const lang = value.trim().toLowerCase();
  if (!isLang(lang)) throw new LangError(source, value);
  return lang;
}
