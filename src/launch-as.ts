/**
 * @file How issue-flow was launched, so the command that resumes an issue repeats it: a
 * `bun run issue:start:free 34` that stops must say `bun run issue:start:free 34`, not
 * `issue-flow issue start 34`.
 */
import type { Flags } from "./cli-flags.js";
import { FREE_SCRIPT, START_SCRIPT } from "./package-edits.js";

/** The package managers that run scripts and say so in `npm_config_user_agent`. */
export type Manager = "bun" | "npm" | "pnpm" | "yarn";

/** The way issue-flow was launched. */
export interface Launch {
  /** The package manager, or null if it ran as `issue-flow` directly. */
  manager: Manager | null;
  /** The script the manager ran, or null. */
  script: typeof START_SCRIPT | typeof FREE_SCRIPT | null;
  /** The flags to repeat, as arguments. */
  flags: string[];
}

const MANAGERS: readonly string[] = ["bun", "npm", "pnpm", "yarn"];

/**
 * How issue-flow was launched, from the environment and the flags.
 * @param env - The environment.
 * @param flags - The parsed flags.
 * @returns The launch: manager and script are both null unless both are known.
 * @example launchOf({ npm_lifecycle_event: "issue:start", npm_config_user_agent: "npm/11 node/v20" }, {}).manager // "npm"
 */
export function launchOf(env: NodeJS.ProcessEnv, flags: Flags): Launch {
  const agent = (env.npm_config_user_agent ?? "").split("/")[0] ?? "";
  const event = env.npm_lifecycle_event;
  const known = MANAGERS.includes(agent) && (event === START_SCRIPT || event === FREE_SCRIPT);
  const manager = known ? (agent as Manager) : null;
  const script = known ? event : null;
  const repeated: string[] = [];
  if (flags["ask-permissions"]) repeated.push("--ask-permissions");
  if (flags.free && script !== FREE_SCRIPT) repeated.push("--free");
  if (flags["no-repo-deny"]) repeated.push("--no-repo-deny");
  if (flags.namer !== undefined) repeated.push("--namer", flags.namer);
  if (flags.repo !== undefined) repeated.push("-R", flags.repo);
  if (flags.lang !== undefined) repeated.push("--lang", flags.lang);
  return { manager, script, flags: repeated };
}
