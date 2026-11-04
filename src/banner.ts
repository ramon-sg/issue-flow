/**
 * @file The block of the final messages: a title with a status mark, a few aligned rows and
 * the next command, with Kuro (the mascot) beside it when the terminal can show it.
 */

import type { FlowConfig } from "./config.js";
import type { Output } from "./output.js";

/** How the block feels: done, failed or waiting for an answer. */
export type Mood = "ok" | "error" | "question";

/** What a final message says. */
export interface Block {
  mood: Mood;
  title: string;
  /** Label and value pairs, aligned in a column. */
  rows?: [label: string, value: string][];
  /** The command to copy, under its own label. */
  next?: { label: string; command: string };
  /** Free lines after the rows. */
  lines?: string[];
}

/** Kuro, the drawing of issue #49, without trailing spaces. */
export const KURO: readonly string[] = [
  "    ▄█████▄",
  " ≋≋██▀▀▀▀▀██",
  "    █ ▄  ▄ █   ╱",
  "    ▀█▄▄▄▄█▀  ╱",
];

/** Columns Kuro takes, where the text begins. */
const TEXT_COLUMN = 26;
/** Indent of the text without Kuro. */
const INDENT = 2;

const MARKS: Record<Mood, string> = { ok: "[ok]", error: "[!]", question: "[?]" };
const MOOD_COLOR: Record<Mood, number> = { ok: 32, error: 31, question: 33 };

/**
 * Wraps text in an ANSI SGR code.
 * @param text - The text.
 * @param code - The SGR code.
 * @param on - Whether to color.
 * @returns The text, colored or not.
 * @example paint("x", 1, false) // "x"
 */
function paint(text: string, code: number, on: boolean): string {
  return on ? `\x1b[${code}m${text}\x1b[0m` : text;
}

/**
 * Prints a block. Values are never cut or wrapped: a command to copy must stay whole.
 * @param block - What to say.
 * @param opts - Whether to draw Kuro and whether to color.
 * @returns The text, with a blank line before and after.
 * @example banner({ mood: "ok", title: "Done" }, { art: false, color: false }) // "\n  [ok] Done\n\n"
 */
export function banner(block: Block, opts: { art: boolean; color: boolean }): string {
  const text: string[] = [`${paint(MARKS[block.mood], MOOD_COLOR[block.mood], opts.color)} ${paint(block.title, MOOD_COLOR[block.mood], opts.color)}`];
  if (block.rows?.length) {
    const width = Math.max(...block.rows.map(([label]) => [...label].length)) + 2;
    text.push("");
    for (const [label, value] of block.rows) text.push(label + " ".repeat(width - [...label].length) + value);
  }
  if (block.lines?.length) text.push("", ...block.lines);
  if (block.next) text.push("", block.next.label, `  ${paint(block.next.command, 1, opts.color)}`);

  const out: string[] = [];
  if (opts.art) {
    // Kuro takes rows 0-3 and the text starts on row 1.
    const total = Math.max(KURO.length, text.length + 1);
    for (let row = 0; row < total; row++) {
      const left = KURO[row] ?? "";
      const right = text[row - 1];
      out.push(right === undefined ? left : left + " ".repeat(TEXT_COLUMN - [...left].length) + right);
    }
  } else {
    for (const line of text) out.push(line === "" ? "" : " ".repeat(INDENT) + line);
  }
  return `\n${out.map((line) => line.trimEnd()).join("\n")}\n\n`;
}

/**
 * The options of a block for one stream: Kuro and color only on a terminal.
 * @param out - Where the command writes.
 * @param stream - The stream the block goes to.
 * @param config - The repo's config, or null without one.
 * @returns Whether to draw Kuro and whether to color.
 * @example blockOpts(out, "stdout", null) // { art: true, color: true } on a terminal
 */
export function blockOpts(out: Output, stream: "stdout" | "stderr", config: FlowConfig | null): { art: boolean; color: boolean } {
  const terminal = out.terminal[stream];
  return { art: terminal && config?.art !== false, color: terminal && !process.env.NO_COLOR };
}
