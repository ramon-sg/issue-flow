/**
 * @file `issue-flow issue start <n>`: starts or resumes the work on an issue and opens
 * Claude in the same terminal. It reads the issue and its work, picks the branch (the one
 * it has, or a new one named like `issue branch`), shows a summary and asks, then creates
 * what is missing (worktree or branch, start commit, push, draft PR, assignment) and opens
 * Claude with the repo's permission mode. With `--plan` it only prints the branch and the
 * prompt as one line of JSON. `--adopt`, `--here`, `--cloud` and `--teleport` are in
 * `start-modes.ts`. Ported from Abastio's `scripts/start-issue.sh`.
 */
import { existsSync } from "node:fs";
import { readWork, resolveRepo, viewIssue } from "@ramon-sg/github-rest";
import { ask, confirm, forgetTypedAhead } from "../ask.js";
import { branchType } from "../branch-name.js";
import { checkedOutAt, checkoutRoot, git, gitLines, locateRepo, onOrigin, ownCommits } from "../git.js";
import { fill, issueColor, nextBranch } from "../issue-text.js";
import { inPath, launchSession, permissionArgs, teleportSession } from "../launch.js";
import { emitJson, type Output, warn } from "../output.js";
import { findOpenPlan, findPlan, type PlanQuery } from "../plan-doc.js";
import { proposeBranches } from "../propose.js";
import { lockWorktree, unlockWorktree } from "../session-lock.js";
import { afterSession, choosePlace, copyWorktreeIncludes, prepareBranch, publish } from "../start-place.js";
import {
  chooseAdopted,
  fetchOrigin,
  finishHere,
  launchCloud,
  placeAdopted,
  placeCloud,
  placeHere,
  prCloudSession,
  prepareHere,
  readAdopted,
  renameAdopted,
  withoutFresh,
} from "../start-modes.js";
import { type Adopted, again, StartError, type StartOptions, type StartState } from "../start-state.js";
import { describeBranch, summary } from "../start-summary.js";
import { branchPr, type WorkState, workState } from "../work-state.js";

/** What was read before choosing the branch. */
interface Context {
  options: StartOptions;
  out: Output;
  commonDir: string;
  mainRoot: string;
  startRoot: string;
  base: string;
  issue: StartState["issue"];
  labels: string[];
  work: WorkState;
  warnings: string[];
  adopted: Adopted | null;
}

/**
 * Adds a warning: prints it and keeps it for `--plan`'s output.
 * @param context - The start.
 * @param text - The warning.
 */
function note(context: Pick<Context, "out" | "warnings">, text: string): void {
  context.warnings.push(text);
  warn(context.out, text);
}

/**
 * Reads the issue and its work: stops if the checkout's origin is not the repo (the branch
 * would be pushed to one repo and the PR opened in another), or the issue is missing or
 * closed; fetches origin
 * (stops if it fails, because the new branch comes from it) and reads the PRs and branches
 * with github-rest. A branch of `claude --worktree` stops it too: that session has its
 * own flow. With `--adopt` it reads the worktree's branch, and a fresh one is not counted
 * as the issue's work.
 * @param options - The options.
 * @param out - Where to write.
 * @returns What was read.
 * @throws StartError if something stops the start; GitHubError if GitHub fails.
 */
async function readContext(options: StartOptions, out: Output): Promise<Context> {
  const located = locateRepo(options.cwd);
  const startRoot = checkoutRoot(options.cwd);
  if (located === null || startRoot === null) throw new StartError("run this inside a checkout of the repo.");
  const { number, repo, config } = options;
  const origin = resolveRepo(undefined, located.mainRoot, {});
  if (origin === null || origin.toLowerCase() !== repo.toLowerCase())
    throw new StartError(`this checkout's origin is ${origin ?? "not on GitHub"}, not ${repo}: the branch would be pushed to another repo. Run it in a checkout of ${repo}.`);
  const issue = await viewIssue(repo, number);
  if (issue === null) throw new StartError(`issue #${number} does not exist in ${repo}.`);
  if (issue.state !== "OPEN") throw new StartError(`issue #${number} is ${issue.state}; not starting it.`);
  const warnings: string[] = [];
  const labels = issue.labels.map(({ name }) => name);
  if (branchType(config.branch.types, labels, issue.title) === null)
    note({ out, warnings }, `issue #${number} has no type label.`);
  if (!fetchOrigin(located.mainRoot, options.here)) throw new StartError("could not fetch origin.");
  const read = await readWork(repo, [number], { cwd: located.mainRoot });
  for (const text of read.warnings) note({ out, warnings }, text);
  const entry = read.output.issues[0];
  if (entry === undefined || "error" in entry) throw new StartError(`issue #${number} does not exist in ${repo}.`);
  const claudeBranches = gitLines(located.mainRoot, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])
    .filter((name) => new RegExp(`^worktree-[a-z]+\\+${number}-`).test(name));
  if (claudeBranches.length > 0)
    throw new StartError(`the issue has a 'claude --worktree' branch (${claudeBranches.join(", ")}): open that session instead.`);
  const base = config.baseBranch ?? read.output.defaultBranch ?? "main";
  const adopted = options.adopt ? readAdopted(startRoot, located.mainRoot, base) : null;
  const work = adopted === null ? workState(entry) : withoutFresh(workState(entry), adopted);
  if (work.forks.length > 0)
    note({ out, warnings }, `the issue has PRs from a fork (${work.forks.map((pr) => `#${pr}`).join(", ")}): they are not resumed from here.`);
  return { options, out, ...located, startRoot, base, issue, labels, work, warnings, adopted };
}

