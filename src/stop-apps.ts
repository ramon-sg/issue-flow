/**
 * @file Stops the apps of a worktree before it goes: the processes that listen on a port of
 * its block and run inside its folder. A dev server (turbo, `bun run dev`) starts each app
 * in its own process group, which would outlive the worktree's terminals with the ports
 * taken; the group gets TERM and, if the app is still there after some seconds, KILL. The
 * group is signalled only if its leader also runs in the worktree: an app started without
 * its own group shares that of whoever launched it (a terminal, Claude, Orca), and then
 * only the app gets the signal. A process outside the worktree is never touched, even on
 * one of its ports, and neither is the group `issue-flow` runs in. Needs `lsof`; without it nothing is stopped. Ported from
 * `stop_apps` in Abastio's `scripts/orca-hooks.sh`.
 */
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { inPath } from "./launch.js";
import { type Output, warn } from "./output.js";
import type { PortsConfig } from "./worktree-config.js";

/** Seconds the apps get to end on their own before they are killed. */
const GRACE_SECONDS = 5;

/**
 * Runs a command and gives its output, or null if it failed.
 * @param command - The program.
 * @param args - Its arguments.
 * @returns The output.
 */
function output(command: string, args: string[]): string | null {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? result.stdout : null;
}

/**
 * The processes that listen on a TCP port of a range, with one `lsof`.
 * @param first - The first port.
 * @param last - The last port.
 * @returns Their pids.
 */
function listeners(first: number, last: number): number[] {
  const text = output("lsof", ["-nP", `-iTCP:${first}-${last}`, "-sTCP:LISTEN", "-t"]) ?? "";
  return text.split("\n").filter((line) => /^\d+$/.test(line)).map(Number);
}

/**
 * The folder a process runs in, with its symlinks resolved.
 * @param pid - The process.
 * @returns The folder, or null if it cannot be read.
 */
function processDir(pid: number): string | null {
  const line = (output("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]) ?? "").split("\n").find((item) => item.startsWith("n/"));
  if (line === undefined) return null;
  try {
    return realpathSync(line.slice(1));
  } catch {
    return line.slice(1);
  }
}

/**
 * The process group of a process.
 * @param pid - The process.
 * @returns The group, or null if the process is gone.
 */
function processGroup(pid: number): number | null {
  const text = (output("ps", ["-o", "pgid=", "-p", String(pid)]) ?? "").trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

/**
 * The processes of the worktree that listen on a port of its block.
 * @param ports - The range of ports.
 * @param base - The block's first port.
 * @param root - The worktree, with its symlinks resolved.
 * @returns Their pids.
 */
function appPids(ports: PortsConfig, base: number, root: string): number[] {
  return [...new Set(listeners(base, base + ports.blockSize - 1))].filter((pid) => inside(pid, root));
}

/**
 * Whether a process runs in the worktree.
 * @param pid - The process.
 * @param root - The worktree, with its symlinks resolved.
 * @returns True if its folder is the worktree or inside it.
 */
function inside(pid: number, root: string): boolean {
  const dir = processDir(pid);
  return dir !== null && (dir === root || dir.startsWith(`${root}/`));
}

/**
 * Sends a signal to each target: a negative number is a process group.
 * @param targets - The groups and processes.
 * @param signal - The signal.
 */
function signal(targets: number[], signal: NodeJS.Signals): void {
  for (const target of targets)
    try {
      process.kill(target, signal);
    } catch {
      continue;
    }
}

/**
 * Stops the apps of a worktree: TERM to each one that listens on a port of its block (to its
 * process group, if the group's leader runs in the worktree too), and KILL to those still
 * there after `GRACE_SECONDS`.
 * @param ports - The range of ports.
 * @param base - The block's first port.
 * @param root - The worktree, with its symlinks resolved.
 * @param out - Where to say it.
 * @returns How many processes listened.
 * @example await stopApps(ports, 21430, "/repo/.claude/worktrees/feat+42-x", out)
 */
export async function stopApps(ports: PortsConfig, base: number, root: string, out: Output): Promise<number> {
  if (!inPath("lsof")) return 0;
  const pids = appPids(ports, base, root);
  if (pids.length === 0) return 0;
  const own = processGroup(process.pid);
  const targets = [...new Set(pids.map((pid) => {
    const group = processGroup(pid);
    return group === null || group === own || !inside(group, root) ? pid : -group;
  }))];
  warn(out, `stopping the apps that run in ${root}.`);
  signal(targets, "SIGTERM");
  for (let waited = 0; waited < GRACE_SECONDS && appPids(ports, base, root).length > 0; waited += 1) await sleep(1000);
  if (appPids(ports, base, root).length > 0) signal(targets, "SIGKILL");
  return pids.length;
}
