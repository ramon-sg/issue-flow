/**
 * @file The block of ports of each worktree, so two worktrees never take the same ports.
 * A block starts from a hash of the machine and the folder (stable: the same worktree
 * always gets the same block), moves on if something listens in it or another worktree of
 * the machine registered it, and once chosen is saved in the worktree's git dir. macOS uses
 * the first half of the range and the rest the second, so a laptop worktree and a server's
 * never share a block when Orca forwards the server's ports with the same numbers. Ported
 * from `wt_claim_port_base` and its helpers in Abastio's `scripts/lib/worktree.sh`.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { homedir, hostname, platform } from "node:os";
import { join } from "node:path";
import { checkoutRoot, git } from "./git.js";
import type { PortsConfig } from "./worktree-config.js";

/** File, in the worktree's own git dir, with the first port of its block. */
export const PORT_BASE_FILE = "issue-flow-port-base";

/** Hex digits of the hash that pick the block: seven fit in a safe integer. */
const HASH_DIGITS = 7;

/** How long a port gets to answer before it counts as free. */
const CONNECT_TIMEOUT_MS = 300;

/**
 * The sha256 of a text, in hex.
 * @param value - The text.
 * @returns The hash.
 * @example sha256("a").slice(0, 6) // "ca9781"
 */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Where `issue-flow` keeps what belongs to the whole machine (which worktree took each
 * block): `ISSUE_FLOW_STATE_DIR`, or `~/.issue-flow`.
 * @returns The folder.
 * @example stateDir() // "/Users/me/.issue-flow"
 */
export function stateDir(): string {
  return process.env.ISSUE_FLOW_STATE_DIR ?? join(homedir(), ".issue-flow");
}

/**
 * A stable name of the machine, without its domain. On macOS the local host name, not
 * `hostname()`: that one changes with the network, and every block would move.
 * @returns The name.
 * @example machineName() // "ramon-mbp"
 */
export function machineName(): string {
  const local = platform() === "darwin" ? spawnSync("scutil", ["--get", "LocalHostName"], { encoding: "utf8" }) : null;
  const name = local?.status === 0 && local.stdout.trim() !== "" ? local.stdout.trim() : hostname();
  return name.split(".")[0] ?? name;
}

/**
 * The first block of the half of the range that belongs to a system.
 * @param ports - The range.
 * @param system - The system, as `os.platform()` names it.
 * @returns The block's index.
 */
function firstBlock(ports: PortsConfig, system: string): number {
  return system === "darwin" ? 0 : ports.blocks / 2;
}

/**
 * The first port of the block a folder starts from on a machine. It is only the start:
 * `claimPortBase` moves on if it is taken.
 * @param ports - The range.
 * @param machine - The machine's name.
 * @param root - The worktree.
 * @param system - The system (`os.platform()`).
 * @returns The port.
 * @example defaultPortBase(DEFAULT_PORTS, "mbp", "/repo/.claude/worktrees/feat+42-x", "darwin") // 20000 to 24990
 */
export function defaultPortBase(ports: PortsConfig, machine: string, root: string, system: string): number {
  const hash = Number.parseInt(sha256(`${machine}:${root}`).slice(0, HASH_DIGITS), 16);
  const half = ports.blocks / 2;
  return ports.start + (firstBlock(ports, system) + (hash % half)) * ports.blockSize;
}

/**
 * The block after one, without leaving its half: after the half's last it goes back to
 * the half's first.
 * @param ports - The range.
 * @param base - The first port of a block.
 * @returns The next block's first port.
 * @example nextPortBase(DEFAULT_PORTS, 24990) // 20000
 */
export function nextPortBase(ports: PortsConfig, base: number): number {
  const half = ports.blocks / 2;
  const block = (base - ports.start) / ports.blockSize;
  const first = Math.floor(block / half) * half;
  const next = block + 1 < first + half ? block + 1 : first;
  return ports.start + next * ports.blockSize;
}

/**
 * Whether a value is the first port of a block of the range.
 * @param ports - The range.
 * @param value - The value.
 * @returns True if it is.
 * @example isPortBase(DEFAULT_PORTS, 20010) // true
 */
export function isPortBase(ports: PortsConfig, value: number): boolean {
  const end = ports.start + ports.blocks * ports.blockSize;
  return Number.isInteger(value) && value >= ports.start && value < end && (value - ports.start) % ports.blockSize === 0;
}

/**
 * The file with a worktree's block.
 * @param root - The worktree.
 * @returns The path, or null outside git.
 */
function baseFile(root: string): string | null {
  const dir = git(root, ["rev-parse", "--path-format=absolute", "--git-dir"]);
  return dir.ok ? join(dir.out, PORT_BASE_FILE) : null;
}

/**
 * The block saved for a worktree, if it is valid for the range.
 * @param ports - The range.
 * @param root - The worktree.
 * @returns The first port, or null.
 */
