// Tests of the published package: what `npm pack` puts in it, and that the packed CLI finds
// its own versions and recipes outside this repo, as it does after `npm install` (its
// dependencies are this repo's).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the package has the CLI, the schema and the recipes, and no tests nor skills", () => {
  const [pack] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ROOT, encoding: "utf8" }));
  const files = pack.files.map((file) => file.path);

  for (const file of ["dist/cli.js", "schema.json", "recipes/pnpm.json", "recipes/docker-compose.json", "package.json", "README.md", "LICENSE"])
    assert.ok(files.includes(file), `${file} is not in the package`);
  assert.deepEqual(files.filter((file) => file.startsWith("test/") || file.startsWith("skills/") || file.startsWith("src/")), []);
});

test("the packed CLI runs init outside this repo, with its own version and recipes", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "issue-flow-pack-")));
  after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", dir], { cwd: ROOT, stdio: "ignore" });
  const tarball = join(dir, readdirSync(dir).find((file) => file.endsWith(".tgz")));
  const unpacked = join(dir, "unpacked");
  mkdirSync(unpacked);
  execFileSync("tar", ["-xzf", tarball, "-C", unpacked]);
  symlinkSync(join(ROOT, "node_modules"), join(unpacked, "package", "node_modules"));
  const repo = join(dir, "repo");
  mkdirSync(repo);
  execFileSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(join(repo, "pnpm-lock.yaml"), "");

  const r = spawnSync(process.execPath, [join(unpacked, "package", "dist", "cli.js"), "init", "--yes", "--no-cloud", "--no-guard", "--no-skills"], { cwd: repo, encoding: "utf8" });

  assert.equal(r.status, 0, r.stderr);
  const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  assert.equal(JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).devDependencies["@ramon-sg/issue-flow"], version);
  assert.equal(JSON.parse(readFileSync(join(repo, ".agents", "flow.json"), "utf8")).worktrees.setup[0].run, "pnpm install --frozen-lockfile");
});

