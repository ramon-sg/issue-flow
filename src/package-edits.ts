/**
 * @file What the flow knows about the repo's `package.json`: the names of its shortcuts
 * (and the ones older versions wrote), where a dependency of the repo is and how to compare
 * versions. The tools themselves are pinned in `.agents/runner.json` (see `runner-file.ts`),
 * and a script the repo already has with another value stays as it is.
 */

/** A version: X.Y.Z, with an optional pre-release and build. */
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** A range this file understands: a sign (`^`, `~`, `>=`, `=`) before a version. */
const SIMPLE_RANGE = /^(\^|~|>=|=)\s*(\S+)$/;

/** A parsed version. */
interface Version {
  parts: [number, number, number];
  pre: string | null;
}

/**
 * Parses a version.
 * @param text - The version, without a range sign.
 * @returns It, or null if it is not one.
 */
function parse(text: string): Version | null {
  const match = VERSION.exec(text);
  if (match === null) return null;
  return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? null };
}

/**
 * Compares two versions, semver-style: by the numbers, then a pre-release before its release.
 * @param left - One.
 * @param right - The other.
 * @returns Negative if left is older, 0 if equal, positive if newer.
 */
function compare(left: Version, right: Version): number {
  for (let index = 0; index < 3; index += 1) {
    const diff = left.parts[index] - right.parts[index];
    if (diff !== 0) return diff;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  return left.pre.localeCompare(right.pre, "en", { numeric: true });
}

/**
 * Whether a version is newer than another; false if either is not a version. A leading
 * range sign is dropped, so `^0.3.0` reads as 0.3.0.
 * @param version - The version, maybe with a range sign.
 * @param than - The other.
 * @returns True if it is newer.
 * @example isNewer("1.10.0", "1.9.0") // true
 */
export function isNewer(version: string, than: string): boolean {
  const [left, right] = [parse(version.replace(/^[\^~=]/, "")), parse(than.replace(/^[\^~=]/, ""))];
  return left !== null && right !== null && compare(left, right) > 0;
}

/**
 * The first version a simple range leaves out, or null if it has no ceiling (`>=`).
 * @param sign - `^`, `~` or `>=`.
 * @param floor - Its version.
 * @returns The ceiling.
 */
function ceiling(sign: string, floor: Version): Version | null {
  const [major, minor, patch] = floor.parts;
  if (sign === ">=") return null;
  if (sign === "~") return { parts: [major, minor + 1, 0], pre: null };
  if (major > 0) return { parts: [major + 1, 0, 0], pre: null };
  return minor > 0 ? { parts: [0, minor + 1, 0], pre: null } : { parts: [0, 0, patch + 1], pre: null };
}

/**
 * Whether the repo's version of a package reaches the one the flow needs, so `apply` and
 * `doctor` accept it: an exact version as new or newer, a range that allows it or newer
 * (`^1.2.0` for 1.3.0, not `^0.1.0` for 0.3.0), or a source it cannot read (`workspace:*`,
 * `github:…`, `latest`), which the repo chose on purpose.
 * @param current - The repo's version or range.
 * @param tested - The version the flow needs.
 * @returns True if it reaches it.
 * @example reaches("1.3.0", "1.2.0") // true
 */
export function reaches(current: string, tested: string): boolean {
  const wanted = parse(tested);
  if (wanted === null) return true;
  const exact = parse(current);
  if (exact !== null) return compare(exact, wanted) >= 0;
  const range = SIMPLE_RANGE.exec(current.trim());
  const floor = range === null ? null : parse(range[2]);
  if (range === null || floor === null) return true;
  if (range[1] === "=") return compare(floor, wanted) >= 0;
  const top = ceiling(range[1], floor);
  return top === null || compare(wanted, top) < 0;
}

/** The package the skills call, which the repo gets if it lacks it. */
export const GITHUB_REST = "@ramon-sg/github-rest";

/** The script that starts an issue, and its shortcut with `--free`. */
export const START_SCRIPT = "issue:start";
export const FREE_SCRIPT = "issue:start:free";

/** The scripts older versions added (the `issue-flow` binary of the repo's own dependency). */
export const LEGACY_SCRIPTS: Record<string, string> = {
  "issue:start": "issue-flow issue start",
  "issue:start:free": "issue-flow issue start --free",
  "worktree:prune": "issue-flow worktree prune",
  "pr:worktree": "issue-flow pr worktree",
};

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
 * @example dependencyVersion(pkg, "@ramon-sg/github-rest") // "0.3.0"
 */
export function dependencyVersion(pkg: Record<string, unknown> | null, name: string): string | null {
  return dependencyOf(pkg, name)?.version ?? null;
}
