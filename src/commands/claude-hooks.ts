/**
 * @file `issue-flow hook worktree-create` and `hook worktree-remove`: the `WorktreeCreate`
 * and `WorktreeRemove` hooks of Claude Code, for `claude --worktree <name>` and the
 * worktrees Claude makes during a session. With them those worktrees get what one of
 * `issue start` gets: made from `origin/<base>` (the config's base branch, not only the
 * default one), with `.worktreeinclude` and the setup steps, and cleaned when Claude
 * deletes them (steps, apps, ports, Docker). Claude only calls `WorktreeRemove` for the
 * worktrees a `WorktreeCreate` hook made, and then the hook deletes the folder itself.
 * Ported from Clean Queen's `.claude/hooks/worktree-create.sh` and `worktree-remove.sh`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FlowConfig } from "../config.js";
import { isObject } from "../config-base.js";
import { canonicalPath } from "../docker.js";
import { git, hasLocal, isClean, locateRepo, safeToDelete, worktrees } from "../git.js";
import { type Output, warn } from "../output.js";
import { copyWorktreeIncludes } from "../start-place.js";
import { StartError } from "../start-state.js";
import { runSetup, teardownWorktree } from "../worktree-steps.js";
import { baseBranch, stepPlace } from "./worktree.js";

/** Milliseconds the fetch of the base branch gets before the local ref is used. */
const FETCH_TIMEOUT_MS = 30_000;

/** The name Claude gives a worktree: a slug, without `.` or `..` as a whole. */
const WORKTREE_NAME = /^[A-Za-z0-9._+/-]+$/;

/** A worktree name that asks for a PR, which `pr worktree` checks out instead. */
const PR_NAME = /^pr-(\d+)$/;

/**
 * The JSON Claude Code sends a hook on stdin, or an empty object if there is none (a
 * terminal, or not JSON).
 * @returns The fields.
 * @example hookInput().cwd
 */
export function hookInput(): Record<string, unknown> {
  if (process.stdin.isTTY) return {};
  try {
    const value: unknown = JSON.parse(readFileSync(0, "utf8"));
    return isObject(value) ? value : {};
  } catch {
    return {};
  }
}

/**
 * A text field of the hook's input.
 * @param input - The input.
 * @param key - The field.
 * @returns Its value, or null if it is missing or empty.
 */
