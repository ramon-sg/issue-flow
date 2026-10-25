/**
 * @file `issue-flow session`: the `SessionStart` hook of Claude Code. What it prints on
 * stdout reaches Claude as the session's context, so every warning goes there. Its steps:
 * in a cloud session, `claude-cloud session` (tools, Docker, the full history and the
 * repo's session steps); in a worktree (or the cloud's checkout), the setup steps; in a
 * local worktree whose issue branch is not published, a warning to run `start-issue`; the
 * cleanup of the Docker of deleted worktrees (Claude Code does not call `WorktreeRemove`
 * for worktrees made with git); and the environment of `direnv` in `CLAUDE_ENV_FILE`,
 * which Claude Code reads before each command. It never makes the session fail. Ported
 * from Abastio's `scripts/claude-session-env.sh`.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { FlowConfig } from "../config.js";
import { dockerCleanup } from "../docker.js";
import { currentBranch, onOrigin } from "../git.js";
import { issueOfBranch } from "../issue-text.js";
import { inPath } from "../launch.js";
import type { Output } from "../output.js";
import { runSetup } from "../worktree-steps.js";
import { stepPlace } from "./worktree.js";

/** Where the cloud environment's setup leaves the `claude-cloud` command. */
export const CLAUDE_CLOUD_BIN = "/opt/claude-cloud/bin/claude-cloud";

/** The package that prepares the cloud, for the message of what to set in claude.ai. */
const CLAUDE_CLOUD_PACKAGE = "@ramon-sg/claude-cloud";

/**
 * In a cloud session, runs `claude-cloud session` (`CLAUDE_CLOUD_BIN` changes where it is
 * looked for). Its output goes to stderr, as its steps print their own.
 * @param root - The checkout.
 * @param say - Where a message for Claude goes.
 */
function cloudSession(root: string, say: (text: string) => void): void {
  const bin = process.env.CLAUDE_CLOUD_BIN ?? CLAUDE_CLOUD_BIN;
  if (!existsSync(bin)) {
    say(`the environment setup did not run (there is no ${bin}). In claude.ai, set the environment's setup script to: npx -y ${CLAUDE_CLOUD_PACKAGE}@1 setup. It applies to new sessions.`);
    return;
  }
  if (spawnSync(bin, ["session"], { cwd: root, stdio: ["ignore", 2, 2] }).status !== 0)
    say(`claude-cloud session failed; run '${bin} session' in ${root} to see why.`);
}

/**
 * The issue of a local worktree whose branch has the issue's number and is not in origin:
 * it was never published, so the issue has no draft PR (a tool's setup may have failed
 * quietly). Its upstream does not tell: a worktree made from `origin/main` tracks it.
 * @param root - The worktree.
 * @returns The issue, or null.
 */
function unstartedIssue(root: string): number | null {
  const branch = currentBranch(root);
  if (branch === null || onOrigin(root, branch)) return null;
  return issueOfBranch(branch);
}

/**
 * Appends the environment of `direnv` to `CLAUDE_ENV_FILE`, so the session's commands get
 * what the `.envrc` loads (they run in shells that do not go through direnv's hook). A
 * failed export is not appended: with the `.envrc` blocked it still prints the unload of
 * the earlier environment, which would take from the session what it inherited.
 * @param root - The checkout.
 * @param say - Where a message for Claude goes.
 */
function direnvExport(root: string, say: (text: string) => void): void {
  const file = process.env.CLAUDE_ENV_FILE;
  if (file === undefined || file === "" || !existsSync(join(root, ".envrc")) || !inPath("direnv")) return;
  const result = spawnSync("direnv", ["export", "bash"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (result.status !== 0) {
    say("could not load the .envrc with direnv; the session keeps the environment it inherited.");
    return;
  }
  appendFileSync(file, `${result.stdout}\n`);
}

/**
 * `issue-flow session`.
 * @param options - The config and the session's folder.
 * @param out - Where to write; stdout reaches Claude.
 * @returns Always 0.
 * @example await session({ config, cwd }, out)
 */
export async function session(options: { config: FlowConfig; cwd: string }, out: Output): Promise<number> {
  const say = (text: string): void => out.stdout(`issue-flow session: ${text}\n`);
  const toClaude: Output = { ...out, stderr: (text) => out.stdout(text) };
  let place;
  try {
    place = stepPlace({ config: options.config, cwd: options.cwd }, toClaude);
  } catch {
    return 0;
  }
  const { root, mainRoot, remote } = place;
  if (remote) cloudSession(root, say);
  if (root !== mainRoot || remote) await runSetup(place, null);
  const unstarted = !remote && root !== mainRoot ? unstartedIssue(root) : null;
  if (unstarted !== null)
    say(`issue #${unstarted} was not started: its branch is not published and has no draft PR. Before working, run the start-issue skill (${unstarted}).`);
  const docker = dockerCleanup(options.config.worktrees.dockerProjects, null);
  if (docker.failed.length > 0) say(`could not delete the Docker of deleted worktrees (${docker.failed.join(", ")}); run 'issue-flow worktree cleanup' to see why.`);
  direnvExport(root, say);
  return 0;
}