function savedBase(ports: PortsConfig, root: string): number | null {
  const file = baseFile(root);
  if (file === null || !existsSync(file)) return null;
  const value = Number(readFileSync(file, "utf8").trim());
  return isPortBase(ports, value) ? value : null;
}

/**
 * The first port of a worktree's block: the saved one, or the one it starts from. It only
 * reads: `claimPortBase` writes it once, before the apps start.
 * @param ports - The range.
 * @param root - The worktree.
 * @returns The port.
 * @example portBase(DEFAULT_PORTS, wt) // 21430
 */
export function portBase(ports: PortsConfig, root: string): number {
  return savedBase(ports, root) ?? defaultPortBase(ports, machineName(), root, platform());
}

/**
 * Whether a folder is still the root of a checkout, comparing resolved paths. An empty
 * folder left by a deleted worktree inside the main checkout finds the main repo, so being
 * inside git is not enough.
 * @param path - The folder.
 * @returns True if it is a root.
 * @example isCheckoutRoot("/repo/.claude/worktrees/feat+42-x")
 */
export function isCheckoutRoot(path: string): boolean {
  return path !== "" && existsSync(path) && checkoutRoot(path) === realpathSync(path);
}

/**
 * The folder that records which worktree of the machine took a block.
 * @param base - The block's first port.
 * @returns The folder.
 */
function claimDir(base: number): string {
  return join(stateDir(), "ports", String(base));
}

/**
 * The worktree that registered a block, if it still exists and is not this one.
 * @param root - This worktree.
 * @param base - The block.
 * @returns True if another live worktree has it.
 */
function takenByOther(root: string, base: number): boolean {
  const file = join(claimDir(base), "path");
  if (!existsSync(file)) return false;
  const owner = readFileSync(file, "utf8").trim();
  return owner !== "" && owner !== root && isCheckoutRoot(owner);
}

/**
 * Whether something listens on a port, over IPv4 or IPv6.
 * @param port - The port.
 * @returns True if a connection opens.
 */
async function listening(port: number): Promise<boolean> {
  const tryHost = (host: string): Promise<boolean> =>
    new Promise((resolve) => {
      const socket = connect({ host, port });
      const done = (open: boolean): void => {
        socket.destroy();
        resolve(open);
      };
      socket.setTimeout(CONNECT_TIMEOUT_MS, () => done(false));
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
    });
  return (await tryHost("127.0.0.1")) || (await tryHost("::1"));
}

/**
 * Whether something listens on any port of a block.
 * @param ports - The range.
 * @param base - The block.
 * @returns True if one is busy.
 */
async function blockBusy(ports: PortsConfig, base: number): Promise<boolean> {
  const checks = Array.from({ length: ports.blockSize }, (_, offset) => listening(base + offset));
  return (await Promise.all(checks)).some(Boolean);
}

/**
 * Registers a block for the worktree.
 * @param root - The worktree.
 * @param base - The block.
 * @returns False if another live worktree registered it first.
 */
function takeClaim(root: string, base: number): boolean {
  if (takenByOther(root, base)) return false;
  mkdirSync(claimDir(base), { recursive: true });
  writeFileSync(join(claimDir(base), "path"), `${root}\n`);
  return true;
}

/**
 * Deletes the worktree's registrations, but the one of the block it keeps. Run when the
 * worktree moves to another block or goes away.
 * @param root - The worktree.
 * @param keep - The block it keeps, or null for none.
 * @example releasePortClaims(wt, null)
 */
export function releasePortClaims(root: string, keep: number | null): void {
  const dir = join(stateDir(), "ports");
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, "path");
    if (name === String(keep) || !existsSync(file)) continue;
    if (readFileSync(file, "utf8").trim() === root) rmSync(join(dir, name), { recursive: true, force: true });
  }
}

/**
 * Fixes the worktree's block and returns it. A valid saved block stays. Otherwise, or with
 * `start` (to move it), it looks from `start` (or the block it starts from) for the first
 * free one of its half: nobody registered it and nothing listens in it. It registers that
 * block, saves it and drops the ones it had.
 * @param ports - The range.
 * @param root - The worktree.
 * @param start - Where to start looking, or null to keep the saved block.
 * @returns The first port, or null if the whole half is taken.
 * @example await claimPortBase(DEFAULT_PORTS, wt, null) // 21430
 */
export async function claimPortBase(ports: PortsConfig, root: string, start: number | null): Promise<number | null> {
  const saved = savedBase(ports, root);
  if (start === null && saved !== null) {
    takeClaim(root, saved);
    return saved;
  }
  const file = baseFile(root);
  if (file === null) return null;
  let candidate = start ?? defaultPortBase(ports, machineName(), root, platform());
  for (let tries = 0; tries < ports.blocks / 2; tries += 1) {
    if (!takenByOther(root, candidate) && !(await blockBusy(ports, candidate)) && takeClaim(root, candidate)) {
      writeFileSync(file, `${candidate}\n`);
      releasePortClaims(root, candidate);
      return candidate;
    }
    candidate = nextPortBase(ports, candidate);
  }
  return null;
}
