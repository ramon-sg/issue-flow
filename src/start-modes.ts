/**
 * @file The ways of `issue start` that do not open Claude in a worktree of their own:
 * `--adopt` (a worktree another tool made, like Orca or Paseo), `--here` (the checkout of a
 * cloud session), `--cloud` (opens a cloud session that starts the issue with `--here`)
 * and the cloud session noted in the PR, which `--teleport` brings back. Ported from
 * `choose_adopted`, `adopt_place`, `place_here`, `place_cloud`, `prepare_branch_here`,
 * `note_session_in_pr` and `launch_cloud_session` in Abastio's `scripts/start-issue.sh`.
 */
import { spawnSync } from "node:child_process";
import { getPr, updatePr } from "@ramon-sg/github-rest";
import { forgetTypedAhead } from "./ask.js";
import { checkedOutAt, currentBranch, git, hasLocal, isClean, onOrigin, ownCommits } from "./git.js";
import { cloudSessionOf, fill, issueOfBranch, sameCloudSession, type StartMode, withCloudSession } from "./issue-text.js";
import { inPath } from "./launch.js";
import { type Output, warn } from "./output.js";
import { type Adopted, again, StartError, type StartState } from "./start-state.js";
import type { WorkState } from "./work-state.js";

/** A branch name safe to put in the cloud session's prompt, which a skill may run. */
const PLAIN_BRANCH = /^[A-Za-z0-9._/-]+$/;

/** Refspec that brings every branch of origin, whatever the clone's config says. */
const ALL_HEADS = "+refs/heads/*:refs/remotes/origin/*";

/**
 * The fetch of origin. In a cloud session the clone has one branch, so `--here` passes
 * the refspec: without it neither the base nor the issue's branch would come.
 * @param mainRoot - The main checkout.
 * @param here - Whether it runs with `--here`.
 * @returns True if it worked.
 * @example fetchOrigin(root, false)
 */
export function fetchOrigin(mainRoot: string, here: boolean): boolean {
  return git(mainRoot, ["fetch", "-q", "--prune", "origin", ...(here ? [ALL_HEADS] : [])]).ok;
}

/**
 * The branch of the worktree `--adopt` runs in, and whether it is fresh: not in origin and
 * with no commits of its own, so the tool that made the worktree just made it.
 * @param startRoot - The checkout where it runs.
 * @param mainRoot - The main checkout.
 * @param base - The base branch.
 * @returns The branch and whether it is fresh.
 * @throws StartError in the main checkout or on a detached HEAD.
 * @example readAdopted(wt, root, "main") // { current: "ramon/x", fresh: true }
 */
export function readAdopted(startRoot: string, mainRoot: string, base: string): Adopted {
  if (startRoot === mainRoot) throw new StartError("--adopt runs inside a worktree, not in the main checkout.");
  const current = currentBranch(startRoot);
  if (current === null) throw new StartError(`the worktree ${startRoot} is not on a branch; not adopting it.`);
  return { current, fresh: !onOrigin(mainRoot, current) && ownCommits(mainRoot, current, base) === 0 };
}

/**
 * The issue's work without the adopted branch when it is fresh: it is neither earlier work
 * nor a used name.
 * @param work - The work.
 * @param adopted - The adopted branch.
 * @returns The work.
 * @example withoutFresh(work, { current: "ramon/x", fresh: true })
 */
export function withoutFresh(work: WorkState, adopted: Adopted): WorkState {
  if (!adopted.fresh) return work;
  const other = (name: string): boolean => name !== adopted.current;
  return { ...work, known: work.known.filter(other), candidates: work.candidates.filter(other) };
}

/**
 * Which branch `--adopt` takes. A live branch of the issue that the worktree is on is
 * resumed. A fresh branch with the issue's number is the new branch as it is, with other
 * branches or without (Paseo lets you edit the name; Orca makes one without the number).
 * Otherwise, with no live branches the branch is renamed to the proposed one, and with
 * some it stops: the issue goes on elsewhere.
 * @param mainRoot - The main checkout.
 * @param work - The issue's work.
 * @param adopted - The adopted branch.
 * @param number - The issue.
 * @returns The branch resumed, or the new one already named, or neither (propose one).
 * @throws StartError if the issue has live branches elsewhere.
 * @example chooseAdopted(root, work, adopted, 214) // { found: null, named: "fix/214-x" }
 */
