/**
 * @file Branch names of issues, with no git, GitHub nor Claude: read the "Slug de rama"
 * block (or the older "Rama sugerida" one, with the whole branch), check that a name fits
 * the issue, find the issue's type, make a slug from the title and render the repo's
 * template. Ported from Abastio's `scripts/lib/issue.sh` and `scripts/lib/project.sh`.
 */
import type { TypeRules } from "./config.js";

/**
 * Start of the block that holds the branch slug in the issue body, as the `github-issues`
 * skill writes it. Only the slug: the number is the issue's and the type comes from its
 * labels, so the block can be written before the issue has a number and never goes stale.
 * Without the closing `**`, so `**Slug de rama:**` also matches.
 */
export const SLUG_HEADING = "**Slug de rama";

/** The full heading written when a block is added. */
export const SLUG_BLOCK_TITLE = "**Slug de rama**";

/**
 * Start of the older block, with the whole branch (`fix/42-cart`), that Abastio and Clean
 * Queen issues still have. It is read, never written.
 */
export const BRANCH_HEADING = "**Rama sugerida";

/** Longest slug made from a title (the `github-issues` skill asks for about 40). */
export const SLUG_MAX = 40;

/** Title prefixes always removed from a slug, besides the repo's own. */
const COMMON_PREFIXES = [
  "bug:",
  "mejora:",
  "feat:",
  "fix:",
  "docs:",
  "spike:",
  "chore:",
  "refactor:",
];

