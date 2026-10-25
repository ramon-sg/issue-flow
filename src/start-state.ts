/**
 * @file What `issue start` knows about the issue once it chose the branch and the place:
 * shared by the summary, the preparation and the publishing, so none of them asks git or
 * GitHub twice.
 */
import type { IssueView } from "@ramon-sg/github-rest";
import type { FlowConfig, Namer } from "./config.js";
import type { PrKind, StartMode } from "./issue-text.js";
import type { Permissions } from "./launch.js";
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
}

/** Error that stops `issue start`: exits 1 with the message. */
export class StartError extends Error {}

/** The issue, its work and where it goes. */
export interface StartState {
  options: StartOptions;
  out: Output;
  commonDir: string;
  mainRoot: string;
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
}

/**
 * The command that starts or resumes this issue, for the messages.
 * @param number - The issue.
 * @param extra - Flags to add.
 * @returns The command.
 * @example again(42) // "issue-flow issue start 42"
 */
export function again(number: number, extra = ""): string {
  return `issue-flow issue start ${number}${extra === "" ? "" : ` ${extra}`}`;
}
