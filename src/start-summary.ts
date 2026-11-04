/**
 * @file The summary `issue start` shows before asking: the issue, what it already has,
 * the branch, the place, the session and the actions it will take. Ported from
 * `plan_actions`, `describe_branch` and `print_summary` in Abastio's
 * `scripts/start-issue.sh`.
 */
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { currentBranch, git, hasLocal, onOrigin, ownCommits } from "./git.js";
import { cloudSessionUrl, issueColor, issueHeader, prBody, sameCloudSession, sessionName } from "./issue-text.js";
import { type PermissionArgs, savedSession } from "./launch.js";
import { again, type StartState } from "./start-state.js";
import type { StepPlace } from "./worktree-steps.js";
import { branchPr, openPrsElsewhere } from "./work-state.js";

/** Width of the summary's labels. */
const LABEL_WIDTH = 14;

/**
 * A summary line: the label padded, then the value; later lines of the value are indented.
 * @param label - The label, with its colon.
 * @param value - The value, maybe several lines.
 * @returns The line.
 */
function line(label: string, value: string): string {
  const pad = " ".repeat(LABEL_WIDTH);
  return `${label.padEnd(LABEL_WIDTH)}${value.split("\n").join(`\n${pad}`)}\n`;
}

/**
 * Whether the start commit is needed: no PR and the branch has no commits of its own, so
 * GitHub would not let a PR open.
 * @param state - The start.
 * @returns True if it is.
 * @example needsStartCommit(state)
 */
export function needsStartCommit(state: StartState): boolean {
  return state.pr === null && ownCommits(state.mainRoot, state.branch, state.base) === 0;
}

/**
 * One branch on one line: where it is, its own commits and, if asked, its PR.
 * @param state - The start.
 * @param branch - The branch.
 * @param withPr - Whether to add its PR.
 * @returns The text.
 * @example describeBranch(state, "feat/42-x", true) // "feat/42-x (only in origin, 0 own commits), PR #7, OPEN"
 */
export function describeBranch(state: StartState, branch: string, withPr: boolean): string {
  const local = hasLocal(state.mainRoot, branch);
  const remote = onOrigin(state.mainRoot, branch);
  const t = state.out.t.start;
  const where = local ? (remote ? t.where.both : t.where.local) : remote ? t.where.origin : t.where.deleted;
  const text = t.branchText(branch, where, ownCommits(state.mainRoot, branch, state.base));
  const pr = withPr ? branchPr(state.work.prs, branch) : null;
  return pr === null ? text : t.branchPr(text, pr.number, pr.state);
}

/**
 * The actions it will take, joined with " + ".
 * @param state - The start.
 * @returns The text.
 * @example plannedActions(state) // "create the branch from origin/main + empty commit + push + …"
 */
export function plannedActions(state: StartState): string {
  const t = state.out.t.start;
  if (state.mode === "cloud") return t.action.cloud;
  const actions = placeActions(state);
  const { mainRoot, branch } = state;
  const { number, remoteSession } = state.options;
  const commit = needsStartCommit(state);
  if (commit) actions.push(t.action.emptyCommit);
  if (commit || !onOrigin(mainRoot, branch)) actions.push(t.action.push);
  if (state.pr === null) {
    const first = prBody(state.options.config.start.prBody, number, state.kind, state.issue.url).split("\n")[0];
    actions.push(t.action.draftPr(first ?? ""));
    const others = openPrsElsewhere(state.work.prs, branch);
    if (state.kind === "part" && others.length > 0)
      actions.push(t.action.partOf(number, others.map((pr) => `#${pr}`).join(", ")));
  }
  if (state.pr?.state === "CLOSED") actions.push(t.action.reopen(state.pr.number));
  if (state.issue.assignees.length === 0) actions.push(t.action.assign(number));
  if (state.mode === "here" && remoteSession !== null && !sameCloudSession(state.cloudSession, remoteSession))
    actions.push(t.action.noteSession);
  if (actions.length > 0) return actions.join(" + ");
  return state.adopted === null ? t.action.onlySession : t.action.allDone;
}

/**
 * The first action, about the branch: rename the adopted one, create it, make the
 * worktree on it or check it out.
 * @param state - The start.
 * @returns None or one action.
 */
function placeActions(state: StartState): string[] {
  const { adopted, branch } = state;
  const t = state.out.t.start.action;
  if (adopted !== null) return adopted.current === branch ? [] : [t.rename(adopted.current, branch)];
  if (state.found === null) return [t.create(state.base)];
  if (state.mode === "worktree" && !existsSync(state.workDir)) return [t.createWorktree];
  if (state.mode !== "worktree" && currentBranch(state.workDir) !== branch) return [t.checkout];
  return [];
}

/**
 * Merged branches that got commits after their merge: a new round starts from the base
 * and does not bring them. The heads of their merged PRs count as merged too, because a
 * squash or rebase merge leaves the branch's commits out of the base.
 * @param state - The start.
 * @returns One warning line per branch.
 */
