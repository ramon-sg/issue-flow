/**
 * @file Proposes the branch of each issue, in this order: its "Rama sugerida" block if it
 * fits the issue, a name from Claude (one call for every issue that needs one), or the
 * repo's template with the title's slug. Ported from `propose_branch` in Abastio's
 * `scripts/start-issue.sh`, with Claude as the new middle step.
 */
import {
  branchProblem,
  branchType,
  renderBranch,
  suggestedBranch,
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
export type BranchSource = "suggested" | "claude" | "title";

/** The branch proposed for an issue. */
export interface Proposal {
  number: number;
  branch: string;
  source: BranchSource;
  warnings: string[];
}

/**
 * The proposal for an issue whose block fits: it is used as is, with a warning if its
 * prefix is not the issue's type.
 * @param issue - The issue.
 * @param branch - Its suggested branch.
 * @param type - Its type, or null.
 * @returns The proposal.
 */
function fromSuggested(issue: IssueInfo, branch: string, type: string | null): Proposal {
  const prefix = branch.includes("/") ? branch.slice(0, branch.indexOf("/")) : null;
  const warnings =
    type !== null && prefix !== null && prefix !== type
      ? [`#${issue.number}: the suggested branch ${branch} does not start with ${type}/, the issue's type; using it anyway.`]
      : [];
  return { number: issue.number, branch, source: "suggested", warnings };
}

/**
 * Proposes a branch for each issue. Claude is called once, for every issue without a
 * usable block, and only if the namer is `claude`; if it fails or skips an issue, that
 * issue falls back to the title, with a warning.
 * @param issues - The issues.
 * @param config - The repo's config.
 * @param options - The namer (the config's by default) and where to run Claude.
 * @returns One proposal per issue, in the same order, and the warnings of the whole batch
 *   (Claude not answering).
 * @example proposeBranches([issue], config, { cwd: process.cwd() }).proposals[0]?.branch
 */
export function proposeBranches(
  issues: IssueInfo[],
  config: FlowConfig,
  options: { namer?: Namer; cwd: string },
): { proposals: Proposal[]; warnings: string[] } {
  const rules = config.branch.types;
  const typeOf = new Map(
    issues.map((issue) => [issue.number, branchType(rules, issue.labels, issue.title)]),
  );
  const proposals = new Map<number, Proposal>();
  const pending: IssueInfo[] = [];
  const notes = new Map<number, string[]>();
  for (const issue of issues) {
    const suggested = suggestedBranch(issue.body);
    const problem = branchProblem(suggested, issue.number);
    if (problem === null && suggested !== null) {
      proposals.set(issue.number, fromSuggested(issue, suggested, typeOf.get(issue.number) ?? null));
      continue;
    }
    notes.set(issue.number, suggested === null ? [] : [`#${issue.number}: ${problem}; proposing another.`]);
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
    const warnings = notes.get(issue.number) ?? [];
    const named = answer !== null && "names" in answer ? answer.names.get(issue.number) : undefined;
    if (named !== undefined) {
      proposals.set(issue.number, {
        number: issue.number,
        branch: renderBranch(config.branch.template, named.type, issue.number, named.slug),
        source: "claude",
        warnings,
      });
      continue;
    }
    if (answer !== null && "names" in answer)
      warnings.push(`#${issue.number}: Claude gave no valid name; using the title.`);
    proposals.set(issue.number, {
      number: issue.number,
      branch: renderBranch(
        config.branch.template,
        typeOf.get(issue.number) ?? null,
        issue.number,
        titleSlug(issue.title, prefixes),
      ),
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
