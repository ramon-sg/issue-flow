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
  const where = local ? (remote ? "local and in origin" : "only local") : remote ? "only in origin" : "deleted";
  const text = `${branch} (${where}, ${ownCommits(state.mainRoot, branch, state.base)} own commits)`;
  const pr = withPr ? branchPr(state.work.prs, branch) : null;
  return pr === null ? text : `${text}, PR #${pr.number}, ${pr.state}`;
}

/**
 * The actions it will take, joined with " + ".
 * @param state - The start.
 * @returns The text.
 * @example plannedActions(state) // "create the branch from origin/main + empty commit + push -u + …"
 */
export function plannedActions(state: StartState): string {
  if (state.mode === "cloud") return "open the cloud session, which makes the branch, the commit, the PR and the assignment";
  const actions = placeActions(state);
  const { mainRoot, branch } = state;
  const { number, remoteSession } = state.options;
  const commit = needsStartCommit(state);
  if (commit) actions.push("empty commit");
  if (commit || !onOrigin(mainRoot, branch)) actions.push("push -u");
  if (state.pr === null) {
    const first = prBody(state.options.config.start.prBody, number, state.kind, state.issue.url).split("\n")[0];
    actions.push(`draft PR (${first})`);
    const others = openPrsElsewhere(state.work.prs, branch);
    if (state.kind === "part" && others.length > 0)
      actions.push(`Part of #${number} in the open PRs (${others.map((pr) => `#${pr}`).join(", ")})`);
  }
  if (state.pr?.state === "CLOSED") actions.push(`reopen PR #${state.pr.number}`);
  if (state.issue.assignees.length === 0) actions.push(`assign #${number} to @me`);
  if (state.mode === "here" && remoteSession !== null && !sameCloudSession(state.cloudSession, remoteSession))
    actions.push("note the session in the PR");
  if (actions.length > 0) return actions.join(" + ");
  return state.adopted === null ? "none: only open the session" : "none: everything was already done";
}

/**
 * The first action, about the branch: rename the adopted one, create it, make the
 * worktree on it or check it out.
 * @param state - The start.
 * @returns None or one action.
 */
function placeActions(state: StartState): string[] {
  const { adopted, branch } = state;
  if (adopted !== null) return adopted.current === branch ? [] : [`rename the branch ${adopted.current} to ${branch}`];
  if (state.found === null) return [`create the branch from origin/${state.base}`];
  if (state.mode === "worktree" && !existsSync(state.workDir)) return ["create the worktree on the branch"];
  if (state.mode !== "worktree" && currentBranch(state.workDir) !== branch) return ["check out the branch"];
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
      lines.push(line("Note:", `${merged} has ${count.out} commits that are not in ${state.base}`));
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
  if (state.found !== null) {
    const found = [`branch ${describeBranch(state, state.branch, false)}`];
    if (state.pr !== null) found.push(`PR #${state.pr.number}, ${state.pr.state}`);
    if (state.mode === "worktree" && existsSync(state.workDir))
      found.push(`worktree at ${relative(state.mainRoot, state.workDir)}`);
    return [line("Found:", found.join("\n")), line("Planned:", state.plan ?? "no")];
  }
  if (work.candidates.length > 0)
    return [
      line("Branches:", work.candidates.map((branch) => describeBranch(state, branch, true)).join("\n")),
      line("New branch:", state.branch),
    ];
  if (work.mergedPrs.length === 0) return [line("Branch:", state.branch)];
  return [
    line("Round:", `${work.mergedPrs.length + 1} (already merged: PR ${work.mergedPrs.map((pr) => `#${pr}`).join(", ")})`),
    line("Planned:", state.plan ?? "no"),
    ...mergedLeftovers(state),
    line("Branch:", state.branch),
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
  const header = issueHeader(issue.body);
  const color = issueColor(state.labels, options.config.colors);
  const opensHere = state.adopted === null && (state.mode === "worktree" || state.mode === "branch");
  return [
    line("Issue:", `#${issue.number} — ${issue.title}`),
    ...(header.length > 0 ? [line("Summary:", header.join("\n"))] : []),
    line("Labels:", state.labels.join(" · ")),
    line("Color:", color === null ? "none" : `${color.color} (${color.label})`),
    ...branchLines(state),
    line("Mode:", modeText(state)),
    ...(opensHere ? [...sessionLines(state), line("Permissions:", permissions.label)] : []),
    line("Actions:", plannedActions(state)),
  ].join("");
}

/**
 * Where the work goes, for the summary.
 * @param state - The start.
 * @returns The text.
 */
function modeText(state: StartState): string {
  if (state.adopted !== null) return `adopted worktree at ${state.workDir}`;
  if (state.mode === "here") return "this session (--here)";
  if (state.mode === "cloud") return "cloud (the session makes the branch and the PR)";
  return state.mode === "worktree" ? `worktree at ${relative(state.mainRoot, state.workDir)}` : "branch in the main checkout";
}

/**
 * The session lines: the branch's local session or, with `--teleport`, the cloud one it
 * brings. Without `--teleport`, a cloud session noted in the PR adds how to bring it.
 * @param state - The start.
 * @returns The lines.
 */
function sessionLines(state: StartState): string[] {
  const { cloudSession, options } = state;
  if (options.teleport)
    return [line("Session:", cloudSession === null ? "cloud (chosen from teleport's list)" : `cloud ${cloudSession} (brought with teleport)`)];
  const saved = savedSession(state.commonDir, state.branch) !== null;
  const lines = [line("Session:", `${sessionName(state.branch, state.mode)}${saved ? " (exists, resumed)" : ""}`)];
  if (cloudSession !== null)
    lines.push(line("Cloud:", `the issue has a cloud session (${cloudSessionUrl(cloudSession)}). To bring it: ${again(options.number, "--teleport")}`));
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