function mergedLeftovers(state: StartState): string[] {
  const lines: string[] = [];
  for (const merged of state.work.mergedBranches) {
    const ref = hasLocal(state.mainRoot, merged) ? merged : `origin/${merged}`;
    const heads = state.work.prs
      .filter((pr) => pr.branch === merged && pr.state === "MERGED" && pr.head !== "")
      .map((pr) => pr.head)
      .filter((head) => git(state.mainRoot, ["cat-file", "-e", `${head}^{commit}`]).ok);
    const count = git(state.mainRoot, ["rev-list", "--count", ref, "--not", `origin/${state.base}`, ...heads]);
    if (count.ok && count.out !== "0")
      lines.push(line(state.out.t.start.label.note, state.out.t.start.leftover(merged, count.out, state.base)));
  }
  return lines;
}

/**
 * The lines about the branch: what was found, the live branches and the new one, or the
 * round and the new branch.
 * @param state - The start.
 * @returns The lines.
 */
function branchLines(state: StartState): string[] {
  const { work } = state;
  const t = state.out.t.start;
  if (state.found !== null) {
    const found = [t.found.branch(describeBranch(state, state.branch, false))];
    if (state.pr !== null) found.push(t.found.pr(state.pr.number, state.pr.state));
    if (state.mode === "worktree" && existsSync(state.workDir))
      found.push(t.found.worktree(relative(state.mainRoot, state.workDir)));
    return [line(t.label.found, found.join("\n")), line(t.label.planned, state.plan ?? t.no)];
  }
  if (work.candidates.length > 0)
    return [
      line(t.label.branches, work.candidates.map((branch) => describeBranch(state, branch, true)).join("\n")),
      line(t.label.newBranch, state.branch),
    ];
  if (work.mergedPrs.length === 0) return [line(t.label.branch, state.branch)];
  return [
    line(t.label.round, t.round(work.mergedPrs.length + 1, work.mergedPrs.map((pr) => `#${pr}`).join(", "))),
    line(t.label.planned, state.plan ?? t.no),
    ...mergedLeftovers(state),
    line(t.label.branch, state.branch),
  ];
}

/**
 * The summary that is confirmed.
 * @param state - The start.
 * @param permissions - How Claude will open.
 * @returns The text.
 * @example summary(state, permissions)
 */
export function summary(state: StartState, permissions: PermissionArgs): string {
  const { issue, options } = state;
  const t = state.out.t.start;
  const header = issueHeader(issue.body);
  const color = issueColor(state.labels, options.config.colors);
  const opensHere = state.adopted === null && (state.mode === "worktree" || state.mode === "branch");
  return [
    line(t.label.issue, `#${issue.number} — ${issue.title}`),
    ...(header.length > 0 ? [line(t.label.summary, header.join("\n"))] : []),
    line(t.label.labels, state.labels.join(" · ")),
    line(t.label.color, color === null ? t.none : `${color.color} (${color.label})`),
    ...branchLines(state),
    line(t.label.mode, modeText(state)),
    ...(opensHere ? [...sessionLines(state), line(t.label.permissions, permissions.label)] : []),
    line(t.label.actions, plannedActions(state)),
  ].join("");
}

/**
 * Where the work goes, for the summary.
 * @param state - The start.
 * @returns The text.
 */
function modeText(state: StartState): string {
  const t = state.out.t.start.mode;
  if (state.adopted !== null) return t.adopted(state.workDir);
  if (state.mode === "here") return t.here;
  if (state.mode === "cloud") return t.cloud;
  return state.mode === "worktree" ? t.worktree(relative(state.mainRoot, state.workDir)) : t.branch;
}

/**
 * The session lines: the branch's local session or, with `--teleport`, the cloud one it
 * brings. Without `--teleport`, a cloud session noted in the PR adds how to bring it.
 * @param state - The start.
 * @returns The lines.
 */
function sessionLines(state: StartState): string[] {
  const { cloudSession, options } = state;
  const t = state.out.t.start;
  if (options.teleport)
    return [line(t.label.session, cloudSession === null ? t.session.teleportList : t.session.teleported(cloudSession))];
  const saved = savedSession(state.commonDir, state.branch) !== null;
  const lines = [line(t.label.session, `${sessionName(state.branch, state.mode)}${saved ? t.session.resumed : ""}`)];
  if (cloudSession !== null)
    lines.push(line(t.label.cloud, t.session.cloudNote(cloudSessionUrl(cloudSession), again(options.number, "--teleport"))));
  return lines;
}

/**
 * Where the worktree's steps run, for its setup and its teardown.
 * @param state - The start.
 * @returns The place.
 * @example stepPlaceOf(state).root
 */
export function stepPlaceOf(state: StartState): StepPlace {
  const { workDir, mainRoot, base, out, options } = state;
  return { root: workDir, mainRoot, base, config: options.config, out, remote: false };
}
