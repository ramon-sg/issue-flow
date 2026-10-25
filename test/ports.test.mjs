// Tests of the ports and Docker names of worktrees. The expected values come from running
// Abastio's scripts/lib/worktree.sh, so its existing worktrees keep their names and blocks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerProject, sanitizeLabel } from "../dist/docker.js";
import { claimPortBase, defaultPortBase, machineName, isPortBase, nextPortBase, PORT_BASE_FILE, releasePortClaims } from "../dist/ports.js";
import { DEFAULT_PORTS } from "../dist/worktree-config.js";

const WT = "/repo/.claude/worktrees/feat+214-odoo-refund-notice";

// The block a worktree starts from on this machine, in the small range.
const defaultPortBaseOf = (root) => defaultPortBase(SMALL, machineName(), root, process.platform);

test("sanitizeLabel and dockerProject give Abastio's names", () => {
  assert.equal(sanitizeLabel("feat+214_Odoo--Refund-"), "feat-214-odoo-refund");
  assert.equal(sanitizeLabel(`${"a".repeat(70)}-tail`), `${"a".repeat(56)}-d94dc4`);
  assert.equal(dockerProject("abastio-dev", WT), "abastio-dev-feat-214-odoo-refund-notice-7b615d");
});

test("defaultPortBase: Abastio's block, in the first half on macOS and the second elsewhere", () => {
  assert.equal(defaultPortBase(DEFAULT_PORTS, "mbp", WT, "darwin"), 23480);
  assert.equal(defaultPortBase(DEFAULT_PORTS, "srv", WT, "linux"), 26470);
});

test("nextPortBase wraps inside its half; isPortBase takes only first ports of the range", () => {
  assert.equal(nextPortBase(DEFAULT_PORTS, 24990), 20000);
  assert.equal(nextPortBase(DEFAULT_PORTS, 29990), 25000);
  assert.equal(nextPortBase(DEFAULT_PORTS, 20000), 20010);
  assert.equal(isPortBase(DEFAULT_PORTS, 20010), true);
  assert.equal(isPortBase(DEFAULT_PORTS, 20011), false);
  assert.equal(isPortBase(DEFAULT_PORTS, 19990), false);
  assert.equal(isPortBase(DEFAULT_PORTS, 30000), false);
});

// Two worktrees of one repo and a state folder for the machine's claims.
function repos() {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "ports-")));
  const main = join(tmp, "main");
  const run = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  run(tmp, "init", "-q", "-b", "main", main);
  run(main, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
  const one = join(tmp, "one");
  const two = join(tmp, "two");
  run(main, "worktree", "add", "-q", one, "-b", "one");
  run(main, "worktree", "add", "-q", two, "-b", "two");
  process.env.ISSUE_FLOW_STATE_DIR = join(tmp, "state");
  const saved = (dir) => readFileSync(join(main, ".git", "worktrees", dir, PORT_BASE_FILE), "utf8").trim();
  return { tmp, main, one, two, saved };
}

// A small range, so the tests can fill it.
const SMALL = { start: 41000, blockSize: 2, blocks: 4 };

test("claimPortBase saves the block and keeps it; a block another worktree took is skipped", async () => {
  const r = repos();

  const first = await claimPortBase(SMALL, r.one, 41000);
  const again = await claimPortBase(SMALL, r.one, null);
  const other = await claimPortBase(SMALL, r.two, 41000);

  assert.equal(first, 41000);
  assert.equal(r.saved("one"), "41000");
  assert.equal(again, 41000);
  assert.equal(other, 41002);
  assert.equal(readFileSync(join(r.tmp, "state", "ports", "41002", "path"), "utf8").trim(), r.two);
});

test("claimPortBase skips a block where something listens, and wraps in its half", async () => {
  const r = repos();
  const server = createServer().listen(41001, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  const base = await claimPortBase(SMALL, r.one, 41000);
  server.close();

  assert.equal(base, 41002);
});

test("a claim of a worktree that is gone is taken over; the half full gives null", async () => {
  const r = repos();
  const ghost = join(r.tmp, "ghost");
  mkdirSync(join(r.tmp, "state", "ports", "41000"), { recursive: true });
  writeFileSync(join(r.tmp, "state", "ports", "41000", "path"), `${ghost}\n`);
  mkdirSync(join(r.tmp, "state", "ports", "41002"));
  writeFileSync(join(r.tmp, "state", "ports", "41002", "path"), `${r.two}\n`);

  const taken = await claimPortBase(SMALL, r.one, 41000);
  const full = await claimPortBase(SMALL, r.main, 41000);

  assert.equal(taken, 41000);
  assert.equal(full, null);
});

test("moving to another block drops the old claim, and releasing drops them all", async () => {
  const r = repos();
  await claimPortBase(SMALL, r.one, 41000);

  const moved = await claimPortBase(SMALL, r.one, 41002);
  const oldClaim = existsSync(join(r.tmp, "state", "ports", "41000"));
  releasePortClaims(r.one, null);

  assert.equal(moved, 41002);
  assert.equal(oldClaim, false);
  assert.equal(existsSync(join(r.tmp, "state", "ports", "41002")), false);
});

test("a saved block that is not valid for the range is chosen again", async () => {
  const r = repos();
  await claimPortBase(SMALL, r.one, 41002);
  writeFileSync(join(r.main, ".git", "worktrees", "one", PORT_BASE_FILE), "41001\n");

  const fixed = await claimPortBase(SMALL, r.one, null);

  assert.equal(fixed, defaultPortBaseOf(r.one));
});

test("the worktree's own claim is not someone else's, even without its saved file", async () => {
  const r = repos();
  await claimPortBase(SMALL, r.one, 41002);
  rmSync(join(r.main, ".git", "worktrees", "one", PORT_BASE_FILE));

  const own = await claimPortBase(SMALL, r.one, 41002);

  assert.equal(own, 41002);
});
