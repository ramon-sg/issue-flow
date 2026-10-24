/**
 * @file `issue-flow issue branch`: proposes the branch of some issues, or with `--missing`
 * of every open issue without a "Rama sugerida" block, and adds the block to those only
 * after a confirmation (`--yes`, or answering in the terminal).
 */
import { createInterface } from "node:readline/promises";
import { editIssue, listIssues, viewIssue } from "@ramon-sg/github-rest";
import { BRANCH_HEADING, withBranchBlock } from "../branch-name.js";
import type { FlowConfig, Namer } from "../config.js";
import { type IssueInfo, type Proposal, proposeBranches } from "../propose.js";
import { emitJson, type Output, UsageError, warn } from "../output.js";

/** Options of `issue branch`. */
export interface BranchOptions {
  repo: string;
  config: FlowConfig;
  cwd: string;
  namer?: Namer;
  json: boolean;
  limit?: number;
  yes: boolean;
  dryRun: boolean;
}

/**
 * An issue of github-rest as what `proposeBranches` reads.
 * @param issue - The issue.
 * @returns Number, title, body and label names.
 */
function info(issue: {
  number: number;
  title: string;
  body: string;
  labels: { name: string }[];
}): IssueInfo {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    labels: issue.labels.map(({ name }) => name),
  };
}

/**
 * Prints the proposals: as JSON, or one line each (`#42 fix/42-cart (claude)`).
 * @param proposals - The proposals.
 * @param out - Where to write.
 * @param json - Whether to print JSON.
 */
function print(proposals: Proposal[], out: Output, json: boolean): void {
  if (json) return emitJson(out, proposals);
  for (const proposal of proposals)
    out.stdout(`#${proposal.number} ${proposal.branch} (${proposal.source})\n`);
}

/**
 * `issue branch <n>...`: the branch of each issue, without writing anything.
 * @param numbers - The issues.
 * @param options - The options.
 * @param out - Where to write.
 * @returns The exit code: 1 if an issue does not exist.
 * @throws GitHubError if GitHub fails.
 */
export async function branchOf(
  numbers: number[],
  options: BranchOptions,
  out: Output,
): Promise<number> {
  const issues: IssueInfo[] = [];
  let code = 0;
  for (const number of numbers) {
    const found = await viewIssue(options.repo, number);
    if (found === null) {
      warn(out, `issue #${number} does not exist in ${options.repo}.`);
      code = 1;
      continue;
    }
    issues.push(info(found));
  }
  const { proposals, warnings } = proposeBranches(issues, options.config, {
    cwd: options.cwd,
    ...(options.namer === undefined ? {} : { namer: options.namer }),
  });
  for (const line of [...warnings, ...proposals.flatMap((proposal) => proposal.warnings)])
    warn(out, line);
  print(proposals, out, options.json);
  return code;
}

/**
 * Asks in the terminal whether to write the blocks.
 * @param count - How many issues.
 * @returns True if the answer is yes.
 */
async function confirm(count: number): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await prompt.question(`Add the "Rama sugerida" block to ${count} issue(s)? [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

/**
 * Whether the blocks may be written: `--yes`, or a yes in the terminal. Never with
 * `--dry-run`, and never without a terminal and without `--yes`.
 * @param options - The options.
 * @param count - How many issues.
 * @param out - Where to write.
 * @returns True if they may be written.
 */
async function mayWrite(options: BranchOptions, count: number, out: Output): Promise<boolean> {
  if (options.dryRun) return false;
  if (options.yes) return true;
  if (!out.interactive) {
    warn(out, "nothing written: pass --yes to add the blocks.");
    return false;
  }
  return confirm(count);
}

/**
 * `issue branch --missing`: proposes the branch of every open issue without a block, in
 * one Claude call, and adds the block after confirming. A failed edit does not stop the
 * others.
 * @param options - The options.
 * @param out - Where to write.
 * @returns The exit code: 1 if an edit failed.
 * @throws GitHubError if the issues cannot be listed.
 */
export async function branchMissing(options: BranchOptions, out: Output): Promise<number> {
  if (options.json && !options.dryRun && !options.yes)
    throw new UsageError("--missing --json needs --dry-run or --yes: there is no terminal to confirm in.");
  const { issues, truncated } = await listIssues(options.repo, {
    missingHeading: BRANCH_HEADING,
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });
  if (truncated) warn(out, "GitHub has more issues than were read; run it again after this.");
  const bodies = new Map(issues.map((issue) => [issue.number, issue.body]));
  const { proposals, warnings } = proposeBranches(issues.map(info), options.config, {
    cwd: options.cwd,
    ...(options.namer === undefined ? {} : { namer: options.namer }),
  });
  for (const line of [...warnings, ...proposals.flatMap((proposal) => proposal.warnings)])
    warn(out, line);
  print(proposals, out, options.json);
  if (proposals.length === 0 || !(await mayWrite(options, proposals.length, out))) return 0;
  let code = 0;
  for (const proposal of proposals) {
    try {
      const body = withBranchBlock(bodies.get(proposal.number) ?? "", proposal.branch);
      await editIssue(options.repo, proposal.number, { body });
      if (!options.json) out.stdout(`#${proposal.number}: block added.\n`);
    } catch (error) {
      warn(out, `#${proposal.number}: ${error instanceof Error ? error.message : String(error)}`);
      code = 1;
    }
  }
  return code;
}
