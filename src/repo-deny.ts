/**
 * @file `--free --no-repo-deny`: takes the `deny` rules out of the worktree's
 * `.claude/settings.json` while Claude runs, and puts them back when it exits. Claude adds
 * the `deny` of every settings file it loads and `--dangerously-skip-permissions` respects
 * them, so a flag cannot drop them; and `--setting-sources user,local` drops them but also
 * the repo's `CLAUDE.md`, skills, agents and MCP servers. Editing the worktree's own copy
 * keeps all that, and leaves the main checkout and the other worktrees alone.
 *
 * While the rules are out, `git update-index --skip-worktree` hides the change from
 * `git status` and `git add`, so it never lands in a commit. A note in the shared `.git`
 * keeps the original, so a session whose terminal was closed is put back on the next
 * `issue start` of the branch.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { git } from "./git.js";
import { noteFile } from "./launch.js";

/** The repo's Claude settings, relative to the checkout. */
export const REPO_SETTINGS = ".claude/settings.json";

/** What it takes to put the rules back. */
interface Note {
  /** The worktree. */
  workDir: string;
  /** The file as it was. */
  original: string;
  /** The file as issue-flow left it, without the rules. */
  lifted: string;
}

/**
 * The settings without `permissions.deny` (and without `permissions` if nothing else is
 * left in it), or null if they have no rules to take out.
 * @param text - The settings file.
 * @returns The new text, or null.
 * @throws SyntaxError if the file is not JSON.
 * @example withoutDeny('{"permissions":{"deny":["Edit(/x)"]}}') // "{}\n"
 */
export function withoutDeny(text: string): string | null {
  const settings = JSON.parse(text) as { permissions?: { deny?: unknown[] } & Record<string, unknown> };
  const deny = settings.permissions?.deny;
  if (!Array.isArray(deny) || deny.length === 0) return null;
  const { deny: _dropped, ...permissions } = settings.permissions ?? {};
  const { permissions: _old, ...rest } = settings;
  const result = Object.keys(permissions).length === 0 ? rest : { ...rest, permissions };
  return `${JSON.stringify(result, null, 2)}\n`;
}

/**
 * Takes the `deny` rules out of the worktree's settings and hides the change from git.
 * @param workDir - The worktree.
 * @param commonDir - The shared `.git`.
 * @param branch - The branch.
 * @returns What happened, for the person.
 * @example liftRepoDeny(wt, "/repo/.git", "feat/42-x") // "took out the deny rules of .claude/settings.json for this session."
 */
export function liftRepoDeny(workDir: string, commonDir: string, branch: string): string {
  const file = join(workDir, REPO_SETTINGS);
  if (!existsSync(file)) return `the repo has no ${REPO_SETTINGS}: there are no deny rules to take out.`;
  const original = readFileSync(file, "utf8");
  let lifted: string | null;
  try {
    lifted = withoutDeny(original);
  } catch {
    return `${REPO_SETTINGS} is not valid JSON: its deny rules stay.`;
  }
  if (lifted === null) return `${REPO_SETTINGS} has no deny rules: nothing to take out.`;
  const note = noteFile(commonDir, branch);
  mkdirSync(dirname(note), { recursive: true });
  writeFileSync(note, `${JSON.stringify({ workDir, original, lifted } satisfies Note)}\n`);
  writeFileSync(file, lifted);
  git(workDir, ["update-index", "--skip-worktree", REPO_SETTINGS]);
  return `took out the deny rules of ${REPO_SETTINGS} for this session; they come back when Claude exits.`;
}

/**
 * Puts the rules back, if the branch's note says they are out. If Claude changed the file
 * meanwhile, it is left as it is, visible to git again, with a warning: putting the
 * original back would lose that change.
 * @param commonDir - The shared `.git`.
 * @param branch - The branch.
 * @returns A warning, or null if there was nothing to say.
 * @example restoreRepoDeny("/repo/.git", "feat/42-x") // null
 */
export function restoreRepoDeny(commonDir: string, branch: string): string | null {
  const note = noteFile(commonDir, branch);
  if (!existsSync(note)) return null;
  let saved: Note;
  try {
    saved = JSON.parse(readFileSync(note, "utf8")) as Note;
  } catch {
    rmSync(note, { force: true });
    return `could not read ${note}; check the deny rules of ${REPO_SETTINGS} with git diff.`;
  }
  rmSync(note, { force: true });
  const file = join(saved.workDir, REPO_SETTINGS);
  if (!existsSync(saved.workDir)) return null;
  git(saved.workDir, ["update-index", "--no-skip-worktree", REPO_SETTINGS]);
  const now = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (now !== saved.lifted)
    return `Claude changed ${REPO_SETTINGS} during the session, so its deny rules were not put back: add them again before committing (git diff ${REPO_SETTINGS}).`;
  writeFileSync(file, saved.original);
  return null;
}

