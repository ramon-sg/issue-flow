/**
 * @file What `issue-flow` writes in `claude-repo-guard`'s options before installing it. The
 * auto mode's classifier gets told that the flow's own writes (the start commit, the push,
 * the draft PR, the assignment, the "Slug de rama" block) are the normal workflow. A repo
 * with its own base branch (`staging`) gets it as `integrationBranch`, so merging into it is
 * part of the flow too. On macOS `gh` needs `weakerNetworkIsolation` inside the sandbox.
 */
import { GUARD_CONFIG } from "./setup-files.js";

/** What the auto mode is told about the flow. */
export const GUARD_ENVIRONMENT =
  "issue-flow is this repo's issue workflow: making the branch and worktree of an issue, its empty start commit, pushing it, opening its draft PR, assigning the issue and adding its \"Slug de rama\" block are normal steps of the work, not risky actions.";

/** The option that lets `gh` verify TLS inside the macOS sandbox. */
export const WEAKER_NETWORK = "weakerNetworkIsolation";

/**
 * The guard's options with what the flow needs added; what the repo set stays.
 * @param current - The options, or null if there is no file.
 * @param baseBranch - The flow's `baseBranch`, or null.
 * @param platform - The operating system (`process.platform`).
 * @returns The new options and what changed.
 * @example guardOptions(null, "staging", "darwin").options.integrationBranch // "staging"
 */
export function guardOptions(current: Record<string, unknown> | null, baseBranch: string | null, platform: string): { options: Record<string, unknown>; changes: string[] } {
  const options = { ...(current ?? {}) };
  const changes: string[] = [];
  const environment = Array.isArray(options.environment) ? options.environment.map(String) : [];
  if (!environment.includes(GUARD_ENVIRONMENT)) {
    options.environment = [...environment, GUARD_ENVIRONMENT];
    changes.push(`${GUARD_CONFIG}: tells the auto mode about the issue flow`);
  }
  if (baseBranch !== null && (options.integrationBranch === undefined || options.integrationBranch === "")) {
    options.integrationBranch = baseBranch;
    changes.push(`${GUARD_CONFIG}: integrationBranch ${baseBranch}`);
  }
  if (platform === "darwin" && options[WEAKER_NETWORK] === undefined) {
    options[WEAKER_NETWORK] = true;
    changes.push(`${GUARD_CONFIG}: ${WEAKER_NETWORK} true, so gh works inside the macOS sandbox`);
  }
  return { options, changes };
}