/**
 * The new branch: named like `issue branch` (the slug block, Claude or the title), with
 * `-2`, `-3`… if the issue already used that name.
 * @param context - The start.
 * @returns The branch.
 */
function proposeNew(context: Context): string {
  const { issue, options } = context;
  const info = { number: issue.number, title: issue.title, body: issue.body, labels: context.labels };
  const { proposals, warnings } = proposeBranches([info], options.config, {
    cwd: context.mainRoot,
    ...(options.namer === undefined ? {} : { namer: options.namer }),
  });
  const [proposal] = proposals;
  if (proposal === undefined) throw new StartError("could not propose a branch.");
  for (const text of [...warnings, ...proposal.warnings]) note(context, text);
  return nextBranch(proposal.branch, context.work.known);
}

/**
 * Asks in the terminal which live branch to continue, or whether to make another.
 * @param context - The start.
 * @param describe - Describes a branch.
 * @param proposed - The new branch.
 * @returns The chosen branch, or null for a new one.
 * @throws StartError if the answer is none of the options.
 */
async function pickBranch(context: Context, describe: (branch: string) => string, proposed: string): Promise<string | null> {
  const { candidates } = context.work;
  const lines = candidates.map((branch, index) => `  ${index + 1}) ${describe(branch)}\n`);
  context.out.stderr(`Issue #${context.issue.number} already has ${candidates.length} branches:\n${lines.join("")}  n) another new branch: ${proposed}\n`);
  const answer = await ask(context.out, `Which one? [1-${candidates.length}/n] `);
  if (/^n$/i.test(answer)) return null;
  const chosen = /^\d+$/.test(answer) ? candidates[Number(answer) - 1] : undefined;
  if (chosen === undefined) throw new StartError("did nothing.");
  return chosen;
}

/**
 * The live branch to resume, or null to create a new one. `--new` creates; `--resume`
 * takes that one if it is the issue's. No branches creates and one is resumed. With
 * several: `--dry-run` and `--plan` propose a new one and warn, `--yes` stops, and the
 * terminal asks.
 * @param context - The start.
 * @param proposed - Gives the new branch, only when it is needed.
 * @returns The branch, or null.
 * @throws StartError if `--resume` is not the issue's, or there are several with `--yes`.
 */
async function chooseExisting(context: Context, proposed: () => string): Promise<string | null> {
  const { options, work } = context;
  const list = work.candidates.join(", ");
  if (options.forceNew) return null;
  if (options.resume !== null) {
    if (!work.candidates.includes(options.resume))
      throw new StartError(`branch ${options.resume} is not one of issue #${options.number}'s. Its branches: ${list || "none"}`);
    return options.resume;
  }
  if (work.candidates.length <= 1) return work.candidates[0] ?? null;
  const count = work.candidates.length;
  if (options.plan || options.dryRun) {
    note(context, `the issue already has ${count} branches (${list}): proposing a new one. To resume one: ${again(options.number, "--resume <branch>")}.`);
    return null;
  }
  if (options.yes) throw new StartError(`the issue has ${count} branches (${list}): choose with --resume <branch> or --new.`);
  const partial = { ...context, found: null, branch: "", pr: null, kind: "closes", mode: "worktree", workDir: "", plan: null, cloudSession: null } as const;
  return pickBranch(context, (branch) => describeBranch(partial, branch, true), proposed());
}

