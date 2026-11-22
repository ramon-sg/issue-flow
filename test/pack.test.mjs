// Tests of the published package: what `npm pack` puts in it, and that the packed CLI finds
// its own versions and recipes outside this repo, as it does after `npm install` (the
// bundle carries everything, so nothing of this repo's node_modules is linked).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the package has the bundle, the schema and the recipes, and no dependencies", () => {
  const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ROOT, encoding: "utf8" }));
  const files = pack.files.map((file) => file.path);

  for (const file of ["bundle/cli.js", "schema.json", "recipes/pnpm.json", "recipes/docker-compose.json", "package.json", "README.md", "LICENSE"])
    assert.ok(files.includes(file), `${file} is not in the package`);
  assert.deepEqual(files.filter((file) => file.startsWith("dist/") || file.startsWith("test/") || file.startsWith("skills/") || file.startsWith("src/")), []);
  assert.equal(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).dependencies, undefined);
});

test("the packed CLI runs init outside this repo, with its own version and recipes", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "issue-flow-pack-")));
  after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", dir], { cwd: ROOT, stdio: "ignore" });
  const tarball = join(dir, readdirSync(dir).find((file) => file.endsWith(".tgz")));
  const unpacked = join(dir, "unpacked");
  mkdirSync(unpacked);
  execFileSync("tar", ["-xzf", tarball, "-C", unpacked]);
  const repo = join(dir, "repo");
  mkdirSync(repo);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(join(repo, "pnpm-lock.yaml"), "");

  const cli = join(unpacked, "package", "bundle", "cli.js");
  const own = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const versions = spawnSync(process.execPath, [cli, "--version", "--json"], { cwd: repo, encoding: "utf8" });
  assert.equal(versions.status, 0, versions.stderr);
  assert.deepEqual(JSON.parse(versions.stdout), { version: own.version, githubRest: "0.6.0", runner: "1.0.1" });
  const plain = spawnSync(process.execPath, [cli, "--version"], { cwd: repo, encoding: "utf8" });
  assert.equal(plain.stdout, `${own.version}\n`);

  // NOTE: a PATH with only a fake bun, so the run neither needs Bun nor runs a tool.
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const fake = join(ROOT, "test", "fake-bun.mjs");
  writeFileSync(join(bin, "bun"), `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`, { mode: 0o755 });
  const r = spawnSync(process.execPath, [cli, "init", "--yes"], { cwd: repo, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });

  assert.equal(r.status, 0, r.stderr);
  const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  assert.equal(JSON.parse(readFileSync(join(repo, ".agents", "runner.json"), "utf8")).tools["@ramon-sg/issue-flow"], version);
  assert.equal(JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).devDependencies, undefined);
  assert.equal(JSON.parse(readFileSync(join(repo, ".agents", "flow.json"), "utf8")).worktrees.setup[0].run, "pnpm install --frozen-lockfile");
});

