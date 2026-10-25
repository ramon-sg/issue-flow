/**
 * @file What `init`, `doctor` and `upgrade` share: this package's own versions, the JSON
 * files of the repo they read and write, its package manager, and running another tool
 * with `npx`. Every package goes by its scoped name: the unscoped `issue-flow`,
 * `github-rest` and `skills-manager` on npm belong to other people.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isObject } from "./config-base.js";

/** This package's name on npm. */
export const PACKAGE = "@ramon-sg/issue-flow";

/** The GitHub repo of this package, which is also the catalog of the flow skills. */
export const FLOW_CATALOG = "ramon-sg/issue-flow";

/** The catalog of the general skills. */
export const GENERAL_CATALOG = "ramon-sg/agent-skills";

/** Where `skills-manager` keeps the repo's skills manifest. */
export const SKILLS_MANIFEST = ".agents/skills.json";

/** Where `skills-manager` keeps the repo's skills lock. */
export const SKILLS_LOCK = ".agents/skills.lock.json";

/** Claude Code's settings of the repo. */
export const SETTINGS_FILE = ".claude/settings.json";

/** The options of `claude-repo-guard` in the repo. */
export const GUARD_CONFIG = ".claude/repo-guard.config.json";

/** How `claude-repo-guard` runs: it is not on npm. */
export const GUARD_SPEC = "github:ramon-sg/claude-repo-guard";

/** How `claude-cloud` runs. */
export const CLOUD_SPEC = "@ramon-sg/claude-cloud@1";

/** Error of `init`, `doctor` or `upgrade`: exits 1 with the message. */
export class SetupError extends Error {}

/** The versions this package pins in the repo. */
export interface OwnVersions {
  issueFlow: string;
  githubRest: string;
  skillsManager: string;
}

/**
 * This package's version and the exact versions of `github-rest` and `skills-manager` it
 * was built and tested with, from its own `package.json`.
 * @returns The versions.
 * @throws SetupError if the package.json does not have them.
 * @example ownVersions().issueFlow // "0.1.0"
 */
export function ownVersions(): OwnVersions {
  const file = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8")) as { version?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const githubRest = pkg.dependencies?.["@ramon-sg/github-rest"];
  const skillsManager = pkg.devDependencies?.["@ramon-sg/skills-manager"];
  if (pkg.version === undefined || githubRest === undefined || skillsManager === undefined)
    throw new SetupError(`${file} lacks the version of issue-flow, github-rest or skills-manager.`);
  return { issueFlow: pkg.version, githubRest, skillsManager };
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

/**
 * Runs `npx <args>` in the repo, its output on this terminal.
 * @param root - The repo.
 * @param args - The package and its arguments.
 * @returns Whether it exited 0.
 * @example runNpx(root, ["@ramon-sg/claude-cloud@1", "init"])
 */
export function runNpx(root: string, args: string[]): boolean {
  const result = spawnSync("npx", ["--yes", ...args], { cwd: root, stdio: "inherit" });
  return result.status === 0;
}

/**
 * Runs `npx <args>` in the repo and returns what it printed.
 * @param root - The repo.
 * @param args - The package and its arguments.
 * @returns Its stdout and exit code, or null if npx could not start.
 * @example captureNpx(root, ["github:ramon-sg/claude-repo-guard", "doctor", "--json"])
 */
export function captureNpx(root: string, args: string[]): { out: string; status: number | null } | null {
  const result = spawnSync("npx", ["--yes", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  return result.error === undefined ? { out: result.stdout, status: result.status } : null;
}

/**
 * The flow's skills in the repo's skills lock, with the tag each one is at.
 * @param lock - The lock, or null.
 * @returns Name and tag of each skill of the flow's catalog.
 * @example flowSkills(lock) // [{ name: "close-pr", tag: "v0.1.0" }]
 */
export function flowSkills(lock: Record<string, unknown> | null): { name: string; tag: string | null }[] {
  const skills = isObject(lock?.skills) ? lock.skills : {};
  return Object.entries(skills)
    .filter(([, entry]) => isObject(entry) && entry.source === `catalog:${FLOW_CATALOG}`)
    .map(([name, entry]) => ({ name, tag: isObject(entry) && typeof entry.tag === "string" ? entry.tag : null }));
}
