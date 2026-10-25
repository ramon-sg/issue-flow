/**
 * @file Questions on the terminal, one line each. It reads stdin as it comes (a terminal
 * or a pipe), keeps what was typed ahead for the next question, and pauses stdin between
 * questions so Claude, opened later, gets the terminal to itself.
 */
import type { Output } from "./output.js";

/** What was read and not used yet. */
let pending = "";

/** Whether stdin ended. */
let ended = false;

/**
 * The next line of stdin, without its end.
 * @returns The line, or null if stdin ended with nothing left.
 */
function readLine(): Promise<string | null> {
  return new Promise((resolve) => {
    const take = (): boolean => {
      const end = pending.indexOf("\n");
      if (end === -1 && !ended) return false;
      const line = end === -1 ? pending : pending.slice(0, end);
      pending = end === -1 ? "" : pending.slice(end + 1);
      cleanUp();
      resolve(end === -1 && line === "" ? null : line.replace(/\r$/, ""));
      return true;
    };
    const onData = (chunk: string): void => {
      pending += chunk;
      take();
    };
    const onEnd = (): void => {
      ended = true;
      take();
    };
    const cleanUp = (): void => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.pause();
    };
    if (take()) return;
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.resume();
  });
}

/**
 * Drops what was typed ahead and not used, so it never answers a question asked later
 * (after Claude, the one about deleting the worktree).
 * @example forgetTypedAhead()
 */
export function forgetTypedAhead(): void {
  pending = "";
}

/**
 * Asks a question and returns the answer, trimmed.
 * @param out - Where the question goes (stderr, so stdout stays for results).
 * @param question - The question, with its options.
 * @returns The answer; empty if stdin ended.
 * @example await ask(out, "Start the issue? [y/N] ")
 */
export async function ask(out: Output, question: string): Promise<string> {
  out.stderr(question);
  const answer = await readLine();
  if (answer === null) out.stderr("\n");
  return (answer ?? "").trim();
}

/**
 * Asks a yes or no question; anything but a yes, an empty answer included, is no.
 * @param out - Where the question goes.
 * @param question - The question, without `[y/N]`.
 * @returns True if the answer is yes.
 * @example await confirm(out, "Start the issue?")
 */
export async function confirm(out: Output, question: string): Promise<boolean> {
  return /^(y|yes|s|si|sí)$/i.test(await ask(out, `${question} [y/N] `));
}
