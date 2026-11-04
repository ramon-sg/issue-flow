/**
 * @file Opens Claude for an issue in the same terminal. The permission mode follows
 * `claude-repo-guard` when the repo has it: auto mode with its classifier context by
 * default, plain `claude` with `--ask-permissions`, no sandbox nor questions with `--free`,
 * and also without the repo's deny rules with `--free --no-repo-deny`. Each branch keeps its session id, so starting the issue again resumes it.
 * Ported from `launch_session` and `run_claude` in Abastio's `scripts/start-issue.sh`.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { dirName, sessionName, type StartMode } from "./issue-text.js";
import type { Messages } from "./messages/index.js";

/** The file `claude-repo-guard` writes with the auto mode's classifier context. */
export const AUTO_MODE_FILE = ".claude/repo-guard.auto-mode.json";

/** Folder, inside the shared `.git`, with one file per branch holding its session id. */
export const SESSIONS_DIR = "issue-flow-sessions";

/** Settings that turn the sandbox off for one session, as `claude:free` does. */
const NO_SANDBOX = '{"sandbox":{"enabled":false}}';

/**
 * How Claude asks for permissions: chosen by the flags, or the default. `free-no-repo-deny`
 * is `--free --no-repo-deny`: the same arguments as `free`, and `issue start` also takes the
 * repo's deny rules out while Claude runs (see repo-deny.ts).
 */
export type Permissions = "default" | "ask" | "free" | "free-no-repo-deny";

/** The arguments of the permission mode, and how the summary names it. */
export interface PermissionArgs {
  args: string[];
  label: string;
}

/**
 * The arguments for the permission mode. By default, auto mode with the classifier context
 * of `claude-repo-guard` if the repo has it (relative, from the folder where Claude runs,
 * if it is there; or else by its full path in the main checkout), and plain `claude` if it
 * does not.
 * @param permissions - What the flags asked for.
 * @param workDir - Where Claude runs, or null if that folder does not exist yet.
 * @param mainRoot - The main checkout.
 * @param t - The messages, for the label.
 * @returns The arguments and their label.
 * @example permissionArgs("default", wt, root, t).args // ["--settings", ".claude/repo-guard.auto-mode.json", "--permission-mode", "auto"]
 */
export function permissionArgs(
  permissions: Permissions,
  workDir: string | null,
  mainRoot: string,
  t: Messages["start"]["permissions"],
): PermissionArgs {
  if (permissions === "free")
    return {
      args: ["--settings", NO_SANDBOX, "--dangerously-skip-permissions"],
      label: t.free,
    };
  if (permissions === "free-no-repo-deny")
    return {
      args: ["--settings", NO_SANDBOX, "--dangerously-skip-permissions"],
      label: t.freeNoRepoDeny,
    };
  if (permissions === "ask") return { args: [], label: t.ask };
  const file = workDir !== null && existsSync(join(workDir, AUTO_MODE_FILE))
    ? AUTO_MODE_FILE
    : existsSync(join(mainRoot, AUTO_MODE_FILE))
      ? join(mainRoot, AUTO_MODE_FILE)
      : null;
  if (file === null) return { args: [], label: t.noGuard };
  return {
    args: ["--settings", file, "--permission-mode", "auto"],
    label: t.auto,
  };
}

/**
 * Whether a program is in the PATH, without running it.
 * @param name - The program.
 * @returns True if it is.
 * @example inPath("claude")
 */
export function inPath(name: string): boolean {
  return (process.env.PATH ?? "")
    .split(delimiter)
    .some((dir) => dir !== "" && existsSync(join(dir, name)));
}

/**
 * The file that holds a branch's session id.
 * @param commonDir - The shared `.git`.
 * @param branch - The branch.
 * @returns The path.
 * @example sessionFile("/repo/.git", "feat/42-x") // "/repo/.git/issue-flow-sessions/feat+42-x"
 */
export function sessionFile(commonDir: string, branch: string): string {
  return join(commonDir, SESSIONS_DIR, dirName(branch));
}

/**
 * Whether Claude Code has a saved session with that id.
 * @param id - The id.
 * @returns True if it does.
 * @example sessionExists("11111111-2222-3333-4444-555555555555")
 */
