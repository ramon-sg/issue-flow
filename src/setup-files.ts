/**
 * @file What `apply` and `doctor` share: this package's own versions, the JSON
 * files of the repo they read and write, and its package manager. Every package goes by its
 * scoped name: the unscoped `issue-flow`, `github-rest` and `skills-manager` on npm belong
 * to other people.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isObject } from "./config-base.js";

/** This package's name on npm. */
export const PACKAGE = "@ramon-sg/issue-flow";

/** The GitHub repo of this package, whose tags hold the config's schema of each version. */
export const FLOW_REPO = "ramon-sg/issue-flow";

/** The start of the config's schema URL, at any version. */
export const SCHEMA_PREFIX = `https://raw.githubusercontent.com/${FLOW_REPO}/`;

/**
 * The URL of the config's schema at a version.
 * @param version - This package's version.
 * @returns The URL.
 * @example schemaUrl("0.1.0") // "https://raw.githubusercontent.com/ramon-sg/issue-flow/v0.1.0/schema.json"
 */
export function schemaUrl(version: string): string {
  return `${SCHEMA_PREFIX}v${version}/schema.json`;
}

/**
 * Whether a config's `$schema` is the flow's at another version (one that is not the
 * flow's is the repo's choice and never stale).
 * @param schema - The config's `$schema`.
 * @param version - This package's version.
 * @returns True if `apply` would move it.
 */
export function isStaleSchema(schema: unknown, version: string): boolean {
  return typeof schema === "string" && schema.startsWith(SCHEMA_PREFIX) && schema !== schemaUrl(version);
}

/** Claude Code's settings of the repo. */
export const SETTINGS_FILE = ".claude/settings.json";

/** Error of `apply` or `doctor`: exits 1 with the message. */
export class SetupError extends Error {}

/** The versions this package pins in the repo. */
export interface OwnVersions {
  issueFlow: string;
  /** The lowest `github-rest` the flow works with: the floor of its own dependency. */
  githubRest: string;
}

/**
 * This package's version and the lowest `github-rest` it works with, from its own
 * `package.json` (`"^0.3.0"` gives 0.3.0).
 * @returns The versions.
 * @throws SetupError if the package.json does not have them.
 * @example ownVersions().issueFlow // "0.1.0"
 */
export function ownVersions(): OwnVersions {
  const file = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8")) as { version?: string; dependencies?: Record<string, string> };
  const githubRest = pkg.dependencies?.["@ramon-sg/github-rest"]?.replace(/^[\^~]/, "");
  if (pkg.version === undefined || githubRest === undefined)
    throw new SetupError(`${file} lacks the version of issue-flow or github-rest.`);
  return { issueFlow: pkg.version, githubRest };
}

/**
 * Reads a JSON object of the repo.
 * @param root - The repo.
 * @param path - The file, relative to the repo.
 * @returns The object, or null if the file does not exist.
 * @throws SetupError if it is not valid JSON or not an object: it is never overwritten then.
 * @example readJson(root, ".claude/settings.json")
 */
export function readJson(root: string, path: string): Record<string, unknown> | null {
  const file = join(root, path);
  if (!existsSync(file)) return null;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new SetupError(`${path} is not valid JSON (${error instanceof Error ? error.message : String(error)}); fix it and run again.`);
  }
  if (!isObject(value)) throw new SetupError(`${path} is not a JSON object; fix it and run again.`);
  return value;
}

/**
 * Writes a JSON file of the repo, indented by two spaces, creating its folder.
 * @param root - The repo.
 * @param path - The file, relative to the repo.
 * @param value - What to write.
 * @example writeJson(root, ".agents/flow.json", { baseBranch: "main" })
 */
export function writeJson(root: string, path: string, value: unknown): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** The lockfile of each package manager, in the order they are looked for. */
const LOCKFILES: [string, string][] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

/**
 * The repo's package manager: the `packageManager` field, then its lockfile, then npm.
 * @param root - The repo.
 * @param pkg - Its package.json, or null.
 * @returns `npm`, `pnpm`, `bun` or `yarn`.
 * @example packageManager(root, { packageManager: "pnpm@9.0.0" }) // "pnpm"
 */
export function packageManager(root: string, pkg: Record<string, unknown> | null): string {
  const field = typeof pkg?.packageManager === "string" ? pkg.packageManager.split("@")[0] : undefined;
  if (field !== undefined && field !== "") return field;
  return LOCKFILES.find(([file]) => existsSync(join(root, file)))?.[1] ?? "npm";
}
