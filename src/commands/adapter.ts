/**
 * @file `issue-flow adapter …`: what the worktree tools (Orca, https://www.onorca.dev, and
 * Paseo, https://paseo.sh) run when they make or delete a worktree, so the worktree gets
 * the same as one of `issue start`. `orca.yaml` and `paseo.json` only call it:
 *
 * - `setup [--only <step>]`, when the worktree is made: copies `.worktreeinclude` (Paseo
 * does not), runs the setup steps and, without `--only`, starts the issue the workspace
 * came from in it, as `issue start <n> --adopt`. Always exits 0: a failed setup leaves the
 * worktree usable and says what to run.
 * - `issue [<url>]`: only the start of the issue. Without a URL it is a setup step and
 * always exits 0; with one it is run by hand and exits with the code of `issue start`.
 * - `archive`, before the worktree goes: its teardown (steps, apps, ports, Docker). Always
 * exits 0, because a failed archive cannot block the deletion.
 *
 * The issue comes from the branch under Paseo (`<n>-` at the start or after a `/`) and
 * from Orca's CLI otherwise. Ported from Abastio's `scripts/orca-hooks.sh`.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { DEFAULT_CONFIG, type FlowConfig, loadConfig } from "../config.js";
import { canonicalPath, dockerCleanup } from "../docker.js";
import { checkoutRoot, currentBranch, locateRepo } from "../git.js";
import { issueOfBranch } from "../issue-text.js";
import { inPath } from "../launch.js";
import { type Output, UsageError, warn } from "../output.js";
import { releasePortClaims } from "../ports.js";
import { copyWorktreeIncludes } from "../start-place.js";
import { StartError } from "../start-state.js";
import { runSetup, teardownWorktree } from "../worktree-steps.js";
import { issueStart } from "./issue-start.js";
import { stepPlace } from "./worktree.js";

/** Orca's CLI, which knows which issue a workspace came from; `ISSUE_FLOW_ORCA_CLI` changes it. */
export const ORCA_CLI = "orca";

/** Options of `issue-flow adapter`. */
export interface AdapterOptions {
  config: FlowConfig;
  cwd: string;
  only: string | null;
  url: string | null;
  repo: () => string;
}

/** What Orca's `worktree current --json` says of the workspace, as far as it is used. */
interface OrcaWorktree {
  linkedWorkItem?: { url?: unknown } | null;
  linkedIssue?: unknown;
}

/**
 * The number of an issue of the repo by its URL; a slash, an anchor or a query may follow.
 * @param url - The URL.
 * @param repo - `owner/repo`.
 * @returns The number, or null if it is not an issue of the repo.
 * @example issueOfUrl("https://github.com/acme/widgets/issues/214#top", "acme/widgets") // 214
 */
