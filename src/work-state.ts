/**
 * @file What an issue already has, from github-rest's `readWork`: its PRs, the branches it
 * used and the live ones that can be resumed. Ported from `detect_existing` and
 * `branch_pr` in Abastio's `scripts/start-issue.sh`.
 */
import type { IssueEntry, PrState } from "@ramon-sg/github-rest";

/** A PR of the issue from this repo (not from a fork). */
export interface IssuePr {
  number: number;
  branch: string;
  state: PrState;
  head: string;
}

/** The issue's work, ready to choose a branch. */
export interface WorkState {
  prs: IssuePr[];
  forks: number[];
  mergedPrs: number[];
  mergedBranches: string[];
  known: string[];
  candidates: string[];
}

/**
 * Sorted and without repeats, like jq's `unique`.
 * @param names - The names.
 * @returns The names.
 */
const unique = (names: string[]): string[] => [...new Set(names)].sort();

/**
 * The issue's work. Branches of merged PRs do not count as live; a branch counts if it is
 * in origin, local, or has an open PR. Without GitHub (offline) only local branches are
 * seen.
 * @param entry - The issue in `readWork`'s output.
 * @returns The work.
 * @example workState(output.issues[0]).candidates // ["feat/42-x"]
 */
export function workState(entry: IssueEntry): WorkState {
  const work = "work" in entry ? entry.work : { prs: [], branches: [] };
  const local = "local" in entry ? entry.local : { branches: [], worktrees: [] };
  const own = work.prs.filter((pr) => !pr.fork);
  const merged = work.branches.filter((branch) => branch.merged).map((branch) => branch.name);
  return {
    prs: own.map(({ number, branch, state, head }) => ({ number, branch, state, head })),
    forks: work.prs.filter((pr) => pr.fork).map((pr) => pr.number),
    mergedPrs: own.filter((pr) => pr.state === "MERGED").map((pr) => pr.number),
    mergedBranches: merged,
    known: unique([...work.branches.map((branch) => branch.name), ...local.branches]),
    candidates: unique([
      ...work.branches.filter((branch) => !branch.merged && branch.remote).map((branch) => branch.name),
      ...local.branches.filter((branch) => !merged.includes(branch)),
      ...own.filter((pr) => pr.state === "OPEN").map((pr) => pr.branch),
    ]),
  };
}

/**
 * The PR of a branch being resumed: the open one or, if there is none, the closed one
 * that was never merged (it gets reopened).
 * @param prs - The issue's PRs.
 * @param branch - The branch.
 * @returns Its number and state, or null if it has none.
 * @example branchPr(prs, "feat/42-x") // { number: 7, state: "OPEN" }
 */
export function branchPr(
  prs: IssuePr[],
  branch: string,
): { number: number; state: "OPEN" | "CLOSED" } | null {
  const mine = prs.filter((pr) => pr.branch === branch);
  const open = mine.find((pr) => pr.state === "OPEN");
  if (open !== undefined) return { number: open.number, state: "OPEN" };
  const closed = mine.find((pr) => pr.state === "CLOSED");
  return closed === undefined ? null : { number: closed.number, state: "CLOSED" };
}

/**
 * The open PRs of the issue on other branches.
 * @param prs - The issue's PRs.
 * @param branch - The branch being worked on.
 * @returns Their numbers.
 * @example openPrsElsewhere(prs, "feat/42-x") // [150]
 */
export function openPrsElsewhere(prs: IssuePr[], branch: string): number[] {
  return prs.filter((pr) => pr.state === "OPEN" && pr.branch !== branch).map((pr) => pr.number);
}