export function chooseAdopted(
  mainRoot: string,
  work: WorkState,
  adopted: Adopted,
  number: number,
): { found: string | null; named: string | null } {
  const { candidates } = work;
  if (candidates.includes(adopted.current)) return { found: adopted.current, named: null };
  if (adopted.fresh && issueOfBranch(adopted.current) === number) return { found: null, named: adopted.current };
  const [only] = candidates;
  if (only === undefined) return { found: null, named: null };
  const after = "continue there with";
  if (candidates.length > 1)
    throw new StartError(`the issue already has ${candidates.length} branches (${candidates.join(", ")}): ${after} '${again(number)}' and delete this worktree.`);
  const at = checkedOutAt(mainRoot, only);
  const where = at !== null ? `at ${at}` : hasLocal(mainRoot, only) ? "local, without a worktree" : "only in origin";
  throw new StartError(`the issue already has branch ${only} (${where}): ${after} '${again(number)}' and delete this worktree.`);
}

/**
 * The place of `--adopt`: the worktree where it runs. If it is already on the branch there
 * is nothing to check (an `--adopt` repeated or resumed); if not, it must be fresh and
 * without uncommitted changes, so a branch with other work is never renamed. Untracked
 * files do not count: the tool may leave its own.
 * @param state - What it knows: the branch, the start checkout and the adopted branch.
 * @returns The mode and the folder.
 * @throws StartError if the worktree is not fresh.
 * @example placeAdopted({ branch, startRoot, adopted })
 */
export function placeAdopted(
  state: { branch: string; startRoot: string; adopted: Adopted },
): { mode: StartMode; workDir: string } {
  const { branch, startRoot, adopted } = state;
  const place = { mode: "worktree" as const, workDir: startRoot };
  if (branch === adopted.current) return place;
  if (!adopted.fresh)
    throw new StartError(`branch ${adopted.current} is in origin or has commits of its own: only a just-made worktree is adopted.`);
  if (!isClean(startRoot, false))
    throw new StartError(`the worktree ${startRoot} has uncommitted changes: only a just-made worktree is adopted.`);
  return place;
}

/**
 * Renames the adopted worktree's branch to the issue's (to the same name, it does
 * nothing). The tool that made the worktree knows it by its path, so the rename does not
 * unlink it.
 * @param state - The start.
 * @throws StartError if git cannot.
 * @example renameAdopted(state)
 */
export function renameAdopted(state: StartState): void {
  const current = state.adopted?.current;
  if (current === undefined) return;
  if (!git(state.startRoot, ["branch", "-m", state.branch]).ok)
    throw new StartError(`could not rename ${current} to ${state.branch}.`);
}

/**
 * The place of `--here`: the checkout where it runs. Stops if the branch is checked out in
 * another one, or this one has uncommitted changes (untracked files do not count: the
 * cloud's hook leaves its own, and git says if one is in the way).
 * @param mainRoot - The main checkout.
 * @param startRoot - The checkout where it runs.
 * @param branch - The branch.
 * @param number - The issue.
 * @returns The mode and the folder.
 * @throws StartError if the place is taken.
 * @example placeHere(root, root, "feat/42-x", 42)
 */
export function placeHere(mainRoot: string, startRoot: string, branch: string, number: number): { mode: StartMode; workDir: string } {
  const at = checkedOutAt(mainRoot, branch);
  if (at !== null && at !== startRoot) throw new StartError(`branch ${branch} is already at ${at}: continue there with '${again(number)}'.`);
  if (!isClean(startRoot, false))
    throw new StartError("this checkout has uncommitted changes; commit or stash them first. No stash is made.");
  return { mode: "here", workDir: startRoot };
}

/**
 * The place of `--cloud`: the cloud session does the work, launched from the main
 * checkout. Stops if the branch is checked out, or exists only locally, where the cloud
 * would not see it.
 * @param mainRoot - The main checkout.
 * @param branch - The branch.
 * @param found - The branch being resumed, or null.
 * @param number - The issue.
 * @returns The mode and the folder.
 * @throws StartError if the cloud cannot take the branch.
 * @example placeCloud(root, "feat/42-x", null, 42)
 */
export function placeCloud(mainRoot: string, branch: string, found: string | null, number: number): { mode: StartMode; workDir: string } {
  const at = checkedOutAt(mainRoot, branch);
  if (at !== null)
    throw new StartError(`branch ${branch} is already at ${at}: continue there with '${again(number)}', without --cloud.`);
  if (found !== null && !onOrigin(mainRoot, branch))
    throw new StartError(`branch ${branch} is only local: push it or go on without --cloud.`);
  return { mode: "cloud", workDir: mainRoot };
}

/**
 * With `--here`, leaves the checkout on the branch without needing a local base: a new one
 * comes from `origin/<base>`, an existing one from `origin/<branch>` (the fetch of every
 * branch already brought it). A branch missing from origin is only local, somewhere else;
 * a local branch with commits origin lacks stops it, so `-B` does not overwrite them.
 * @param state - The start.
 * @throws StartError if git cannot or the branch cannot be brought.
 * @example prepareHere(state)
 */
