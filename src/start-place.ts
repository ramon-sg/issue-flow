/**
 * @file Where the work of an issue happens and what `issue start` changes: the worktree or
 * the main checkout on the branch, the start commit, the push, the draft PR, the
 * assignment, the files of `.worktreeinclude`, and the cleanup after a merged PR. Ported
 * from `choose_place`, `prepare_branch`, `publish` and `after_session` in Abastio's
 * `scripts/start-issue.sh`.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { assign, createPr, findPr, getPr, updatePr } from "@ramon-sg/github-rest";
import { confirm } from "./ask.js";
import { checkedOutAt, currentBranch, git, gitLines, hasLocal, isClean, onOrigin, safeToDelete } from "./git.js";
import { bodyToPartOf, dirName, fill, prBody, type StartMode } from "./issue-text.js";
import { forgetSession } from "./launch.js";
import { type Output, warn } from "./output.js";
import type { Lock } from "./session-lock.js";
import { again, StartError, type StartState } from "./start-state.js";
import { needsStartCommit, stepPlaceOf } from "./start-summary.js";
import { teardownWorktree } from "./worktree-steps.js";
import { openPrsElsewhere } from "./work-state.js";

/** The file listing what a new worktree copies from the main checkout. */
export const WORKTREE_INCLUDE = ".worktreeinclude";

