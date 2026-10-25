/**
 * @file The Docker of worktrees: the Compose project name of each one, and the cleanup of
 * the containers, volumes and networks of worktrees that no longer exist. There is no
 * registry of its own: each Compose container carries its project and its folder
 * (`com.docker.compose.project.working_dir`), and a project whose folder is no longer the
 * root of a checkout is an orphan. Only projects with a prefix of the config are ever
 * deleted, and never one without a suffix (the main checkout's). Ported from
 * `wt_project_name` in Abastio's `scripts/lib/worktree.sh` and its
 * `scripts/worktree-cleanup.sh`; the names come out the same, so its existing projects
 * are found.
 */
import { spawnSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { checkoutRoot } from "./git.js";
import { sha256 } from "./ports.js";

/** Longest DNS label, as portless cuts them (the names were born with portless). */
const MAX_LABEL = 63;

/** Hex digits of the hashes in names. */
const HASH_LENGTH = 6;

/** How long `docker info` may take: a hung Docker cannot hold a hook up. */
const DOCKER_INFO_TIMEOUT_MS = 20_000;

/** Compose's label with the project. */
const PROJECT_LABEL = "com.docker.compose.project";

/**
 * A DNS label, like portless makes them: lowercase, `[a-z0-9-]`, no repeated dashes nor at
 * the edges, and over 63 characters cut with a hash of 6.
 * @param value - The text.
 * @returns The label.
 * @example sanitizeLabel("feat+214_Odoo") // "feat-214-odoo"
 */
export function sanitizeLabel(value: string): string {
  const clean = value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  if (clean.length <= MAX_LABEL) return clean;
  const trimmed = clean.slice(0, MAX_LABEL - HASH_LENGTH - 1).replace(/-+$/, "");
  return `${trimmed}-${sha256(clean).slice(0, HASH_LENGTH)}`;
}

/**
 * The Compose project of a worktree: the prefix, the folder's name and a hash of its path,
 * so two clones with a worktree of the same name never share containers.
 * @param prefix - The project prefix (`abastio-dev`).
 * @param root - The worktree.
 * @returns The project name.
 * @example dockerProject("acme-dev", "/repo/.claude/worktrees/feat+42-x") // "acme-dev-feat-42-x-1a2b3c"
 */
export function dockerProject(prefix: string, root: string): string {
  return `${prefix}-${sanitizeLabel(basename(root))}-${sha256(root).slice(0, HASH_LENGTH)}`;
}

/**
 * A path to compare with a container's folder: no trailing slash, and its parent resolved
 * (symlinks too) even if the path itself is gone, as a just-deleted worktree is.
 * @param path - The path.
 * @returns The path.
 * @example canonicalPath("/tmp/x/") // "/private/tmp/x"
 */
export function canonicalPath(path: string): string {
  const clean = path.replace(/\/+$/, "") || "/";
  try {
    return join(realpathSync(dirname(clean)), basename(clean));
  } catch {
    return clean;
  }
}

/**
 * Runs docker and returns its output, or null if it failed.
 * @param args - The arguments.
 * @param timeout - Milliseconds before giving up, or undefined.
 * @returns The output, trimmed.
 */
function docker(args: string[], timeout?: number): string | null {
  const result = spawnSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...(timeout === undefined ? {} : { timeout }) });
  return result.status === 0 ? result.stdout.trim() : null;
}

/**
 * Deletes a project's containers, volumes and networks. It tries all three even if one
 * fails (a container Docker cannot kill yet).
 * @param project - The project.
 * @returns Whether it had nothing, was deleted, or something failed.
 */
function removeProject(project: string): "none" | "removed" | "failed" {
  const filter = ["--filter", `label=${PROJECT_LABEL}=${project}`];
  let ok = true;
  let found = false;
  for (const [list, remove] of [
    [["ps", "-aq"], ["rm", "-f"]],
    [["volume", "ls", "-q"], ["volume", "rm"]],
    [["network", "ls", "-q"], ["network", "rm"]],
  ] as const) {
    const ids = docker([...list, ...filter]);
    if (ids === null) ok = false;
    if (ids === null || ids === "") continue;
    found = true;
    if (docker([...remove, ...ids.split("\n")]) === null) ok = false;
  }
  if (!ok) return "failed";
  return found ? "removed" : "none";
}

/**
 * Whether a project's folder still belongs to a checkout. Compose's folder is the compose
 * file's, maybe a subfolder (`infra/`), so being inside a checkout is enough, as long as the
 * folder has something: a deleted worktree inside the main checkout leaves its folder
 * empty, and that one finds the main repo.
 * @param dir - The project's folder.
 * @returns True if it is alive.
 * @example projectAlive("/repo/.claude/worktrees/feat+42-x/infra")
 */
export function projectAlive(dir: string): boolean {
  return dir !== "" && existsSync(dir) && readdirSync(dir).length > 0 && checkoutRoot(dir) !== null;
}

/** What the cleanup did. */
export interface CleanupResult {
  dockerRunning: boolean;
  removed: string[];
  failed: string[];
}

/**
 * Deletes the Docker of worktrees that no longer exist: projects with one of the prefixes
 * and a suffix, whose folder no longer belongs to a checkout. With a path, the
 * projects of that folder, whether it exists or not, including the volumes and networks
 * left without containers (their names come from the path). `docker ps -a`, so a deleted
 * worktree with stopped containers counts too.
 * @param prefixes - The project prefixes of the config.
 * @param path - Only this worktree's, or null for every orphan.
 * @returns What was deleted, what failed, and whether Docker runs at all.
 * @example dockerCleanup(["acme-dev"], null)
 */
export function dockerCleanup(prefixes: string[], path: string | null): CleanupResult {
  const result: CleanupResult = { dockerRunning: false, removed: [], failed: [] };
  if (prefixes.length === 0) return { ...result, dockerRunning: true };
  if (docker(["info"], DOCKER_INFO_TIMEOUT_MS) === null) return result;
  result.dockerRunning = true;
  const forced = path === null ? null : canonicalPath(path);
  const listed = docker(["ps", "-a", "--filter", `label=${PROJECT_LABEL}`, "--format", `{{.Label "${PROJECT_LABEL}"}}\t{{.Label "${PROJECT_LABEL}.working_dir"}}`]) ?? "";
  const projects = new Set<string>();
  for (const line of listed.split("\n")) {
    const [project = "", dir = ""] = line.split("\t");
    if (!prefixes.some((prefix) => project.startsWith(`${prefix}-`))) continue;
    if (forced !== null ? canonicalPath(dir) === forced : !projectAlive(dir)) projects.add(project);
  }
  if (forced !== null) for (const prefix of prefixes) projects.add(dockerProject(prefix, forced));
  for (const project of projects) {
    const outcome = removeProject(project);
    if (outcome !== "none") result[outcome].push(project);
  }
  return result;
}
