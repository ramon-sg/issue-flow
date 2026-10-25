/**
 * @file Runs the steps of `worktrees.setup` and `worktrees.teardown` in a worktree. The
 * steps come from the main checkout's config, not the worktree's, so a branch cannot add
 * commands to its own setup. A `trusted` step (an install, which runs the lifecycle scripts
 * of `package.json`) runs only if the worktree's code is in `origin/<base>` and has no
 * changes; a `once` step leaves a mark when it works and is not repeated. Two setups of one
 * worktree at a time (the tool's and the session hook's) take turns with a lock. Each step
 * gets the worktree, the main checkout, its block of ports and its Docker suffix in the
 * environment. Ported from Abastio's `scripts/worktree-setup.sh` and `worktree-cleanup.sh`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { FlowConfig } from "./config.js";
import { dockerCleanup, sanitizeLabel } from "./docker.js";
import { git, isClean } from "./git.js";
import { type Output, warn } from "./output.js";
import { claimPortBase, portBase, releasePortClaims, sha256 } from "./ports.js";
import { stopApps } from "./stop-apps.js";
import type { Step } from "./worktree-config.js";

/** Folder, in the worktree's git dir, with a mark per `once` step that worked. */
export const SETUP_MARKS_DIR = "issue-flow-setup";

/** The lock of the setup, in the worktree's git dir. */
const LOCK_NAME = "issue-flow-setup.lock";

/** How old a lock without a pid must be to count as left by a process that died at once. */
const LOCK_NO_PID_MS = 10_000;

/** Seconds a setup waits for another one of the same worktree. */
const LOCK_WAIT_SECONDS = 600;

/** Hex digits of the hash in the Docker suffix, as in `dockerProject`. */
const SUFFIX_HASH = 6;

/** Where the steps run, and with what. */
export interface StepPlace {
  root: string;
  mainRoot: string;
  base: string;
  config: FlowConfig;
  out: Output;
  remote: boolean;
}

/**
 * The worktree's own git dir.
 * @param root - The worktree.
 * @returns The path.
 */
function gitDir(root: string): string {
  return git(root, ["rev-parse", "--path-format=absolute", "--git-dir"]).out;
}

/**
 * Whether the worktree's code can run an install: its HEAD is in `origin/<base>` and it has
 * no changes to tracked files. A branch of someone else could put anything in the scripts
 * an install runs.
 * @param root - The worktree.
 * @param base - The base branch.
 * @returns True if it is trusted.
 * @example trustedCode(wt, "main")
 */
export function trustedCode(root: string, base: string): boolean {
  return git(root, ["merge-base", "--is-ancestor", "HEAD", `origin/${base}`]).ok && isClean(root, false);
}

/**
 * The environment of a step: the worktree, the main checkout, the first port of its block
 * (if the config has ports) and the suffix of its Docker projects (`<prefix>-<suffix>`).
 * @param place - Where.
 * @param port - The block's first port, or null.
 * @returns The variables.
 * @example stepEnv(place, 21430).ISSUE_FLOW_PORT_BASE // "21430"
 */
export function stepEnv(place: StepPlace, port: number | null): Record<string, string> {
  return {
    ISSUE_FLOW_WORKTREE: place.root,
    ISSUE_FLOW_MAIN_ROOT: place.mainRoot,
    ISSUE_FLOW_DOCKER_SUFFIX: `${sanitizeLabel(basename(place.root))}-${sha256(place.root).slice(0, SUFFIX_HASH)}`,
    ...(port === null ? {} : { ISSUE_FLOW_PORT_BASE: String(port) }),
  };
}

/**
 * Runs one step with `sh -c` in the worktree. Its output goes to stderr, so the stdout of
 * the session hook stays for what Claude must read.
 * @param place - Where.
 * @param step - The step.
 * @param env - The step's variables.
 * @returns True if it worked.
 */
function runStep(place: StepPlace, step: Step, env: Record<string, string>): boolean {
  const result = spawnSync("sh", ["-c", step.run], { cwd: place.root, env: { ...process.env, ...env }, stdio: ["ignore", 2, 2] });
  if (result.status === 0) return true;
  warn(place.out, `step "${step.name}" failed${result.status === null ? "" : ` (exit ${result.status})`}; run '${step.run}' in ${place.root}.`);
  return false;
}

/**
 * Takes the setup's lock: a folder with the pid. A lock of a process that is gone is taken
 * over, and so is one without a pid that is some seconds old (its process died before
 * writing it); another one is waited for.
 * @param lock - The folder.
 * @param out - Where the wait is said.
 * @returns True if it was taken, false if it waited too long.
 */