/** Characters that make a path segment a pattern. */
const GLOB = /[*?[]/;

/**
 * Where the work goes. If the branch is checked out somewhere, there; if not, in a new
 * worktree or, with `--branch`, in the main checkout, which must be clean.
 * @param mainRoot - The main checkout.
 * @param branch - The branch.
 * @param branchMode - Whether `--branch` was given.
 * @param worktreesDir - The config's folder for worktrees.
 * @returns The mode and the folder.
 * @throws StartError if the place is taken.
 * @example choosePlace(root, "feat/42-x", false, ".claude/worktrees")
 */
export function choosePlace(
  mainRoot: string,
  branch: string,
  branchMode: boolean,
  worktreesDir: string,
): { mode: StartMode; workDir: string } {
  const at = checkedOutAt(mainRoot, branch);
  if (at !== null) {
    const mode = at === mainRoot ? "branch" : "worktree";
    if (branchMode && mode === "worktree")
      throw new StartError(`branch ${branch} is already in the worktree ${at}; run without --branch.`);
    return { mode, workDir: at };
  }
  if (branchMode) {
    if (!isClean(mainRoot))
      throw new StartError("the main checkout has uncommitted changes; commit or stash them first. No stash is made.");
    return { mode: "branch", workDir: mainRoot };
  }
  const workDir = join(mainRoot, worktreesDir, dirName(branch));
  if (existsSync(workDir))
    throw new StartError(`${workDir} already exists and is not a worktree of ${branch}; check it by hand.`);
  return { mode: "worktree", workDir };
}

/**
 * Runs git and stops with the message if it fails.
 * @param cwd - Where.
 * @param args - The arguments.
 * @param what - What failed, for the message.
 * @throws StartError if git fails.
 */
function mustGit(cwd: string, args: string[], what: string): void {
  const result = git(cwd, args);
  if (!result.ok) throw new StartError(`${what}${result.err === "" ? "" : `: ${result.err}`}`);
}

/**
 * Leaves the branch in its place: a new worktree (from the base, or on the existing
 * branch), or the main checkout on it. A new branch in the main checkout needs it on the
 * base and in step with origin.
 * @param state - The start.
 * @throws StartError if git cannot, with what to run in a terminal if a sandbox stops it.
 * @example prepareBranch(state)
 */
export function prepareBranch(state: StartState): void {
  const { mainRoot, branch, base, found } = state;
  if (state.mode === "worktree") {
    if (existsSync(state.workDir)) return;
    const args = found === null ? ["-b", branch, `origin/${base}`] : [branch];
    const result = git(mainRoot, ["worktree", "add", "-q", state.workDir, ...args]);
    if (!result.ok)
      throw new StartError(
        `could not create the worktree: ${result.err}. If a sandbox stopped it, run in a terminal: ${again(state.options.number, "--yes")}`,
      );
    return;
  }
  if (currentBranch(mainRoot) === branch) return;
  if (!isClean(mainRoot))
    throw new StartError("the main checkout has uncommitted changes; commit or stash them first. No stash is made.");
  if (found !== null) return mustGit(mainRoot, ["checkout", "-q", branch], `could not check out ${branch}`);
  if (currentBranch(mainRoot) !== base) throw new StartError(`the main checkout is not on ${base}.`);
  if (git(mainRoot, ["rev-list", "--count", `origin/${base}..${base}`]).out !== "0")
    throw new StartError(`local ${base} has commits that are not in origin/${base}; sort it out by hand.`);
  mustGit(mainRoot, ["merge", "-q", "--ff-only", `origin/${base}`], `local ${base} diverged from origin/${base}`);
  mustGit(mainRoot, ["checkout", "-q", "-b", branch], `could not create ${branch}`);
}

/**
 * Turns into `Part of` the open PRs of other branches that closed the issue, because it
 * now has more than one branch. Never stops: a PR it cannot edit gets a warning.
 * @param state - The start.
 */
async function markOthersPartOf(state: StartState): Promise<void> {
  const { repo, number } = state.options;
  for (const other of openPrsElsewhere(state.work.prs, state.branch)) {
    try {
      const pr = await getPr(repo, other);
      if (pr === null) continue;
      const body = bodyToPartOf(pr.body, number);
      if (body !== pr.body) await updatePr(repo, other, { body });
    } catch {
      warn(state.out, `could not turn PR #${other} into Part of #${number}; edit it by hand.`);
    }
  }
}

/**
 * The start commit, the push, the draft PR, the reopening of a closed one and the
 * assignment, as far as they are missing. The commit takes nothing staged (`--only`). It
 * runs before copying the included files and opening Claude, so the public trace is there
 * even if what follows fails.
 * @param state - The start.
 * @returns The PR's number.
 * @throws StartError if the commit, the push or the PR fail.
 * @example await publish(state)
 */
export async function publish(state: StartState): Promise<number> {
  const { workDir, branch, options } = state;
  const commit = needsStartCommit(state);
  if (commit) {
    const message = fill(options.config.start.commitMessage, { number: String(options.number) });
    mustGit(workDir, ["commit", "-q", "--allow-empty", "--only", "-m", message], "could not make the start commit");
  }
  if (commit || !onOrigin(workDir, branch))
    mustGit(workDir, ["push", "-q", "-u", "origin", branch], `could not push ${branch}`);
  if (!git(workDir, ["rev-parse", "-q", "--verify", "@{u}"]).ok)
    git(workDir, ["branch", "-q", `--set-upstream-to=origin/${branch}`, branch]);
  let number = state.pr?.number ?? null;
  if (number === null) {
    const created = await createPr(options.repo, {
      head: branch,
      base: state.base,
      title: state.issue.title,
      body: prBody(options.config.start.prBody, options.number, state.kind),
      draft: true,
    });
    state.out.stdout(`${created.url}\n`);
    number = created.number;
    if (state.kind === "part") await markOthersPartOf(state);
  }
  if (state.pr?.state === "CLOSED") await updatePr(options.repo, number, { state: "open" });
  if (state.issue.assignees.length === 0) {
    try {
      await assign(options.repo, options.number, ["@me"]);
    } catch {
      warn(state.out, `could not assign issue #${options.number} to you.`);
    }
  }
  return number;
}

/**
 * The paths that match a pattern of `.worktreeinclude`, relative to the folder. Each
 * segment may have `*`, `?` or `[…]`, like the shell; names starting with `.` match only
 * a pattern that starts with `.`.
 * @param root - The folder.
 * @param pattern - The pattern.
 * @returns The paths that exist.
 */
function expand(root: string, pattern: string): string[] {
  let paths = [""];
  for (const segment of pattern.split("/").filter((part) => part !== "")) {
    if (!GLOB.test(segment)) {
      paths = paths.map((path) => join(path, segment)).filter((path) => existsSync(join(root, path)));
      continue;
    }
    const source = segment.replace(/[.+^${}()|\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".");
    const matcher = new RegExp(`^${source}$`);
    paths = paths.flatMap((path) => {
      const dir = join(root, path);
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((name) => matcher.test(name) && (!name.startsWith(".") || segment.startsWith(".")))
        .map((name) => join(path, name));
    });
  }
  return paths.filter((path) => path !== "");
}

/**
 * Copies to a new worktree the files of `.worktreeinclude` it lacks, like `claude
 * --worktree` does and `git worktree add` does not: only files git ignores (the ones a
 * checkout cannot bring, like credentials), keeping their permissions and never
 * overwriting.
 * @param from - The main checkout.
 * @param to - The worktree.
 * @param out - Where a failed copy is reported.
 * @example copyWorktreeIncludes(root, wt, out)
 */
export function copyWorktreeIncludes(from: string, to: string, out: Output): void {
  const list = join(from, WORKTREE_INCLUDE);
  if (!existsSync(list)) return;
  for (const raw of readFileSync(list, "utf8").split("\n")) {
    const pattern = raw.replace(/\r$/, "").trim();
    if (pattern === "" || pattern.startsWith("#")) continue;
    let files: string[];
    try {
      files = expand(from, pattern);
    } catch {
      warn(out, `skipping "${pattern}" of ${WORKTREE_INCLUDE}: it is not a valid pattern.`);
      continue;
    }
    for (const file of files) {
      if (existsSync(join(to, file)) || !git(from, ["check-ignore", "-q", file]).ok) continue;
      try {
        mkdirSync(dirname(join(to, file)), { recursive: true });
        cpSync(join(from, file), join(to, file), { recursive: true });
      } catch {
        warn(out, `could not copy ${file} to the worktree.`);
      }
    }
  }
}

/** Ignored files named at most in the question before deleting a worktree. */
const MAX_LISTED = 5;

/**
 * The ignored files of a worktree, which `git worktree remove` deletes and a clean status
 * does not show: local notes, a local database, `settings.local.json`.
 * @param workDir - The worktree.
 * @returns Their paths (a folder counts once).
 */
function ignoredFiles(workDir: string): string[] {
  return gitLines(workDir, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"]);
}

/**
 * The reason not to clean up after a merged PR, or null if it can be.
 * @param state - The start.
 * @param lock - The worktree lock.
 * @param head - The merged PR's head.
 * @returns The message, or null.
 */
function keepReason(state: StartState, lock: Lock, head: string): string | null {
  if (lock.shared) return "The PR was merged, but another session uses the worktree: not offering to delete it.";
  if (!isClean(state.workDir)) return `The PR was merged, but ${state.workDir} has uncommitted changes: deleting nothing.`;
  if (!safeToDelete(state.mainRoot, state.branch, head))
    return `The PR was merged, but ${state.branch} has commits that are not in origin: deleting nothing.`;
  return null;
}

/**
 * After Claude: if the PR was merged and nothing would be lost, offers to delete the
 * worktree and the branch (or, in the main checkout, to go back to the base); if not,
 * says how to resume.
 * @param state - The start.
 * @param lock - The worktree lock (shared: another session uses it).
 * @example await afterSession(state, lock)
 */
export async function afterSession(state: StartState, lock: Lock): Promise<void> {
  const { out, mainRoot, branch, commonDir, base } = state;
  const pr = await findPr(state.options.repo, branch).catch(() => null);
  if (pr?.state !== "MERGED") {
    out.stdout(`The session is saved. To resume it: ${again(state.options.number)}\n`);
    return;
  }
  if (!hasLocal(mainRoot, branch)) {
    forgetSession(commonDir, branch);
    out.stdout(`The PR was merged and the local branch ${branch} no longer exists: nothing to delete.\n`);
    return;
  }
  const reason = keepReason(state, lock, pr.head);
  if (reason !== null) return out.stdout(`${reason}\n`);
  if (state.mode === "worktree") {
    const where = relative(mainRoot, state.workDir);
    const lost = ignoredFiles(state.workDir);
    const also = lost.length === 0 ? "" : ` Its ignored files go too: ${lost.slice(0, MAX_LISTED).join(", ")}${lost.length > MAX_LISTED ? ", …" : ""}.`;
    if (!(await confirm(out, `The PR was merged. Delete the worktree ${where} and the local branch ${branch}?${also}`))) return;
    teardownWorktree(stepPlaceOf(state));
    mustGit(mainRoot, ["worktree", "remove", state.workDir], `could not delete ${where} (its teardown already ran)`);
  } else {
    if (!(await confirm(out, `The PR was merged. Go back to ${base} and delete the local branch ${branch}?`))) return;
    mustGit(mainRoot, ["checkout", "-q", base], `could not check out ${base}`);
    const updated = git(mainRoot, ["fetch", "-q", "origin"]).ok && git(mainRoot, ["merge", "-q", "--ff-only", `origin/${base}`]).ok;
    if (!updated) warn(out, `could not update ${base}; do it by hand.`);
  }
  mustGit(mainRoot, ["branch", "-q", "-D", branch], `could not delete ${branch}`);
  forgetSession(commonDir, branch);
}
