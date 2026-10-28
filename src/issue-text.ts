/**
 * @file Text about an issue for starting it, with no git, GitHub nor Claude: its header for
 * the summary, the session's color and name, the next free branch, the PR body and the
 * prompt Claude opens with. Ported from Abastio's `scripts/lib/issue.sh`.
 */
import { BRANCH_HEADING, SLUG_HEADING } from "./branch-name.js";

/** Lines of the issue's header shown before confirming. */
export const HEADER_MAX_LINES = 6;

/** Width the header is wrapped to. */
export const HEADER_WIDTH = 80;

/** Prefix of the session's name when it works in a worktree. */
export const WORKTREE_SESSION_PREFIX = "w-";

/**
 * Where the work happens: a worktree of its own, the main checkout, the checkout where it
 * runs inside a cloud session (`--here`), or a cloud session it opens (`--cloud`).
 */
export type StartMode = "worktree" | "branch" | "here" | "cloud";

/** Label of the PR body's line with the link of its cloud session. */
export const CLOUD_SESSION_LABEL = "Cloud session:";

/** Labels of that line that are still read (Abastio's), never written. */
const LEGACY_CLOUD_SESSION_LABELS = ["Sesión en la nube:"];

/** A cloud session id: `session_…`, or `cse_…` as the session sees itself. */
const CLOUD_SESSION_ID = /\b(?:session|cse)_[A-Za-z0-9]+/;

/** The issue number in a branch: `<n>-` at the start or after a `/`. */
const BRANCH_NUMBER = /(?:^|\/)(\d+)-/;

/** Whether the PR closes the issue, or is only part of it (the issue has another branch). */
export type PrKind = "closes" | "part";

/**
 * Wraps a line at spaces, like `fold -s`.
 * @param line - The line.
 * @param width - The width.
 * @returns The wrapped lines.
 */
function wrap(line: string, width: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const word of line.split(" ")) {
    const next = current === "" ? word : `${current} ${word}`;
    if (next.length > width && current !== "") {
      out.push(current);
      current = word;
      continue;
    }
    current = next;
  }
  out.push(current);
  return out;
}

/**
 * The issue's header for the summary: its first paragraph, before any branch block,
 * wrapped and cut to `HEADER_MAX_LINES` lines.
 * @param body - The issue body.
 * @returns The lines, maybe none.
 * @example issueHeader("Qué se pide.\n\nDetalle.") // ["Qué se pide."]
 */
export function issueHeader(body: string): string[] {
  const lines: string[] = [];
  for (const line of body.replace(/\r/g, "").split("\n")) {
    if (line.startsWith(SLUG_HEADING) || line.startsWith(BRANCH_HEADING)) break;
    if (line.trim() === "" && lines.length > 0) break;
    if (line.trim() !== "") lines.push(...wrap(line.trimEnd(), HEADER_WIDTH));
  }
  return lines.slice(0, HEADER_MAX_LINES);
}

/**
 * The session's color and the label that gives it: the first entry of the config's map
 * whose key starts some label, in the map's order (so `critical-path` can win over `P3:`).
 * @param labels - The issue's labels.
 * @param colors - Label prefix to color.
 * @returns The label and color, or null if no label matches.
 * @example issueColor(["P1: urgent"], { "P1:": "red" }) // { label: "P1: urgent", color: "red" }
 */
export function issueColor(
  labels: string[],
  colors: Record<string, string>,
): { label: string; color: string } | null {
  for (const [prefix, color] of Object.entries(colors)) {
    const label = labels.find((name) => name.startsWith(prefix));
    if (label !== undefined) return { label, color };
  }
  return null;
}

/**
 * The Claude session's name: the branch, with `w-` in front in a worktree.
 * @param branch - The branch.
 * @param mode - Where the work happens.
 * @returns The name.
 * @example sessionName("feat/42-x", "worktree") // "w-feat/42-x"
 */
export function sessionName(branch: string, mode: StartMode): string {
  return mode === "worktree" ? `${WORKTREE_SESSION_PREFIX}${branch}` : branch;
}

/**
 * The folder name of a branch's worktree and session file: the branch with every `/` as
 * `+`, like `claude --worktree`, so it is one folder.
 * @param branch - The branch.
 * @returns The name.
 * @example dirName("feat/42-x") // "feat+42-x"
 */
export function dirName(branch: string): string {
  return branch.replaceAll("/", "+");
}

/**
 * The branch for a new round of the issue: the proposed one if the issue never used it,
 * or with `-2`, `-3`… until one is free.
 * @param proposed - The proposed branch.
 * @param used - Every branch the issue already used.
 * @returns The branch.
 * @example nextBranch("feat/42-x", ["feat/42-x"]) // "feat/42-x-2"
 */