export function sessionExists(id: string): boolean {
  const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
  if (!existsSync(projects)) return false;
  return readdirSync(projects).some((project) => existsSync(join(projects, project, `${id}.jsonl`)));
}

/**
 * The saved session of a branch, if Claude still has it.
 * @param commonDir - The shared `.git`.
 * @param branch - The branch.
 * @returns The id, or null.
 * @example savedSession("/repo/.git", "feat/42-x")
 */
export function savedSession(commonDir: string, branch: string): string | null {
  const file = sessionFile(commonDir, branch);
  if (!existsSync(file)) return null;
  const id = readFileSync(file, "utf8").trim();
  return id !== "" && sessionExists(id) ? id : null;
}

/**
 * The note `--no-repo-deny` keeps while the repo's deny rules are out, next to the
 * branch's session id.
 * @param commonDir - The shared `.git`.
 * @param branch - The branch.
 * @returns The path.
 * @example noteFile("/repo/.git", "feat/42-x") // "/repo/.git/issue-flow-sessions/feat+42-x.repo-deny.json"
 */
export function noteFile(commonDir: string, branch: string): string {
  return `${sessionFile(commonDir, branch)}.repo-deny.json`;
}

/**
 * Forgets a branch's session id (and its `--no-repo-deny` note), once its work is gone.
 * @param commonDir - The shared `.git`.
 * @param branch - The branch.
 * @example forgetSession("/repo/.git", "feat/42-x")
 */
export function forgetSession(commonDir: string, branch: string): void {
  rmSync(sessionFile(commonDir, branch), { force: true });
  rmSync(noteFile(commonDir, branch), { force: true });
}

/** What opening Claude needs. */
export interface LaunchPlan {
  workDir: string;
  commonDir: string;
  branch: string;
  mode: StartMode;
  prompt: string;
  color: string | null;
  permissions: string[];
}

/**
 * Runs Claude in the terminal; its exit code does not matter, what follows runs anyway.
 * @param cwd - Where.
 * @param args - The arguments.
 */
function runClaude(cwd: string, args: string[]): void {
  spawnSync("claude", args, { cwd, stdio: "inherit" });
}

/**
 * Opens Claude: resumes the branch's saved session or creates one with its name, its color
 * and the prompt. The color is set first with a `claude -p "/color …"` on the new session,
 * because a session only takes it from a command.
 * @param plan - Where, which branch and with what.
 * @param warn - Where a warning goes.
 * @param t - The messages, for the warning.
 * @example launchSession(plan, (text) => console.error(text), messages("en"))
 */
export function launchSession(plan: LaunchPlan, warn: (text: string) => void, t: Messages): void {
  const saved = savedSession(plan.commonDir, plan.branch);
  if (saved !== null) {
    runClaude(plan.workDir, [...plan.permissions, "--resume", saved, plan.prompt]);
    return;
  }
  const id = randomUUID();
  const file = sessionFile(plan.commonDir, plan.branch);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${id}\n`);
  const name = sessionName(plan.branch, plan.mode);
  if (plan.color !== null) {
    const colored = spawnSync("claude", ["-p", "--session-id", id, "-n", name, `/color ${plan.color}`], {
      cwd: plan.workDir,
      stdio: "ignore",
    });
    if (colored.status !== 0) warn(t.start.warn.noColor);
  }
  if (sessionExists(id)) runClaude(plan.workDir, [...plan.permissions, "--resume", id, plan.prompt]);
  else runClaude(plan.workDir, [...plan.permissions, "--session-id", id, "-n", name, plan.prompt]);
}

/**
 * Brings a cloud session to the folder with `claude --teleport`: the one noted in the PR,
 * or the list of sessions to choose from if there is none. It keeps no session id: once
 * brought, `claude --resume` finds it.
 * @param workDir - Where.
 * @param permissions - The arguments of the permission mode.
 * @param id - The cloud session, or null for the list.
 * @example teleportSession(wt, [], "session_01A")
 */
export function teleportSession(workDir: string, permissions: string[], id: string | null): void {
  runClaude(workDir, [...permissions, "--teleport", ...(id === null ? [] : [id])]);
}