export function prepareHere(state: StartState): void {
  const { workDir, branch, base, mainRoot } = state;
  const checkout = (args: string[]): void => {
    if (!git(workDir, ["checkout", "-q", ...args]).ok) throw new StartError(`could not leave ${branch} in this checkout.`);
  };
  if (state.found === null) return checkout(["--no-track", "-B", branch, `origin/${base}`]);
  if (!onOrigin(mainRoot, branch))
    throw new StartError(`branch ${branch} is only local (on another machine or checkout): push it from there and run this again.`);
  if (hasLocal(mainRoot, branch) && git(mainRoot, ["rev-list", "--count", branch, "--not", `origin/${branch}`]).out !== "0")
    throw new StartError(`the local branch ${branch} has commits that are not in origin; push them or sort it out by hand.`);
  // NOTE: --no-track: publish sets the upstream when it can (see trackOrigin).
  checkout(["--no-track", "-B", branch, `origin/${branch}`]);
}

/**
 * The cloud session noted in the PR's body, or null (no PR, none noted, or the PR cannot
 * be read).
 * @param repo - The repo.
 * @param pr - The PR, or null.
 * @returns The id, or null.
 * @example await prCloudSession("acme/widgets", 7)
 */
export async function prCloudSession(repo: string, pr: number | null): Promise<string | null> {
  if (pr === null) return null;
  const found = await getPr(repo, pr).catch(() => null);
  return found === null ? null : cloudSessionOf(found.body);
}

/**
 * The end of `--here`: notes this cloud session in the PR (if it runs in one and the PR
 * does not have it yet), so `--teleport` finds it from any machine, and prints the
 * `Prompt:` line the skill follows. It does not open Claude: it already runs in one.
 * @param state - The start.
 * @param pr - The PR.
 * @param prompt - What the session goes on with.
 * @example await finishHere(state, 900, prompt)
 */
export async function finishHere(state: StartState, pr: number, prompt: string): Promise<void> {
  const { out, options } = state;
  const id = options.remoteSession;
  if (id !== null && !sameCloudSession(state.cloudSession, id)) {
    try {
      const found = await getPr(options.repo, pr);
      if (found === null) throw new Error(`PR #${pr} is gone`);
      await updatePr(options.repo, pr, { body: withCloudSession(found.body, id) });
    } catch {
      warn(out, `could not note the session in PR #${pr}.`);
    }
  }
  out.stdout(`Ready: issue #${options.number} is on branch ${state.branch}, with its draft PR.\nPrompt: ${prompt}\n`);
}

/**
 * The flags with which the cloud session picks the branch: `--new` if the issue has live
 * branches and a new one was chosen here (`--new`, or `n` in the terminal), `--resume
 * <branch>` if one of several was chosen. With one live branch resumed, none: the session
 * resumes it.
 * @param state - The start.
 * @returns The flags, with a space before each.
 * @throws StartError if the branch has characters a shell would read (anyone who can push
 * names branches).
 * @example cloudFlags(state) // " --resume fix/214-old"
 */
export function cloudFlags(state: StartState): string {
  const { found, work } = state;
  if (found === null && work.candidates.length > 0) return " --new";
  if (work.candidates.length <= 1 || found === null) return "";
  if (!PLAIN_BRANCH.test(found))
    throw new StartError(`branch ${JSON.stringify(found)} has characters the cloud session's prompt cannot carry; rename it.`);
  return ` --resume ${found}`;
}

/**
 * `--cloud` after the yes: opens the cloud session with the skill that starts the issue
 * there, in the foreground and with the terminal (`claude --cloud` needs one), from the
 * main checkout. Without `claude` or with `--no-launch`, says how to open it.
 * @param state - The start.
 * @param out - Where to write.
 * @returns The exit code.
 * @throws StartError if the session does not open.
 * @example launchCloud(state, out)
 */
export function launchCloud(state: StartState, out: Output): number {
  const { options, mainRoot, base } = state;
  if (!options.launch || !inPath("claude")) {
    out.stdout(`Ready. To open the cloud session: ${again(options.number, "--cloud")}\n`);
    return 0;
  }
  if (currentBranch(mainRoot) !== base) warn(out, `the main checkout is not on ${base}: the session clones its current branch.`);
  const prompt = fill(options.config.start.cloudPrompt, { number: String(options.number), flags: cloudFlags(state) });
  forgetTypedAhead();
  if (spawnSync("claude", ["--cloud", prompt], { cwd: mainRoot, stdio: "inherit" }).status !== 0)
    throw new StartError("could not open the cloud session.");
  out.stdout(`To bring it here: ${again(options.number, "--teleport")}\n`);
  return 0;
}
