/**
 * @file Finds the plan of an issue, so a resumed session picks up from it: a plan the
 * branch's own commits touched, or a plan in the base branch whose `prs:` names one of the
 * issue's PRs. Ported from `find_plan` and `find_open_plan` in Abastio's
 * `scripts/start-issue.sh`.
 */
import { gitLines, hasLocal, onOrigin } from "./git.js";

/** Folders of finished and discarded plans, which never count as open. */
const CLOSED_FOLDERS = /\/(applied|abandoned)\//;

/** A PR in a `prs:` list: `12`, `#12` or `owner/repo#12`, with or without quotes. */
const PR_REFERENCE = /(?:([\w.-]+\/[\w.-]+))?#?(\d+)/g;

/** Where to look and what for. */
export interface PlanQuery {
  cwd: string;
  base: string;
  repo: string;
  dirs: string[];
}

/**
 * The first file in the order of the configured folders (plans before specs by default).
 * @param files - The files found.
 * @param dirs - The folders, in order of preference.
 * @returns The file, or null.
 */
function preferred(files: string[], dirs: string[]): string | null {
  for (const dir of dirs) {
    const found = files.find((file) => file.startsWith(`${dir}/`));
    if (found !== undefined) return found;
  }
  return null;
}

/**
 * Whether a `prs:` line names that PR of this repo. A reference to another repo does not
 * count.
 * @param line - The line.
 * @param repo - `owner/repo`.
 * @param number - The PR.
 * @returns True if it names it.
 */
function namesPr(line: string, repo: string, number: number): boolean {
  for (const match of line.matchAll(PR_REFERENCE)) {
    const [, other, digits] = match;
    if (Number(digits) !== number) continue;
    if (other === undefined || other.toLowerCase() === repo.toLowerCase()) return true;
  }
  return false;
}

/**
 * The documents of the base branch whose `prs:` names one of the PRs.
 * @param query - Where to look.
 * @param prs - The PRs.
 * @returns The paths, relative to the repo.
 */
function documentsOf(query: PlanQuery, prs: number[]): string[] {
  if (prs.length === 0) return [];
  const ref = `origin/${query.base}`;
  const hits = gitLines(query.cwd, ["grep", "-E", "^prs:", ref, "--", ...query.dirs]);
  const files: string[] = [];
  for (const hit of hits) {
    const [, path = "", line = ""] = /^[^:]+:([^:]+):(.*)$/.exec(hit) ?? [];
    if (prs.some((pr) => namesPr(line.slice("prs:".length), query.repo, pr))) files.push(path);
  }
  return [...new Set(files)];
}

/**
 * The plan of a branch being resumed: one its own commits touched or, if none, one in the
 * base branch that names its PR.
 * @param query - Where to look.
 * @param branch - The branch.
 * @param pr - Its PR, or null.
 * @returns The plan's path, or null.
 * @example findPlan(query, "feat/42-x", 7) // "docs/plans/2026-10-24-x.md"
 */
export function findPlan(query: PlanQuery, branch: string, pr: number | null): string | null {
  const ref = hasLocal(query.cwd, branch) ? branch : onOrigin(query.cwd, branch) ? `origin/${branch}` : null;
  const touched =
    ref === null
      ? []
      : gitLines(query.cwd, ["log", "--format=", "--name-only", `origin/${query.base}..${ref}`, "--", ...query.dirs]);
  const own = preferred([...new Set(touched)].sort(), query.dirs);
  if (own !== null) return own;
  return preferred(documentsOf(query, pr === null ? [] : [pr]), query.dirs);
}

/**
 * The plan an earlier round left open: a document of the base branch that names one of
 * the merged PRs and is not in `applied/` nor `abandoned/`.
 * @param query - Where to look.
 * @param merged - The issue's merged PRs.
 * @returns The plan's path, or null.
 * @example findOpenPlan(query, [7]) // "docs/plans/2026-10-24-x.md"
 */
export function findOpenPlan(query: PlanQuery, merged: number[]): string | null {
  const open = documentsOf(query, merged).filter((file) => !CLOSED_FOLDERS.test(`/${file}`));
  return preferred(open.sort(), query.dirs);
}
