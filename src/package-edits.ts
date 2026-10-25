/**
 * @file The repo's `package.json` as the flow needs it: `issue-flow`, `github-rest` and
 * `skills-manager` as exact dev dependencies (the skills call them with `npx`, which then
 * uses the repo's copy), and the scripts to start an issue, prune worktrees and review a PR.
 * A dependency or script the repo already has with another value stays as it is.
 */
import type { OwnVersions } from "./setup-files.js";

/** The scripts `init` adds. */
const FLOW_SCRIPTS: Record<string, string> = {
  "issue:start": "issue-flow issue start",
  "worktree:prune": "issue-flow worktree prune",
  "pr:worktree": "issue-flow pr worktree",
};

/**
 * The dependencies the flow pins, with their versions.
 * @param versions - This package's versions.
 * @returns Package to version.
 * @example pinnedPackages(versions)["@ramon-sg/issue-flow"] // "0.1.0"
 */
export function pinnedPackages(versions: OwnVersions): Record<string, string> {
  return {
    "@ramon-sg/issue-flow": versions.issueFlow,
    "@ramon-sg/github-rest": versions.githubRest,
    "@ramon-sg/skills-manager": versions.skillsManager,
  };
}

/**
 * Where a package is in the repo's package.json, and its version.
 * @param pkg - The package.json.
 * @param name - The package.
 * @returns The field and the version range, or null if it is in neither.
 */
function dependencyOf(pkg: Record<string, unknown> | null, name: string): { field: string; version: string } | null {
  for (const field of ["dependencies", "devDependencies"]) {
    const deps = pkg?.[field];
    const version = typeof deps === "object" && deps !== null ? (deps as Record<string, unknown>)[name] : undefined;
    if (typeof version === "string") return { field, version };
  }
  return null;
}

/**
 * The version of a package in the repo, as a dependency or a dev dependency.
 * @param pkg - The package.json.
 * @param name - The package.
 * @returns Its version range, or null.
 * @example dependencyVersion(pkg, "@ramon-sg/github-rest") // "0.2.1"
 */
export function dependencyVersion(pkg: Record<string, unknown> | null, name: string): string | null {
  return dependencyOf(pkg, name)?.version ?? null;
}

/**
 * Adds the flow's dev dependencies and scripts that are missing. With `move`, also moves the
 * ones already there to these versions (what `upgrade` does).
 * @param pkg - The package.json, or null if there is none.
 * @param versions - The versions to pin.
 * @param move - Whether to move the dependencies already there.
 * @returns The new package.json and what changed or was kept.
 * @example withFlowPackages(null, versions, false).changes // ["devDependencies: @ramon-sg/issue-flow 0.1.0", …]
 */
export function withFlowPackages(pkg: Record<string, unknown> | null, versions: OwnVersions, move: boolean): { pkg: Record<string, unknown>; changes: string[] } {
  const next: Record<string, unknown> = pkg === null ? { private: true } : { ...pkg };
  const scripts = { ...((next.scripts as Record<string, string> | undefined) ?? {}) };
  const changes: string[] = [];
  for (const [name, version] of Object.entries(pinnedPackages(versions))) {
    const current = dependencyOf(next, name);
    if (current?.version === version) continue;
    if (current !== null && !move) {
      changes.push(`kept ${name} ${current.version} (issue-flow ${versions.issueFlow} was tested with ${version})`);
      continue;
    }
    const field = current?.field ?? "devDependencies";
    next[field] = { ...((next[field] as Record<string, string> | undefined) ?? {}), [name]: version };
    changes.push(`${field}: ${name} ${current === null ? "" : `${current.version} → `}${version}`);
  }
  for (const [name, command] of Object.entries(FLOW_SCRIPTS)) {
    if (scripts[name] !== undefined) continue;
    scripts[name] = command;
    changes.push(`scripts: ${name}`);
  }
  next.scripts = scripts;
  return { pkg: next, changes };
}
