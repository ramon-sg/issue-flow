/**
 * @file What `issue start` knows about the issue once it chose the branch and the place:
 * shared by the summary, the preparation and the publishing, so none of them asks git or
 * GitHub twice.
 */
import type { IssueView } from "@ramon-sg/github-rest";
import type { FlowConfig, Namer } from "./config.js";
import type { PrKind, StartMode, TitleDrift } from "./issue-text.js";
import type { Permissions } from "./launch.js";
import type { Launch } from "./launch-as.js";
import type { Output } from "./output.js";
import { type Runner, effectiveRunner, toolCommandText } from "@ramon-sg/runner";
import { locateRepo } from "./git.js";
import { FREE_SCRIPT, START_SCRIPT } from "./package-edits.js";
import { readRunnerFile } from "./runner-file.js";
import { PACKAGE, SetupError } from "./setup-files.js";
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

/** The user declined a question: nothing was done, which is not a failure to show as an error. */
export class DeclinedError extends StartError {}

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
  /** The resumed PR's title and the one it should have, if they differ. */
  titleDrift: TitleDrift | null;
}

/** Flags that `--cloud` refuses. */
const CLOUD_DROPPED = ["--free", "--ask-permissions", "--no-repo-deny"];

/**
 * The pinned issue-flow of the repo, as a runnable command prefix, if `runner.json` has one.
 * @param cwd - Where issue-flow runs.
 * @returns The runner and version to run issue-flow with, or null.
 */
function pinnedFlow(cwd: string): { runner: Runner; version: string } | null {
  try {
    const root = locateRepo(cwd)?.mainRoot;
    const config = root === undefined ? null : readRunnerFile(root);
    const version = config !== null && Object.hasOwn(config.tools, PACKAGE) ? config.tools[PACKAGE] : undefined;
    return config === null || version === undefined ? null : { runner: effectiveRunner(config), version };
  } catch (error) {
    if (error instanceof SetupError) return null;
    throw error;
  }
}

/**
 * The command that starts or resumes this issue, for the messages: it repeats how
 * issue-flow was launched (`bun run issue:start:free 34`), or runs the issue-flow pinned in
 * `runner.json` with its runner (without it, plain `issue-flow issue start`).
 * @param options - The options of the run: the issue and how it was launched.
 * @param extra - Flags to add, at the end.
 * @returns The command.
 * @example again({ number: 42, launchedAs: { manager: null, script: null, flags: [] } }) // "issue-flow issue start 42"
 */
export function again(options: Pick<StartOptions, "number" | "launchedAs" | "cwd">, extra = ""): string {
  const { manager, flags: launched } = options.launchedAs;
  // --cloud does not go with the permission flags, and the free script implies them: a resume that repeated them would fail.
  const cloud = extra === "--cloud";
  const flags = cloud ? launched.filter((flag) => !CLOUD_DROPPED.includes(flag)) : launched;
  const script = cloud && options.launchedAs.script === FREE_SCRIPT ? START_SCRIPT : options.launchedAs.script;
  const rest = [...flags, ...(extra === "" ? [] : [extra])];
  if (manager === null || script === null) {
    const flow = pinnedFlow(options.cwd);
    const words = [String(options.number), ...rest.flatMap((flag) => flag.split(" "))];
    if (flow === null) return ["issue-flow issue start", ...words].join(" ");
    return toolCommandText(flow.runner, PACKAGE, flow.version, ["issue", "start", ...words]);
  }
  const args = [String(options.number), ...rest];
  if (manager === "npm") return ["npm run", script, ...(rest.length > 0 ? ["--"] : []), ...args].join(" ");
  return [manager === "bun" ? "bun run" : manager, script, ...args].join(" ");
}
