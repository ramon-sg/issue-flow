/**
 * @file The Claude Code hooks `apply` registers in `.claude/settings.json`: `SessionStart`
 * (`issue-flow session`) and `WorktreeCreate` and `WorktreeRemove` (`issue-flow hook …`), each
 * pinned to this package's version. They are found again by their command, so running
 * `apply` twice changes nothing, and a new version only moves the version. The `SessionStart`
 * command names `claude-cloud session`, which `issue-flow session` runs in the cloud: that
 * way `claude-cloud init` sees it and does not add its own, and a hook of `claude-cloud`
 * already there is dropped, so it does not run twice.
 */
import { isObject } from "./config-base.js";
import { PACKAGE, SETTINGS_FILE, SetupError } from "./setup-files.js";

/** Seconds each hook may take: the setup steps can install dependencies. */
const HOOK_TIMEOUT_SECONDS = 600;

/** What `claude-cloud init` looks for in a `SessionStart` command. */
const CLOUD_MARKER = "claude-cloud session";

/** The subcommand of each hook, and what follows it. */
const HOOK_COMMANDS: Record<string, { sub: string; note: string }> = {
  SessionStart: { sub: "session", note: ` # runs ${CLOUD_MARKER} in the cloud` },
  WorktreeCreate: { sub: "hook worktree-create", note: "" },
  WorktreeRemove: { sub: "hook worktree-remove", note: "" },
};

/** The hook events `apply` registers. */
export const HOOK_EVENTS = Object.keys(HOOK_COMMANDS);

/**
 * The command of one of the hooks, at a version.
 * @param event - The hook event.
 * @param version - This package's version.
 * @returns The command.
 * @example hookCommand("WorktreeCreate", "0.1.0") // "npx --yes @ramon-sg/issue-flow@0.1.0 hook worktree-create"
 */
export function hookCommand(event: string, version: string): string {
  const hook = HOOK_COMMANDS[event];
  if (hook === undefined) throw new SetupError(`unknown hook event ${event}.`);
  return `npx --yes ${PACKAGE}@${version} ${hook.sub}${hook.note}`;
}

/** A hook of a settings entry, as Claude Code keeps it. */
type Hook = { command?: unknown } & Record<string, unknown>;

/**
 * The version of our hook in a command, or null if the command is not ours for that event.
 * @param command - The command.
 * @param event - The event.
 * @returns The version.
 */
function ourVersion(command: unknown, event: string): string | null {
  const sub = HOOK_COMMANDS[event]?.sub;
  if (typeof command !== "string" || sub === undefined) return null;
  const match = new RegExp(`${PACKAGE.replace("/", "\\/")}@(\\S+) ${sub}(?:\\s|$)`).exec(command);
  return match?.[1] ?? null;
}

/**
 * The entries of an event in the settings, checked.
 * @param hooks - The `hooks` object.
 * @param event - The event.
 * @returns Its entries (a new array if there were none).
 * @throws SetupError if they are not a list of objects.
 */
function entriesOf(hooks: Record<string, unknown>, event: string): Record<string, unknown>[] {
  const entries = hooks[event] ?? [];
  if (!Array.isArray(entries) || !entries.every(isObject))
    throw new SetupError(`${SETTINGS_FILE}: hooks.${event} is not a list of entries; fix it and run again.`);
  return entries;
}

/**
 * The hooks of an entry.
 * @param entry - The entry.
 * @returns Its hooks, or an empty list.
 */
function hooksOf(entry: Record<string, unknown>): Hook[] {
  return Array.isArray(entry.hooks) ? (entry.hooks.filter(isObject) as Hook[]) : [];
}

/**
 * Registers our hooks at a version: moves the version of the ones already there and adds
 * the missing ones. In `SessionStart` it drops a `claude-cloud session` hook that is not
 * ours.
 * @param settings - The settings, or null if there is no file.
 * @param version - This package's version.
 * @returns The new settings and what changed, one line each.
 * @throws SetupError if `hooks` or an event of it is not what Claude Code expects.
 * @example registerHooks(null, "0.1.0").changes // ["added the SessionStart hook", …]
 */
export function registerHooks(settings: Record<string, unknown> | null, version: string): { settings: Record<string, unknown>; changes: string[] } {
  const next = { ...(settings ?? {}) };
  const hooks = next.hooks ?? {};
  if (!isObject(hooks)) throw new SetupError(`${SETTINGS_FILE}: "hooks" is not an object; fix it and run again.`);
  next.hooks = { ...hooks };
  const changes: string[] = [];
  for (const event of HOOK_EVENTS) {
    const entries = entriesOf(hooks, event);
    const command = hookCommand(event, version);
    let found = false;
    const kept = entries.map((entry) => {
      const inner = hooksOf(entry).flatMap((hook): Hook[] => {
        const current = ourVersion(hook.command, event);
        if (current !== null) {
          found = true;
          if (hook.command === command) return [hook];
          changes.push(`moved the ${event} hook from ${current} to ${version}`);
          return [{ ...hook, command }];
        }
        if (event === "SessionStart" && typeof hook.command === "string" && hook.command.includes(CLOUD_MARKER)) {
          changes.push(`dropped the ${CLOUD_MARKER} SessionStart hook: issue-flow session runs it`);
          return [];
        }
        return [hook];
      });
      return Array.isArray(entry.hooks) ? { ...entry, hooks: inner } : entry;
    }).filter((entry) => !Array.isArray(entry.hooks) || entry.hooks.length > 0);
    if (!found) {
      kept.push({ hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_SECONDS }] });
      changes.push(`added the ${event} hook`);
    }
    (next.hooks as Record<string, unknown>)[event] = kept;
  }
  return { settings: next, changes };
}

/**
 * The version of each of our hooks in the settings.
 * @param settings - The settings, or null.
 * @returns Event to version, or null if the hook is missing.
 * @example hookVersions(settings).SessionStart // "0.1.0"
 */
export function hookVersions(settings: Record<string, unknown> | null): Record<string, string | null> {
  const hooks = isObject(settings?.hooks) ? settings.hooks : {};
  const versions: Record<string, string | null> = {};
  for (const event of HOOK_EVENTS) {
    const entries = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]).filter(isObject) : [];
    const commands = entries.flatMap((entry) => hooksOf(entry).map((hook) => hook.command));
    versions[event] = commands.map((command) => ourVersion(command, event)).find((found) => found !== null) ?? null;
  }
  return versions;
}