export function issueOfUrl(url: string, repo: string): number | null {
  const found = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)(?:[/?#].*)?$/.exec(url);
  if (found?.[1] === undefined || found[2] === undefined) return null;
  return found[1].toLowerCase() === repo.toLowerCase() ? Number(found[2]) : null;
}

/**
 * The issue Orca says the workspace came from: `linkedWorkItem` (with its URL) when it was
 * made on the desktop, or the number alone in `linkedIssue` when it was made from Orca
 * Mobile, always of the project's repo. A work item of something else (Linear, a PR) has
 * no issue URL of the repo.
 * @param root - The worktree.
 * @param repo - `owner/repo`.
 * @param out - Where a failure is said.
 * @returns The number, null if it came from no issue, or undefined if Orca could not be asked.
 */
function orcaIssue(root: string, repo: string, out: Output): number | null | undefined {
  const bin = process.env.ISSUE_FLOW_ORCA_CLI ?? ORCA_CLI;
  const result = bin.includes("/") ? (existsSync(bin) ? run(bin, root) : null) : inPath(bin) ? run(bin, root) : null;
  let worktree: OrcaWorktree | undefined;
  try {
    worktree = result === null ? undefined : (JSON.parse(result) as { result?: { worktree?: OrcaWorktree } }).result?.worktree;
  } catch {
    worktree = undefined;
  }
  if (worktree === undefined) {
    warn(out, `could not ask Orca which issue this workspace came from. If it came from one, run 'issue-flow adapter issue <issue-url>' in ${root}.`);
    return undefined;
  }
  const item = worktree.linkedWorkItem;
  if (item !== undefined && item !== null)
    return typeof item.url === "string" ? issueOfUrl(item.url, repo) : null;
  return typeof worktree.linkedIssue === "number" && Number.isInteger(worktree.linkedIssue) ? worktree.linkedIssue : null;
}

/**
 * Runs `<orca> worktree current --json` in the worktree.
 * @param bin - Orca's CLI.
 * @param root - The worktree.
 * @returns Its output, or null if it failed.
 */
function run(bin: string, root: string): string | null {
  const result = spawnSync(bin, ["worktree", "current", "--json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? result.stdout : null;
}

/**
 * Starts an issue in this worktree, as `issue start <n> --adopt`: the branch of the
 * convention, the draft PR and the assignment, without asking nor opening Claude.
 * @param options - The options.
 * @param number - The issue.
 * @param out - Where to write.
 * @returns The exit code of `issue start`.
 * @throws What `issue start` throws.
 */
function adopt(options: AdapterOptions, number: number, out: Output): Promise<number> {
  return issueStart(
    {
      repo: options.repo(),
      config: options.config,
      cwd: options.cwd,
      number,
      dryRun: false,
      yes: false,
      resume: null,
      forceNew: false,
      branchMode: false,
      launch: false,
      permissions: "default",
      plan: false,
      cloud: false,
      here: false,
      teleport: false,
      adopt: true,
      remoteSession: null,
    },
    out,
  );
}

/**
 * The start of the issue the workspace came from, as a setup step: it never fails, it
 * says how to retry.
 * @param options - The options.
 * @param root - The worktree.
 * @param out - Where to write.
 */
async function linkedIssue(options: AdapterOptions, root: string, out: Output): Promise<void> {
  const paseo = (process.env.PASEO_WORKTREE_PATH ?? "") !== "";
  let repo: string;
  try {
    repo = options.repo();
  } catch (error) {
    warn(out, `could not start the workspace's issue: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const number = paseo ? issueOfBranch(currentBranch(root) ?? "") : orcaIssue(root, repo, out);
  if (number === null || number === undefined) return;
  const retry = `to retry, run 'issue-flow adapter issue https://github.com/${repo}/issues/${number}' in ${root}`;
  try {
    await adopt(options, number, out);
  } catch (error) {
    warn(out, `issue #${number} was not started (${error instanceof Error ? error.message : String(error)}); ${retry}.`);
  }
}

/**
 * The worktree the command runs in, or null in the main checkout, where there is nothing
 * to do (Orca never sets up nor archives it).
 * @param options - The options.
 * @param out - Where to write.
 * @returns The worktree's place, or null.
 * @throws StartError outside git.
 */
function linkedPlace(options: AdapterOptions, out: Output): ReturnType<typeof stepPlace> | null {
  const place = stepPlace(options, out);
  return place.root === place.mainRoot ? null : place;
}

/**
 * `adapter setup [--only <step>]`.
 * @param options - The options.
 * @param out - Where to write.
 * @returns Always 0.
 * @throws StartError outside git; UsageError if `--only` names no step.
 * @example await adapterSetup(options, out)
 */
export async function adapterSetup(options: AdapterOptions, out: Output): Promise<number> {
  const names = options.config.worktrees.setup.map((step) => step.name);
  if (options.only !== null && !names.includes(options.only))
    throw new UsageError(`--only expects a setup step of .agents/flow.json (${names.join(", ") || "it has none"}): ${options.only}`);
  const place = linkedPlace(options, out);
  if (place === null) return 0;
  copyWorktreeIncludes(place.mainRoot, place.root, out);
  await runSetup(place, options.only);
  if (options.only === null) await linkedIssue(options, place.root, out);
  return 0;
}

/**
 * `adapter issue [<url>]`.
 * @param options - The options.
 * @param out - Where to write.
 * @returns The code of `issue start` with a URL, 0 without one.
 * @throws StartError outside git or if the URL is not an issue of the repo.
 * @example await adapterIssue({ ...options, url: "https://github.com/acme/widgets/issues/214" }, out)
 */
export async function adapterIssue(options: AdapterOptions, out: Output): Promise<number> {
  const place = linkedPlace(options, out);
  if (options.url === null) {
    if (place !== null) await linkedIssue(options, place.root, out);
    return 0;
  }
  const number = issueOfUrl(options.url, options.repo());
  if (number === null) throw new StartError(`${options.url} is not an issue of ${options.repo()}; nothing done.`);
  if (place === null) throw new StartError("an issue starts in a worktree, not in the main checkout.");
  return adopt(options, number, out);
}

/**
 * `adapter archive`. With git's link broken (the main checkout moved, or its record of the
 * worktree was deleted) it cannot tell a worktree, but it still frees the ports and the
 * Docker of the folder, with the config of the main checkout Orca or Paseo name: without
 * git it cannot be the main checkout, which they never archive.
 * @param options - The options.
 * @param out - Where to write.
 * @returns Always 0.
 * @example await adapterArchive(options, out)
 */
export async function adapterArchive(options: AdapterOptions, out: Output): Promise<number> {
  if (checkoutRoot(options.cwd) !== null) {
    const place = linkedPlace(options, out);
    if (place !== null) await teardownWorktree(place);
    return 0;
  }
  const path = canonicalPath(process.env.ORCA_WORKTREE_PATH || process.env.PASEO_WORKTREE_PATH || options.cwd);
  const main = process.env.ORCA_ROOT_PATH || process.env.PASEO_SOURCE_CHECKOUT_PATH || null;
  let config = DEFAULT_CONFIG;
  try {
    if (main !== null && locateRepo(main) !== null) config = loadConfig(main);
  } catch {
    warn(out, "the main checkout's .agents/flow.json is not valid; cleaning the Docker without its prefixes.");
  }
  releasePortClaims(path, null);
  const docker = dockerCleanup(config.worktrees.dockerProjects, path);
  if (docker.failed.length > 0) warn(out, `could not delete the Docker of ${path}; run 'issue-flow worktree cleanup' later.`);
  return 0;
}
