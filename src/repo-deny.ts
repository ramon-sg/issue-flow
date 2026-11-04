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
import type { Messages } from "./messages/index.js";

/** The repo's Claude settings, relative to the checkout. */
export const REPO_SETTINGS = ".claude/settings.json";

/** What it takes to put the rules back. */
export interface Lifted {
  /** The file as it was. */
  original: string;
  /** The file as issue-flow left it, without the rules. */
  lifted: string;
}

/** The settings, as far as the deny rules go. */
type Settings = { permissions?: { deny?: unknown[] } & Record<string, unknown> } & Record<string, unknown>;

/**
 * The settings without `permissions.deny` (and without `permissions` if nothing else is
 * left in it), or null if they have no rules to take out.
 * @param text - The settings file.
 * @returns The new text, or null.
 * @throws SyntaxError if the file is not JSON.
 * @example withoutDeny('{"permissions":{"deny":["Edit(/x)"]}}') // "{}\n"
 */
export function withoutDeny(text: string): string | null {
  const settings = JSON.parse(text) as Settings;
  const deny = settings.permissions?.deny;
  if (!Array.isArray(deny) || deny.length === 0) return null;
  const { deny: _dropped, ...permissions } = settings.permissions ?? {};
  const { permissions: _old, ...rest } = settings;
  const result = Object.keys(permissions).length === 0 ? rest : { ...rest, permissions };
  return `${JSON.stringify(result, null, 2)}\n`;
}

/**
 * The settings with the original's deny rules added back (keeping any the text has).
 * @param text - The settings now.
 * @param original - The settings with the rules.
 * @returns The new text.
 * @throws SyntaxError if either is not JSON.
 * @example withDeny("{}", '{"permissions":{"deny":["Edit(/x)"]}}') // '{\n  "permissions": {\n    "deny": [\n      "Edit(/x)"\n    ]\n  }\n}\n'
 */
export function withDeny(text: string, original: string): string {
  const settings = JSON.parse(text) as Settings;
  const deny = (JSON.parse(original) as Settings).permissions?.deny ?? [];
  const now = Array.isArray(settings.permissions?.deny) ? settings.permissions.deny : [];
  const merged = [...deny, ...now.filter((rule) => !deny.includes(rule))];
  return `${JSON.stringify({ ...settings, permissions: { ...settings.permissions, deny: merged } }, null, 2)}\n`;
}

/**
 * Takes the `deny` rules out of the worktree's settings and hides the change from git. A
 * note in the shared `.git` keeps the original in case the process dies before it puts
 * them back; the caller keeps what it returns and puts them back from that.
 * @param workDir - The worktree.
 * @param commonDir - The shared `.git`.
 * @param branch - The branch.
 * @param t - The messages.
 * @returns What happened, for the person, and what to put back (null if nothing was taken).
 * @example liftRepoDeny(wt, "/repo/.git", "feat/42-x", t).message
 */
export function liftRepoDeny(workDir: string, commonDir: string, branch: string, t: Messages): { message: string; saved: Lifted | null } {
  const file = join(workDir, REPO_SETTINGS);
  if (!existsSync(file)) return { message: t.denyRepo.noFile(REPO_SETTINGS), saved: null };
  const original = readFileSync(file, "utf8");
  let lifted: string | null;
  try {
    lifted = withoutDeny(original);
  } catch {
    return { message: t.denyRepo.invalidJson(REPO_SETTINGS), saved: null };
  }
  if (lifted === null) return { message: t.denyRepo.noRules(REPO_SETTINGS), saved: null };
  const saved: Lifted = { original, lifted };
  const note = noteFile(commonDir, branch);
  mkdirSync(dirname(note), { recursive: true });
  writeFileSync(note, `${JSON.stringify(saved)}\n`);
  writeFileSync(file, lifted);
  git(workDir, ["update-index", "--skip-worktree", REPO_SETTINGS]);
  return { message: t.denyRepo.lifted(REPO_SETTINGS), saved };
}

/**
 * Puts the rules back in the worktree's settings. From `saved` when the caller kept it (the
 * note is in reach of the session, so it is only trusted after a process that died); else
 * from the branch's note, if there is one. If Claude changed the file meanwhile, the rules
 * go back on top of its change, with a warning to review it.
 * @param commonDir - The shared `.git`.
 * @param branch - The branch.
 * @param workDir - The worktree, never taken from the note.
 * @param saved - What liftRepoDeny returned, or null to read the note.
 * @param t - The messages.
 * @returns A warning, or null if there was nothing to say.
 * @example restoreRepoDeny("/repo/.git", "feat/42-x", wt, null, t) // null
 */
export function restoreRepoDeny(commonDir: string, branch: string, workDir: string, saved: Lifted | null, t: Messages): string | null {
  const note = noteFile(commonDir, branch);
  let from = saved;
  if (from === null) {
    if (!existsSync(note)) return null;
    try {
      from = JSON.parse(readFileSync(note, "utf8")) as Lifted;
    } catch {
      rmSync(note, { force: true });
      return t.denyRepo.unreadable(note, REPO_SETTINGS);
    }
  }
  rmSync(note, { force: true });
  if (!existsSync(workDir)) return null;
  const file = join(workDir, REPO_SETTINGS);
  git(workDir, ["update-index", "--no-skip-worktree", REPO_SETTINGS]);
  const now = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (now === from.lifted || now === null) {
    writeFileSync(file, from.original);
    return null;
  }
  try {
    writeFileSync(file, withDeny(now, from.original));
  } catch {
    return t.denyRepo.brokenByClaude(REPO_SETTINGS);
  }
  return t.denyRepo.changedByClaude(REPO_SETTINGS);
}