export function nextBranch(proposed: string, used: string[]): string {
  let candidate = proposed;
  for (let round = 2; used.includes(candidate); round += 1) candidate = `${proposed}-${round}`;
  return candidate;
}

/**
 * Fills `{name}` placeholders in one pass, so a value that holds `{plan}` is not filled
 * again. Unknown placeholders are left as they are.
 * @param template - The text.
 * @param values - The values.
 * @returns The text.
 * @example fill("#{number}", { number: "4" }) // "#4"
 */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

/**
 * The draft PR's body from the config's template.
 * @param template - The template, with `{keyword}`, `{number}` and `{url}`.
 * @param number - The issue.
 * @param kind - Whether the PR closes the issue or is part of it.
 * @param url - The issue's URL.
 * @returns The body.
 * @example prBody("{keyword} #{number}", 4, "part", url) // "Part of #4"
 */
export function prBody(template: string, number: number, kind: PrKind, url: string): string {
  return fill(template, { keyword: kind === "part" ? "Part of" : "Closes", number: String(number), url });
}

/**
 * The body of a PR with the words that close the issue (`Closes`, `Fixes`, `Resolves` and
 * their forms, with or without `:`) changed to `Part of`, because the issue now has more
 * than one branch. Other numbers that start the same (`#2140`) are left alone.
 * @param body - The PR body.
 * @param number - The issue.
 * @returns The new body.
 * @example bodyToPartOf("Closes #4\n\nx", 4) // "Part of #4\n\nx"
 */
export function bodyToPartOf(body: string, number: number): string {
  const closing = new RegExp(
    `(^|[^\\w])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\\s+#${number}(?!\\d)`,
    "gi",
  );
  return body.replace(closing, `$1Part of #${number}`);
}

/**
 * The claude.ai link of a cloud session. The link uses `session_` even when the id comes
 * as `cse_`.
 * @param id - The id.
 * @returns The link.
 * @example cloudSessionUrl("cse_01A") // "https://claude.ai/code/session_01A"
 */
export function cloudSessionUrl(id: string): string {
  return `https://claude.ai/code/${id.replace(/^cse_/, "session_")}`;
}

/**
 * Whether two ids are the same cloud session (`cse_…` and `session_…` lead to one link).
 * @param one - An id, or null.
 * @param other - The other id.
 * @returns True if they are.
 * @example sameCloudSession("cse_01A", "session_01A") // true
 */
export function sameCloudSession(one: string | null, other: string): boolean {
  return one !== null && cloudSessionUrl(one) === cloudSessionUrl(other);
}

/**
 * Whether a line of a PR body is the one with the cloud session.
 * @param text - The line.
 * @returns True if it is.
 */
function isSessionLine(text: string): boolean {
  return [CLOUD_SESSION_LABEL, ...LEGACY_CLOUD_SESSION_LABELS].some((label) => text.includes(label));
}

/**
 * The cloud session noted in a PR body, so `--teleport` finds it from any machine.
 * @param body - The PR body.
 * @returns The id, or null.
 * @example cloudSessionOf("Closes #4\n\nCloud session: https://claude.ai/code/session_01A") // "session_01A"
 */
export function cloudSessionOf(body: string): string | null {
  const found = body.split("\n").find(isSessionLine);
  return found === undefined ? null : (CLOUD_SESSION_ID.exec(found)?.[0] ?? null);
}

/**
 * The PR body with the line of a cloud session: it replaces the line of an earlier
 * session (one line stays, the last session that took the issue) or goes at the end.
 * @param body - The PR body.
 * @param id - The session.
 * @returns The new body.
 * @example withCloudSession("Closes #4", "cse_01A") // "Closes #4\n\nCloud session: https://claude.ai/code/session_01A"
 */
export function withCloudSession(body: string, id: string): string {
  const note = `${CLOUD_SESSION_LABEL} ${cloudSessionUrl(id)}`;
  const lines = body.split("\n");
  const first = lines.findIndex(isSessionLine);
  if (first === -1) return body === "" ? note : `${body.replace(/\n+$/, "")}\n\n${note}`;
  return lines.flatMap((text, index) => (index === first ? [note] : isSessionLine(text) ? [] : [text])).join("\n");
}

/**
 * The issue a branch belongs to, by its `<n>-` at the start or after a `/` (`feat/214-x`,
 * `214-x`, `ramon/sub/214-x`).
 * @param branch - The branch.
 * @returns The number, or null.
 * @example issueOfBranch("feat/214-x") // 214
 */
export function issueOfBranch(branch: string): number | null {
  const found = BRANCH_NUMBER.exec(branch);
  return found?.[1] === undefined ? null : Number(found[1]);
}
