/**
 * @file End to end: a project installs every skill of this catalog with the
 * published `@ramon-sg/skills-manager`, gets its `project.md` files from the
 * templates, passes `check`, and still passes after editing them. The catalog
 * is a temporary git copy of this repo, reached through `file://`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

/** Repo root. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The installed CLI of skills-manager. */
const CLI = join(ROOT, "node_modules", "@ramon-sg", "skills-manager", "src", "cli.mjs");

/** Git configuration to commit without depending on the user's. */
const GIT_IDENTITY = ["-c", "user.name=Test", "-c", "user.email=test@example.com"];

/** Every skill of the catalog. */
const SKILLS = JSON.parse(readFileSync(join(ROOT, "skills-catalog.json"), "utf8")).skills;

/** Temporary folder with the catalog copy and the project. */
let base;

/** Project where the skills are installed. */
let project;

/** URL of the catalog copy. */
let catalog;

/**
 * Runs a command and fails the test if it exits badly.
 *
 * @param command - Executable.
 * @param args - Arguments.
 * @param cwd - Working folder.
 * @returns The combined output.
 */
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: { ...process.env, SKILLS_HOME: join(base, "home") } });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
}

/**
 * Runs skills-manager in the project.
 *
 * @param args - CLI arguments.
 * @returns The combined output.
 */
function skillsManager(args) {
  return run(process.execPath, [CLI, ...args], project);
}

before(() => {
  base = mkdtempSync(join(tmpdir(), "issue-flow-skills-"));
  const copy = join(base, "catalog");
  mkdirSync(copy);
  for (const entry of ["skills", "skills-catalog.json", "LICENSE"]) {
    cpSync(join(ROOT, entry), join(copy, entry), { recursive: true });
  }
  run("git", ["init", "-q"], copy);
  run("git", [...GIT_IDENTITY, "add", "-A"], copy);
  run("git", [...GIT_IDENTITY, "commit", "-q", "-m", "catalog"], copy);
  run("git", ["tag", "v0.0.1"], copy);
  catalog = `file://${copy}`;
  project = join(base, "project");
  mkdirSync(project);
  mkdirSync(join(base, "home"));
  run("git", ["init", "-q"], project);
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

test("init --catalog installs every skill, creates each project.md from its template and check passes", () => {
  const select = SKILLS.map((skill) => `catalog:${catalog}/${skill.name}`).join(",");

  skillsManager(["init", "--catalog", catalog, "--select", select]);
  const check = skillsManager(["check"]);

  for (const skill of SKILLS) {
    assert.ok(existsSync(join(project, ".agents/skills", skill.name, "SKILL.md")), skill.name);
    for (const file of skill.editable ?? []) {
      const template = readFileSync(join(ROOT, skill.path, `${file}.template`), "utf8");
      assert.equal(readFileSync(join(project, ".agents/skills", skill.name, file), "utf8"), template, `${skill.name}/${file}`);
    }
  }
  assert.match(check, /match the lock/);
});

test("editing a project.md keeps check passing", () => {
  writeFileSync(join(project, ".agents/skills/close-pr/project.md"), "# close-pr en este repo\n\nCommit, push y merge corren solos.\n");

  const check = skillsManager(["check"]);

  assert.match(check, /match the lock/);
});