function field(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Fetches the base branch, giving up after `FETCH_TIMEOUT_MS` and never asking for a
 * password: a hook has no terminal.
 * @param mainRoot - The main checkout.
 * @param base - The base branch.
 * @returns True if it was fetched.
 */
function fetchBase(mainRoot: string, base: string): boolean {
  const result = spawnSync("git", ["fetch", "-q", "origin", base], {
    cwd: mainRoot,
    stdio: "ignore",
    timeout: FETCH_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return result.status === 0;
}

/**
 * `hook worktree-create`: makes `<worktrees.dir>/<name>` on a branch `worktree-<name>`
 * from `origin/<base>` (or reuses it), copies `.worktreeinclude`, runs the setup and
 * prints the path, which is all Claude reads from stdout. A `pr-<n>` name is refused:
 * that is `issue-flow pr worktree <n>`, on the PR's own branch.
 * @param input - The hook's input (`name`, `cwd`).
 * @param config - The config.
 * @param cwd - Where the hook runs, if the input has no `cwd`.
 * @param out - Where to write; only the path goes to stdout.
 * @returns 0.
 * @throws StartError if the worktree cannot be made, which makes Claude not create it.
 * @example await worktreeCreate({ name: "bold-oak" }, config, cwd, out)
 */
export async function worktreeCreate(input: Record<string, unknown>, config: FlowConfig, cwd: string, out: Output): Promise<number> {
  const name = field(input, "name");
  if (name === null) throw new StartError("the hook got no worktree name.");
  const pr = PR_NAME.exec(name);
  if (pr !== null) throw new StartError(`to review a PR, run 'issue-flow pr worktree ${pr[1]}', not 'claude --worktree ${name}'.`);
  const slug = name.replaceAll("/", "+");
  if (!WORKTREE_NAME.test(name) || slug === "." || slug === ".." || slug.startsWith("-"))
    throw new StartError(`the worktree name cannot be '${name}'.`);
  const located = locateRepo(field(input, "cwd") ?? cwd);
  if (located === null) throw new StartError(`${field(input, "cwd") ?? cwd} is not a git checkout.`);
  const { mainRoot } = located;
  const path = canonicalPath(join(mainRoot, config.worktrees.dir, slug));
  const branch = `worktree-${slug}`;
  const base = baseBranch(config, mainRoot);
  const stderrOnly: Output = { ...out, stdout: (text) => out.stderr(text) };
  if (!worktrees(mainRoot).some((entry) => entry.path === path)) {
    if (!fetchBase(mainRoot, base))
      warn(out, `could not fetch ${base}; using the local origin/${base}.`);
    if (!git(mainRoot, ["rev-parse", "-q", "--verify", `origin/${base}^{commit}`]).ok)
      throw new StartError(`there is no origin/${base}, and the worktree is not made on another base.`);
    const add = hasLocal(mainRoot, branch)
      ? git(mainRoot, ["worktree", "add", "-q", path, branch])
      : git(mainRoot, ["worktree", "add", "-q", "--no-track", "-b", branch, path, `origin/${base}`]);
    if (!add.ok) throw new StartError(`could not make the worktree ${path}: ${add.err}`);
    copyWorktreeIncludes(mainRoot, path, stderrOnly);
  }
  await runSetup({ root: path, mainRoot, base, config, out: stderrOnly, remote: false }, null);
  out.stdout(`${path}\n`);
  return 0;
}

/**
 * `hook worktree-remove`: cleans the worktree Claude is deleting (steps, apps, ports,
 * Docker) and deletes its folder, and its branch if every commit of it is in origin. A
 * worktree with uncommitted changes is kept. A folder already gone only gets its ports and
 * Docker freed.
 * @param input - The hook's input (`worktree_path`).
 * @param config - The config.
 * @param cwd - Where the hook runs.
 * @param out - Where to write.
 * @returns 0 if the worktree is gone.
 * @throws StartError if it is kept, or is not a worktree of the repo.
 * @example await worktreeRemove({ worktree_path: wt }, config, cwd, out)
 */
export async function worktreeRemove(input: Record<string, unknown>, config: FlowConfig, cwd: string, out: Output): Promise<number> {
  const given = field(input, "worktree_path");
  if (given === null) throw new StartError("the hook got no worktree_path; deleting nothing.");
  const path = canonicalPath(given);
  const place = stepPlace({ config, cwd: existsSync(path) ? path : (field(input, "cwd") ?? cwd) }, out);
  const { mainRoot } = place;
  if (path === mainRoot) throw new StartError("the main checkout is never deleted.");
  const entry = worktrees(mainRoot).find((item) => item.path === path);
  if (entry === undefined && existsSync(path)) throw new StartError(`${path} is not a worktree of this repo; deleting nothing.`);
  if (entry === undefined) {
    await teardownWorktree({ ...place, root: path });
    git(mainRoot, ["worktree", "prune"]);
    return 0;
  }
  if (!isClean(path)) throw new StartError(`${path} has uncommitted changes; kept. See them with 'git -C ${path} status'.`);
  await teardownWorktree({ ...place, root: path });
  const removed = git(mainRoot, ["worktree", "remove", "--force", path]);
  if (!removed.ok) throw new StartError(`could not delete ${path} (its teardown already ran): ${removed.err}`);
  const { branch } = entry;
  if (branch === null) return 0;
  if (safeToDelete(mainRoot, branch, "")) git(mainRoot, ["branch", "-q", "-D", branch]);
  else warn(out, `kept the branch ${branch}: it has commits that are not in origin.`);
  return 0;
}
