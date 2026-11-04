/**
 * @file The usage text of the CLI, printed with `--help` and after a usage error. The text
 * itself lives in the message catalogs (`usage.main`, `usage.start`).
 */
import type { Messages } from "./messages/index.js";

/**
 * The usage text for a command: its own if it has one, else the whole CLI's.
 * @param words - The command's words, as given (`["issue", "start", "42"]`).
 * @param t - The messages of the terminal.
 * @returns The text.
 * @example usageOf(["issue", "start"], messages("en")) === messages("en").usage.start
 */
export function usageOf(words: string[], t: Messages): string {
  return words.slice(0, 2).join(" ") === "issue start" ? t.usage.start : t.usage.main;
}
