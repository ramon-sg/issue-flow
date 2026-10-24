/**
 * @file Proposes the branch of each issue, in this order: its "Slug de rama" block, its
 * older "Rama sugerida" block if it fits the issue, a slug from Claude (one call for every
 * issue that needs one), or the title's slug. Except for the older block, the branch is
 * always the repo's template. Ported from `propose_branch` in Abastio's
 * `scripts/start-issue.sh`, with the slug block and Claude as new steps.
 */
import {
  branchProblem,
  branchType,
  isSlug,
  renderBranch,
  suggestedBranch,
  suggestedSlug,
  titleSlug,
  typeNames,
} from "./branch-name.js";
import { type IssueToName, nameWithClaude } from "./claude-namer.js";
import type { FlowConfig, Namer } from "./config.js";

/** What is read of an issue to name its branch. */
export interface IssueInfo {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

/** Where a proposed branch came from. */
export type BranchSource = "slug" | "suggested" | "claude" | "title";

/** The branch proposed for an issue, with the slug and type it was made from. */
export interface Proposal {
  number: number;
  branch: string;
  slug: string;
  type: string | null;
  source: BranchSource;
  warnings: string[];
}

/** How to propose: the namer (the config's by default), where to run Claude and whether
 * a type Claude picks for an issue without one is used. */
export interface ProposeOptions {
  namer?: Namer;
  cwd: string;
  claudeType?: boolean;
}

/**
 * The proposal from the issue's own blocks: the slug block, or else the older block if it
 * fits the issue (used as is, with a warning if its prefix is not the issue's type).
 * @param issue - The issue.
 * @param type - Its type, or null.
 * @param template - The repo's template.
 * @returns The proposal, or the notes on why the blocks were not used.
 */
function fromBlocks(
  issue: IssueInfo,
  type: string | null,
  template: string,
): Proposal | { notes: string[] } {
  const { number } = issue;
  const slug = suggestedSlug(issue.body);
  if (isSlug(slug))
    return { number, branch: renderBranch(template, type, number, slug), slug, type, source: "slug", warnings: [] };
  if (slug !== null) return { notes: [`#${number}: "${slug}" in "Slug de rama" is not a valid slug; proposing another.`] };
  const branch = suggestedBranch(issue.body);
  const problem = branchProblem(branch, number);
  if (branch === null) return { notes: [] };
  if (problem !== null) return { notes: [`#${number}: ${problem}; proposing another.`] };
  const prefix = branch.includes("/") ? branch.slice(0, branch.indexOf("/")) : null;
  const warnings =
    type !== null && prefix !== null && prefix !== type
      ? [`#${number}: the suggested branch ${branch} does not start with ${type}/, the issue's type; using it anyway.`]
      : [];
  const own = branch.slice(branch.lastIndexOf("/") + 1).slice(`${number}-`.length);
  return { number, branch, slug: own, type, source: "suggested", warnings };
}

/**
 * Proposes a branch for each issue. Claude is called once, for every issue without a
 * usable block, and only if the namer is `claude`; if it fails or skips an issue, that
 * issue falls back to the title, with a warning.
 * @param issues - The issues.
 * @param config - The repo's config.
 * @param options - The namer, where to run Claude and whether Claude's type is used
 *   (true by default; false when only the slug will be written to the issue).
 * @returns One proposal per issue, in the same order, and the warnings of the whole batch
 *   (Claude not answering).
 * @example proposeBranches([issue], config, { cwd: process.cwd() }).proposals[0]?.branch
 */
export function proposeBranches(
  issues: IssueInfo[],
  config: FlowConfig,
  options: ProposeOptions,
): { proposals: Proposal[]; warnings: string[] } {
  const { template, types: rules } = config.branch;
  const typeOf = new Map(
    issues.map((issue) => [issue.number, branchType(rules, issue.labels, issue.title)]),
  );
  const proposals = new Map<number, Proposal>();
  const pending: IssueInfo[] = [];
  const notes = new Map<number, string[]>();
  for (const issue of issues) {
    const found = fromBlocks(issue, typeOf.get(issue.number) ?? null, template);
    if ("branch" in found) {
      proposals.set(issue.number, found);
      continue;
    }
    notes.set(issue.number, found.notes);
    pending.push(issue);
  }
  const namer = options.namer ?? config.branch.namer;
  const asked: IssueToName[] = pending.map((issue) => ({
    number: issue.number,
    title: issue.title,
    body: issue.body,
    type: typeOf.get(issue.number) ?? null,
  }));
  const answer =
    namer === "claude" && asked.length > 0
      ? nameWithClaude(asked, typeNames(rules), config.branch.claudeModel, options.cwd)
      : null;
  const prefixes = Object.keys(rules.titlePrefixes);
  for (const issue of pending) {
    const { number } = issue;
    const warnings = notes.get(number) ?? [];
    const own = typeOf.get(number) ?? null;
    const named = answer !== null && "names" in answer ? answer.names.get(number) : undefined;
    if (named !== undefined) {
      const type = options.claudeType === false ? own : named.type;
      proposals.set(number, {
        number,
        branch: renderBranch(template, type, number, named.slug),
        slug: named.slug,
        type,
        source: "claude",
        warnings,
      });
      continue;
    }
    if (answer !== null && "names" in answer)
      warnings.push(`#${number}: Claude gave no valid name; using the title.`);
    const slug = titleSlug(issue.title, prefixes);
    proposals.set(number, {
      number,
      branch: renderBranch(template, own, number, slug),
      slug,
      type: own,
      source: "title",
      warnings,
    });
  }
  return {
    proposals: issues.map((issue) => proposals.get(issue.number) as Proposal),
    warnings:
      answer !== null && "error" in answer
        ? [`${answer.error}; naming ${pending.length} issue(s) from the title.`]
        : [],
  };
}