/**
 * The PR of the branch being resumed. Stops if the branch is neither local nor in origin:
 * with an open PR, it says how to recreate it; otherwise the local refs of origin are
 * stale.
 * @param context - The start.
 * @param branch - The branch.
 * @returns The PR, or null.
 * @throws StartError if the branch is gone.
 */
function resumedPr(context: Context, branch: string): StartState["pr"] {
  const pr = branchPr(context.work.prs, branch);
  const exists = git(context.mainRoot, ["rev-parse", "-q", "--verify", `refs/heads/${branch}`]).ok || onOrigin(context.mainRoot, branch);
  if (exists) return pr;
  if (pr?.state === "OPEN")
    throw new StartError(`PR #${pr.number} is still open and points to branch ${branch}, which is gone locally and in origin. Recreate it with 'git fetch origin pull/${pr.number}/head:${branch}' or close that PR and start again.`);
  throw new StartError(`branch ${branch} is on GitHub but not in the local refs of origin, which look stale: run 'git fetch origin' and try again.`);
}

/**
 * Where plans are looked for.
 * @param context - The start.
 * @returns The query.
 */
function planQuery(context: Context): PlanQuery {
  return { cwd: context.mainRoot, base: context.base, repo: context.options.repo, dirs: context.options.config.plans.dirs };
}

/**
 * The prompt Claude opens with, or `--plan` gives.
 * @param context - The start.
 * @param plan - The issue's plan, or null.
 * @param onlySummary - Whether it only summarizes and waits (`--plan`).
 * @returns The prompt.
 */
function promptFor(context: Pick<Context, "options" | "issue">, plan: string | null, onlySummary: boolean): string {
  const { start } = context.options.config;
  const template = onlySummary
    ? plan === null ? start.summaryPrompt : start.summaryPlanPrompt
    : plan === null ? start.prompt : start.resumePrompt;
  return fill(template, { number: String(context.issue.number), title: context.issue.title, plan: plan ?? "" });
}

/**
 * `--plan`: prints the branch and the prompt as one line of JSON, without changing
 * anything. A branch already checked out stops it, because the caller would make a second
 * checkout. A local branch with no commits, PR nor push is what an earlier attempt left:
 * it counts as `new`.
 * @param context - The start.
 * @param found - The branch being resumed, or null.
 * @param branch - The branch.
 * @param pr - Its PR.
 * @returns The exit code.
 * @throws StartError if the branch is checked out.
 */
function printPlan(context: Context, found: string | null, branch: string, pr: StartState["pr"]): number {
  const at = checkedOutAt(context.mainRoot, branch);
  if (at !== null) throw new StartError(`the issue already has branch ${branch} (at ${at}): continue there with '${again(context.options.number)}'.`);
  const empty = found !== null && pr === null && !onOrigin(context.mainRoot, branch) && ownCommits(context.mainRoot, branch, context.base) === 0;
  const resumed = found !== null && !empty;
  const plan = resumed
    ? findPlan(planQuery(context), branch, pr?.number ?? null)
    : findOpenPlan(planQuery(context), context.work.mergedPrs);
  emitJson(context.out, {
    action: resumed ? "resume" : "new",
    branch,
    prompt: promptFor(context, plan, true),
    url: context.issue.url,
    title: context.issue.title,
    warnings: context.warnings,
    claudeArgs: permissionArgs(context.options.permissions, null, context.mainRoot).args,
  });
  return 0;
}

/**
 * The question before acting, and what to say if the answer is no.
 * @param state - The start.
 * @returns The question and the message.
 */
function question(state: StartState): { text: string; declined: string } {
  const { work, found } = state;
  if (found !== null) return { text: "Continue with this work?", declined: "did nothing." };
  if (work.candidates.length > 0) return { text: "Create another branch for the issue?", declined: "did nothing." };
  if (work.mergedPrs.length > 0)
    return {
      text: `The issue already has merged PR ${work.mergedPrs.map((pr) => `#${pr}`).join(", ")}. Start a new round?`,
      declined: "did nothing. If the issue is done, close it.",
    };
  return { text: "Start the issue?", declined: "did nothing." };
}

/**
 * Opens Claude in the place, locking a worktree meanwhile, and then offers the cleanup.
 * Without `claude` or with `--no-launch`, says how to open it.
 * @param state - The start.
 * @returns The exit code.
 */