/** Text between backticks. */
const BACKTICKS = /`([^`]+)`/;

/** A phase tag at the start of a title (`[F0-09]`). */
const PHASE_TAG = /^\[[^\]]*\]\s*/;

/** A valid slug: lowercase words of letters and digits joined by single dashes. */
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * What is between backticks on the line of a heading or, if not there, on the first
 * non-empty line after it.
 * @param body - The issue body.
 * @param heading - The start of the heading line.
 * @returns The text, or null if the heading is missing or has no backticks.
 */
function blockValue(body: string, heading: string): string | null {
  const lines = body.replace(/\r/g, "").split("\n");
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start === -1) return null;
  const sameLine = BACKTICKS.exec(lines[start] as string);
  if (sameLine) return sameLine[1] as string;
  const next = lines.slice(start + 1).find((line) => line.trim() !== "");
  return next === undefined ? null : (BACKTICKS.exec(next)?.[1] ?? null);
}

/**
 * The slug of the "Slug de rama" block.
 * @param body - The issue body.
 * @returns The slug as written (maybe invalid), or null if there is no block.
 * @example suggestedSlug("**Slug de rama**\n`cart-total`") // "cart-total"
 */
export function suggestedSlug(body: string): string | null {
  return blockValue(body, SLUG_HEADING);
}

/**
 * The branch of the older "Rama sugerida" block.
 * @param body - The issue body.
 * @returns The branch, or null if the block is missing or has no backticks.
 * @example suggestedBranch("**Rama sugerida**\n`fix/9-a`") // "fix/9-a"
 */
export function suggestedBranch(body: string): string | null {
  return blockValue(body, BRANCH_HEADING);
}

/**
 * Whether the body already has a branch block, new or old.
 * @param body - The issue body.
 * @returns True if it has one.
 * @example hasBranchBlock("**Rama sugerida**\n`fix/9-a`") // true
 */
export function hasBranchBlock(body: string): boolean {
  return body.includes(SLUG_HEADING) || body.includes(BRANCH_HEADING);
}

/**
 * Whether a value is a slug this tool accepts, from a person or from Claude: lowercase
 * words joined by single dashes (as `start-issue` checks), at most `SLUG_MAX` characters.
 * @param value - The value.
 * @returns True if it is one.
 * @example isSlug("cart-total") // true
 */
export function isSlug(value: unknown): value is string {
  return typeof value === "string" && value.length <= SLUG_MAX && SLUG.test(value);
}

/**
 * Why a branch does not fit the issue: it must be `<prefix>/<n>-<slug>`, with any number
 * of prefix folders (or none) and a lowercase slug. No part may start with `.` or `-`, nor
 * hold `..`: the branch later becomes a folder under the worktrees directory.
 * @param branch - The branch, or null if the issue has none.
 * @param number - The issue number.
 * @returns The reason, or null if it fits.
 * @example branchProblem("feat/21-x", 214) // "the suggested branch \"feat/21-x\" is not <prefix>/214-<slug>"
 */
export function branchProblem(branch: string | null, number: number): string | null {
  if (branch === null) return 'the issue has no "Rama sugerida" block';
  const fits = new RegExp(`^([a-z0-9][a-z0-9._-]*/)*${number}-[a-z0-9][a-z0-9._-]*$`);
  return fits.test(branch) && !branch.includes("..")
    ? null
    : `the suggested branch "${branch}" is not <prefix>/${number}-<slug>`;
}

/**
 * The type of an issue: by label first (in the order of the config), then by title prefix
 * ignoring case.
 * @param types - The repo's rules.
 * @param labels - The issue's labels.
 * @param title - The issue's title.
 * @returns The type, or null if nothing matches.
 * @example branchType(rules, ["bug"], "x") // "fix"
 */
export function branchType(
  types: TypeRules,
  labels: string[],
  title: string,
): string | null {
  for (const [label, type] of Object.entries(types.labels))
    if (labels.includes(label)) return type;
  const lower = title.toLowerCase();
  for (const [prefix, type] of Object.entries(types.titlePrefixes))
    if (lower.startsWith(prefix.toLowerCase())) return type;
  return null;
}

/**
 * Every type the config can give, without repeats, in order.
 * @param types - The repo's rules.
 * @returns The types.
 * @example typeNames(rules) // ["fix", "feat", "docs", "spike"]
 */
export function typeNames(types: TypeRules): string[] {
  return [
    ...new Set([
      ...Object.values(types.labels),
      ...Object.values(types.titlePrefixes),
    ]),
  ];
}

/**
 * A slug cut to `SLUG_MAX` characters by whole words; a single longer word is cut.
 * @param words - The words, already clean.
 * @returns The slug, possibly empty.
 */
function cutSlug(words: string[]): string {
  let out = "";
  for (const word of words) {
    const next = out === "" ? word : `${out}-${word}`;
    if (next.length > SLUG_MAX) break;
    out = next;
  }
  return out === "" ? (words[0] ?? "").slice(0, SLUG_MAX) : out;
}

/**
 * Branch slug from the title, for an issue with no usable block: without the
 * type prefix (`bug:`, `mejora:`…) or the phase tag (`[F0-09]`), lowercase, without
 * accents or symbols, cut at `SLUG_MAX` characters by whole words.
 * @param title - The title.
 * @param prefixes - The repo's title prefixes, removed as well.
 * @returns The slug, or `issue` if nothing is left.
 * @example titleSlug("bug: El carro (año 2026)", []) // "el-carro-ano-2026"
 */
export function titleSlug(title: string, prefixes: string[] = []): string {
  let text = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(PHASE_TAG, "")
    .trim();
  for (const prefix of [...prefixes, ...COMMON_PREFIXES]) {
    if (!text.startsWith(prefix.toLowerCase())) continue;
    text = text.slice(prefix.length).trim();
    break;
  }
  const words = text.split(/[^a-z0-9]+/).filter((word) => word !== "");
  return cutSlug(words) || "issue";
}

/**
 * The branch from the repo's template. Without a type, the separators left over are
 * removed (`{type}/{number}-{slug}` gives `42-slug`).
 * @param template - The template, with `{type}`, `{number}` and `{slug}`.
 * @param type - The type, or null.
 * @param number - The issue number.
 * @param slug - The slug.
 * @returns The branch.
 * @example renderBranch("{type}/{number}-{slug}", "fix", 42, "cart") // "fix/42-cart"
 */
export function renderBranch(
  template: string,
  type: string | null,
  number: number,
  slug: string,
): string {
  const out = template
    .replaceAll("{type}", type ?? "")
    .replaceAll("{number}", String(number))
    .replaceAll("{slug}", slug);
  if (type !== null) return out;
  return out
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/(\/-|-\/)/g, "/")
    .replace(/^[/-]+/, "")
    .replace(/[/-]+$/, "");
}

/** A blank line, with or without `\r`. */
const BLANK_LINE = /\r?\n[ \t]*\r?\n/;

/**
 * The issue body with a "Slug de rama" block after its first paragraph (the header the
 * `github-issues` skill writes), or as the whole body if it is empty. If the first
 * paragraph opens a code block, the block goes first, so it never lands inside the code.
 * The rest of the body is kept byte for byte.
 * @param body - The current body.
 * @param slug - The slug.
 * @returns The new body.
 * @example withSlugBlock("Header.\n\nDetail.", "cart") // "Header.\n\n**Slug de rama**\n`cart`\n\nDetail."
 */
export function withSlugBlock(body: string, slug: string): string {
  const block = `${SLUG_BLOCK_TITLE}\n\`${slug}\``;
  if (body.trim() === "") return block;
  const blank = BLANK_LINE.exec(body);
  const header = blank === null ? body : body.slice(0, blank.index);
  if (header.includes("```")) return `${block}\n\n${body}`;
  if (blank === null) return `${body.trimEnd()}\n\n${block}`;
  return `${header}\n\n${block}${body.slice(blank.index)}`;
}