async function takeLock(lock: string, out: Output): Promise<boolean> {
  for (let waited = 0; waited < LOCK_WAIT_SECONDS; waited += 1) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, "pid"), `${process.pid}\n`);
      return true;
    } catch {
      const pidFile = join(lock, "pid");
      const owner = Number(existsSync(pidFile) ? readFileSync(pidFile, "utf8").trim() : "");
      const orphan = !existsSync(pidFile) && existsSync(lock) && Date.now() - statSync(lock).mtimeMs > LOCK_NO_PID_MS;
      if (orphan || (Number.isInteger(owner) && owner > 0 && !alive(owner))) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (waited === 0) warn(out, "another setup is preparing this worktree; waiting for it…");
      await sleep(1000);
    }
  }
  return false;
}

/**
 * Whether a process is alive.
 * @param pid - The pid.
 * @returns True if it is (or it is another user's).
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Prepares a worktree with the setup steps: one (`only`) or all, in order. In the main
 * checkout it does nothing, except in a cloud session, whose checkout is not a worktree. It
 * fixes the block of ports first, so the steps (and the apps after them) agree on it.
 * Never stops on a failed step: it says what to run and goes on.
 * @param place - Where.
 * @param only - The step to run, or null for all.
 * @returns True if every step that ran worked.
 * @example await runSetup(place, null)
 */
export async function runSetup(place: StepPlace, only: string | null): Promise<boolean> {
  const { root, mainRoot, config, out } = place;
  if (root === mainRoot && !place.remote) return true;
  const chosen = config.worktrees.setup.filter((step) => only === null || step.name === only);
  const ports = config.worktrees.ports;
  const port = ports === null ? null : await claimPortBase(ports, root, null);
  if (ports !== null && port === null) warn(out, "no block of ports is free on this machine; delete worktrees you no longer use.");
  if (chosen.length === 0) return true;
  const lock = join(gitDir(root), LOCK_NAME);
  if (!(await takeLock(lock, out))) {
    warn(out, `another setup has been running for over ${LOCK_WAIT_SECONDS} s; nothing ran. Run 'issue-flow worktree setup' in ${root} when it ends.`);
    return false;
  }
  try {
    return chosen.map((step) => setupStep(place, step, stepEnv(place, port))).every(Boolean);
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * One setup step: skipped if it is `once` and already worked, or `trusted` and the code is
 * not; run otherwise, leaving its mark if it is `once`.
 * @param place - Where.
 * @param step - The step.
 * @param env - Its variables.
 * @returns True unless it ran and failed.
 */
function setupStep(place: StepPlace, step: Step, env: Record<string, string>): boolean {
  const mark = join(gitDir(place.root), SETUP_MARKS_DIR, step.name);
  if (step.once && existsSync(mark)) return true;
  if (step.trusted && !place.remote && !trustedCode(place.root, place.base)) {
    warn(place.out, `skipped "${step.name}": this worktree has code that is not in origin/${place.base}. Check it and run '${step.run}' in ${place.root} if you trust it.`);
    return true;
  }
  if (!runStep(place, step, env)) return false;
  if (step.once) {
    mkdirSync(join(gitDir(place.root), SETUP_MARKS_DIR), { recursive: true });
    writeFileSync(mark, "");
  }
  return true;
}

/**
 * Cleans a worktree before it is deleted: its apps and then its teardown steps (if the
 * folder still exists), so a step that drops a database finds nobody connected; then its
 * block of ports and its Docker. Never stops: a step or a Docker that
 * fails gets a warning, because a cleanup cannot block the deletion.
 * @param place - Where; the folder may be gone already.
 * @returns True if nothing failed.
 * @example await teardownWorktree(place)
 */
export async function teardownWorktree(place: StepPlace): Promise<boolean> {
  const { root, config, out } = place;
  const ports = config.worktrees.ports;
  let ok = true;
  if (existsSync(root)) {
    const base = ports === null ? null : portBase(ports, root);
    if (ports !== null && base !== null) await stopApps(ports, base, root, out);
    const env = stepEnv(place, base);
    for (const step of config.worktrees.teardown) ok = runStep(place, step, env) && ok;
  }
  releasePortClaims(root, null);
  const docker = dockerCleanup(config.worktrees.dockerProjects, root);
  if (!docker.dockerRunning)
    warn(out, "Docker is not running; the worktree's containers stay. Start Docker and run 'issue-flow worktree cleanup'.");
  if (docker.failed.length > 0)
    warn(out, `could not delete the Docker projects ${docker.failed.join(", ")}; see what holds them with 'docker ps -a --filter label=com.docker.compose.project=<project>'.`);
  return ok && docker.dockerRunning && docker.failed.length === 0;
}
