/**
 * @file What `issue start` knows about the issue once it chose the branch and the place:
 * shared by the summary, the preparation and the publishing, so none of them asks git or
 * GitHub twice.
 */
import type { IssueView } from "@ramon-sg/github-rest";
import type { FlowConfig, Namer } from "./config.js";
import type { PrKind, StartMode } from "./issue-text.js";
import type { Permissions } from "./launch.js";
import type { Launch } from "./launch-as.js";
import type { Output } from "./output.js";
import type { WorkState } from "./work-state.js";

/** Options of `issue start`. */
export interface StartOptions {
  repo: string;
  config: FlowConfig;
  cwd: string;
  number: number;
  namer?: Namer;
  dryRun: boolean;
  yes: boolean;
  resume: string | null;
  forceNew: boolean;
  branchMode: boolean;
  launch: boolean;
  permissions: Permissions;
  plan: boolean;
  cloud: boolean;
  here: boolean;
  teleport: boolean;
  adopt: boolean;
  remoteSession: string | null;
  launchedAs: Launch;
}

/** The branch of the worktree `--adopt` runs in, and whether another tool just made it. */
export interface Adopted {
  current: string;
  fresh: boolean;
}

/** Error that stops `issue start`: exits 1 with the message. */
export class StartError extends Error {}

/** The issue, its work and where it goes. */
export interface StartState {
  options: StartOptions;
  out: Output;
  commonDir: string;
  mainRoot: string;
  startRoot: string;
  base: string;
  issue: IssueView;
  labels: string[];
  work: WorkState;
  found: string | null;
  branch: string;
  pr: { number: number; state: "OPEN" | "CLOSED" } | null;
  kind: PrKind;
  mode: StartMode;
  workDir: string;
  plan: string | null;
  adopted: Adopted | null;
  cloudSession: string | null;
}

/**
 * The command that starts or resumes this issue, for the messages: it repeats how
 * issue-flow was launched (`bun run issue:start:free 34`), or is `issue-flow issue start`.
 * @param options - The options of the run: the issue and how it was launched.
 * @param extra - Flags to add, at the end.
 * @returns The command.
 * @example again({ number: 42, launchedAs: { manager: null, script: null, flags: [] } }) // "issue-flow issue start 42"
 */
export function again(options: Pick<StartOptions, "number" | "launchedAs">, extra = ""): string {
  const { manager, script, flags } = options.launchedAs;
  const rest = [...flags, ...(extra === "" ? [] : [extra])];
  if (manager === null || script === null) return ["issue-flow issue start", String(options.number), ...rest].join(" ");
  const args = [String(options.number), ...rest];
  if (manager === "npm") return ["npm run", script, ...(rest.length > 0 ? ["--"] : []), ...args].join(" ");
  return [manager === "bun" ? "bun run" : manager, script, ...args].join(" ");
}