async function openSession(state: StartState): Promise<number> {
  const { options, out } = state;
  if (!options.launch || !inPath("claude")) {
    out.stdout(`Ready. To open the Claude session: ${again(options.number)}\n`);
    return 0;
  }
  const lock = state.mode === "worktree"
    ? lockWorktree(state.mainRoot, state.workDir, (text) => warn(out, text))
    : { mine: false, shared: false };
  const release = (): void => unlockWorktree(state.mainRoot, state.workDir, lock);
  process.once("exit", release);
  forgetTypedAhead();
  const permissions = permissionArgs(options.permissions, state.workDir, state.mainRoot).args;
  if (options.teleport) {
    out.stdout(`Bringing the cloud session${state.cloudSession === null ? "" : ` (${state.cloudSession})`}. To resume it later: claude --resume\n`);
    teleportSession(state.workDir, permissions, state.cloudSession);
  } else launchSession(
    {
      workDir: state.workDir,
      commonDir: state.commonDir,
      branch: state.branch,
      mode: state.mode,
      prompt: promptFor(state, state.plan, false),
      color: issueColor(state.labels, options.config.colors)?.color ?? null,
      permissions,
    },
    (text) => warn(out, text),
  );
  release();
  process.off("exit", release);
  await afterSession(state, lock);
  return 0;
}

/**
 * `issue start <n>`.
 * @param options - The options.
 * @param out - Where to write.
 * @returns The exit code.
 * @throws StartError if something stops the start; GitHubError if GitHub fails.
 * @example await issueStart(options, processOutput())
 */
export async function issueStart(options: StartOptions, out: Output): Promise<number> {
  const context = await readContext(options, out);
  let proposed: string | null = null;
  const propose = (): string => (proposed ??= proposeNew(context));
  const chosen = context.adopted === null
    ? { found: await chooseExisting(context, propose), named: null }
    : chooseAdopted(context.mainRoot, context.work, context.adopted, options.number);
  const { found } = chosen;
  const branch = found ?? chosen.named ?? propose();
  const pr = found === null ? null : resumedPr(context, branch);
  const kind = context.work.candidates.some((other) => other !== branch) ? "part" : "closes";
  if (options.plan) return printPlan(context, found, branch, pr);
  if (options.teleport && found === null)
    throw new StartError(`issue #${options.number} has no branch: start it with '${again(options.number, "--cloud")}' (or without flags).`);
  const plan = found !== null
    ? findPlan(planQuery(context), branch, pr?.number ?? null)
    : findOpenPlan(planQuery(context), context.work.mergedPrs);
  const cloudSession = await prCloudSession(options.repo, pr?.number ?? null);
  const state: StartState = { ...context, found, branch, pr, kind, ...placeOf(context, branch, found), plan, cloudSession };
  out.stdout(summary(state, permissionArgs(options.permissions, existsSync(state.workDir) ? state.workDir : null, context.mainRoot)));
  if (options.dryRun) return 0;
  const asked = question(state);
  if (!options.yes && state.adopted === null && !(await confirm(out, asked.text))) throw new StartError(asked.declined);
  if (state.mode === "cloud") return launchCloud(state, out);
  if (state.adopted !== null) renameAdopted(state);
  else if (state.mode === "here") prepareHere(state);
  else prepareBranch(state);
  const prNumber = await publish(state);
  if (state.mode === "here") {
    await finishHere(state, prNumber, promptFor(state, plan, false));
    return 0;
  }
  if (state.adopted !== null) {
    out.stdout(`Ready: issue #${options.number} is on branch ${branch}, with its draft PR.\n${plan === null ? "" : `Open plan of this issue, to resume: ${plan}\n`}`);
    return 0;
  }
  if (state.mode === "worktree") copyWorktreeIncludes(context.mainRoot, state.workDir, out);
  return openSession(state);
}

/**
 * Where the work goes, by the flags: the adopted worktree, this checkout (`--here`), the
 * cloud (`--cloud`), or a worktree or the main checkout.
 * @param context - The start.
 * @param branch - The branch.
 * @param found - The branch being resumed, or null.
 * @returns The mode and the folder.
 * @throws StartError if the place is taken.
 */
function placeOf(context: Context, branch: string, found: string | null): Pick<StartState, "mode" | "workDir"> {
  const { options, mainRoot, adopted } = context;
  if (adopted !== null) return placeAdopted({ branch, startRoot: context.startRoot, adopted });
  if (options.here) return placeHere(mainRoot, context.startRoot, branch, options.number);
  if (options.cloud) return placeCloud(mainRoot, branch, found, options.number);
  return choosePlace(mainRoot, branch, options.branchMode, options.config.worktrees.dir);
}
