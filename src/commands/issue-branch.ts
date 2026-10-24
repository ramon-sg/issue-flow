/**
 * @file `issue-flow issue branch`: proposes the branch of some issues, or with `--missing`
 * of every open issue without a branch block, and adds a "Slug de rama" block to those
 * only after a confirmation (`--yes`, or answering in the terminal).
 */
import { createInterface } from "node:readline/promises";
import { editIssue, type IssueView, listIssues, viewIssue } from "@ramon-sg/github-rest";
import { hasBranchBlock, SLUG_HEADING, withSlugBlock } from "../branch-name.js";
import type { FlowConfig, Namer } from "../config.js";
import { type IssueInfo, type Proposal, proposeBranches } from "../propose.js";
import { emitJson, type Output, UsageError, warn } from "../output.js";

/** Issues `--missing` proposes at most when no `--limit` is given. */
export const MISSING_LIMIT = 100;

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
    const answer = await prompt.question(`Add the "Slug de rama" block to ${count} issue(s)? [y/N] `);
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
 * Adds the block to one issue, from a copy read right before writing: Claude and the
 * question can take minutes, and an edit made meanwhile must not be lost. If the issue got
 * a block in the meantime, it is left alone.
 * @param repo - `owner/repo`.
 * @param proposal - The issue and its branch.
 * @returns Whether the block was added (false if the issue already had one or is gone).
 * @throws GitHubError if GitHub fails.
 */
async function addBlock(repo: string, proposal: Proposal): Promise<boolean> {
  const fresh = await viewIssue(repo, proposal.number);
  if (fresh === null || hasBranchBlock(fresh.body)) return false;
  await editIssue(repo, proposal.number, { body: withSlugBlock(fresh.body, proposal.slug) });
  return true;
}

/**
 * The open issues without a block, new or old. GitHub can only skip one heading, so the
 * pages are read without a limit (up to github-rest's page ceiling) and both are filtered
 * here; otherwise issues with the old block would use up the limit and leave out, without
 * a warning, issues that have none.
 * @param options - The options (repo and limit).
 * @param out - Where to warn that the list was cut short.
 * @returns The issues, at most the limit.
 * @throws GitHubError if the issues cannot be listed.
 */
async function missingIssues(options: BranchOptions, out: Output): Promise<IssueView[]> {
  const listed = await listIssues(options.repo, {
    missingHeading: SLUG_HEADING,
    limit: Number.POSITIVE_INFINITY,
  });
  const limit = options.limit ?? MISSING_LIMIT;
  const issues = listed.issues.filter((issue) => !hasBranchBlock(issue.body));
  if (listed.truncated || issues.length > limit)
    warn(out, "GitHub has more issues than were read; run it again after this.");
  return issues.slice(0, limit);
}

/**
 * `issue branch --missing`: proposes the branch of every open issue without a block, new
 * or old, in one Claude call, and adds the slug block after confirming. Only the slug is
 * written, so a type Claude would pick is not used: the branch shown is the one the issue
 * will give, and an issue without a type gets a warning if the template uses `{type}`. A failed edit does not stop the
 * others.
 * @param options - The options.
 * @param out - Where to write.
 * @returns The exit code: 1 if an edit failed.
 * @throws GitHubError if the issues cannot be listed.
 */
export async function branchMissing(options: BranchOptions, out: Output): Promise<number> {
  if (options.json && !options.dryRun && !options.yes)
    throw new UsageError("--missing --json needs --dry-run or --yes: there is no terminal to confirm in.");
  const issues = await missingIssues(options, out);
  const { proposals, warnings } = proposeBranches(issues.map(info), options.config, {
    cwd: options.cwd,
    claudeType: false,
    ...(options.namer === undefined ? {} : { namer: options.namer }),
  });
  const untyped = proposals
    .filter((proposal) => proposal.type === null && options.config.branch.template.includes("{type}"))
    .map((proposal) => `#${proposal.number}: it has no type label, so its branch has no type until it gets one.`);
  for (const line of [...warnings, ...proposals.flatMap((proposal) => proposal.warnings), ...untyped])
    warn(out, line);
  print(proposals, out, options.json);
  if (proposals.length === 0 || !(await mayWrite(options, proposals.length, out))) return 0;
  let code = 0;
  for (const proposal of proposals) {
    try {
      if (!(await addBlock(options.repo, proposal))) {
        warn(out, `#${proposal.number}: it got a branch block or was deleted meanwhile; left alone.`);
        continue;
      }
      if (!options.json) out.stdout(`#${proposal.number}: block added.\n`);
    } catch (error) {
      warn(out, `#${proposal.number}: ${error instanceof Error ? error.message : String(error)}`);
      code = 1;
    }
  }
  return code;
}
