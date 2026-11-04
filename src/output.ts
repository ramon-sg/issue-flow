/**
 * @file Where commands write, and the usage error. Commands get an `Output` instead of
 * writing to `process` directly, so the entry point decides about the terminal.
 */

import type { Lang } from "./lang.js";
import { type Messages, messages } from "./messages/index.js";

/** Usage error: exits 2 and prints the usage text. */
export class UsageError extends Error {}

/** Where a command writes, and whether someone can answer a question. */
export interface Output {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  interactive: boolean;
  /** The messages in the terminal's language. */
  t: Messages;
  lang: Lang;
  /** Whether each stream is a terminal (for color). */
  terminal: { stdout: boolean; stderr: boolean };
}

/**
 * The process's output; interactive when both stdin and stdout are a terminal.
 * @param lang - The language of the terminal.
 * @returns The output.
 * @example processOutput("es").interactive
 */
export function processOutput(lang: Lang): Output {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    t: messages(lang),
    lang,
    terminal: { stdout: Boolean(process.stdout.isTTY), stderr: Boolean(process.stderr.isTTY) },
  };
}

/**
 * Prints a warning on stderr with the program's name.
 * @param out - Where to write.
 * @param text - The warning.
 * @example warn(out, "nothing written")
 */
export function warn(out: Output, text: string): void {
  out.stderr(`issue-flow: ${text}\n`);
}

/**
 * Prints a value as one line of JSON on stdout.
 * @param out - Where to write.
 * @param value - The value.
 * @example emitJson(out, { ok: true })
 */
export function emitJson(out: Output, value: unknown): void {
  out.stdout(`${JSON.stringify(value)}\n`);
}
