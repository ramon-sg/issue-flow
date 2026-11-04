/** @file The message catalogs. */
import type { Lang } from "../lang.js";
import { en } from "./en.js";
import { es, type Messages } from "./es.js";

export type { Messages };

/**
 * The catalog of a language.
 * @param lang - The language.
 * @returns Its messages.
 * @example messages("en").lang.invalid("--lang", "fr")
 */
export function messages(lang: Lang): Messages {
  return lang === "es" ? es : en;
}
