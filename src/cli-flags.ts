/**
 * @file The CLI's flags and which command takes each one, apart from cli.ts (which runs on
 * import) so the tests can check the usage text against them.
 */
import type { parseArgs } from "node:util";

/** Options of the CLI. */
export const OPTIONS = {
  repo: { type: "string", short: "R" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  lang: { type: "string" },
  missing: { type: "boolean" },
  limit: { type: "string" },
  namer: { type: "string" },
  yes: { type: "boolean", short: "y" },
  "dry-run": { type: "boolean" },
  branch: { type: "boolean" },
  resume: { type: "string" },
  new: { type: "boolean" },
  "no-launch": { type: "boolean" },
  "ask-permissions": { type: "boolean" },
  free: { type: "boolean" },
  "no-repo-deny": { type: "boolean" },
  plan: { type: "boolean" },
  cloud: { type: "boolean" },
  here: { type: "boolean" },
  teleport: { type: "boolean" },
  adopt: { type: "boolean" },
  only: { type: "string" },
  path: { type: "string" },
  next: { type: "boolean" },
  "no-setup": { type: "boolean" },
  recipe: { type: "string" },
  update: { type: "boolean" },
} as const;

/** The parsed flags. */
export type Flags = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true; strict: true }>>["values"];

/** Flags each command takes, besides `--repo`, `--help`, `--lang` and `--namer`. */
export const COMMAND_FLAGS: Record<string, (keyof Flags)[]> = {
  branch: ["json", "missing", "limit", "yes", "dry-run"],
  start: [
    "yes",
    "dry-run",
    "branch",
    "resume",
    "new",
    "no-launch",
    "ask-permissions",
    "free",
    "no-repo-deny",
    "plan",
    "cloud",
    "here",
    "teleport",
    "adopt",
  ],
  "worktree setup": ["only"],
  "worktree teardown": ["path"],
  "worktree ports": ["next"],
  "worktree cleanup": ["path"],
  "worktree prune": ["only", "yes"],
  session: [],
  "pr worktree": ["no-setup"],
  "adapter setup": ["only"],
  "adapter issue": [],
  "adapter archive": [],
  "hook worktree-create": [],
  "hook worktree-remove": [],
  apply: ["yes", "dry-run", "json", "recipe"],
  init: ["yes", "recipe"],
  doctor: ["json"],
  upgrade: ["dry-run"],
  "labels sync": ["update", "dry-run", "json"],
};
