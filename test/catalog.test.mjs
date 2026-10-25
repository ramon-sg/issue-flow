/**
 * @file Checks the catalog against the skills on disk: every listed skill
 * exists with a matching `SKILL.md`, its `requires` and editable templates are
 * there, every skill folder is listed, the relative links inside the skills
 * resolve, no project name leaks into a shared skill, and every `issue-flow`
 * command a skill names exists in the CLI.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

/** Repo root. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The catalog under test. */
const CATALOG = JSON.parse(readFileSync(join(ROOT, "skills-catalog.json"), "utf8"));

/** Names of the projects these skills came from; none may appear in them. */
const PROJECT_NAMES = /kaname|abastio|clean ?queen|rsat\//i;

/** An `issue-flow` command in a skill: its first two words, like `issue start`. */
const ISSUE_FLOW_COMMAND = /issue-flow ([a-z]+(?: [a-z][a-z-]+)?)/g;

/** Markdown link to a relative path: `[text](path)`, without URLs or anchors. */
const RELATIVE_LINK = /\]\((?!https?:|#|mailto:)([^)#\s]+)/g;

/**
 * Lists every file under a folder, recursively.
 *
 * @param dir - Folder to walk.
 * @returns Absolute paths of the files.
 */
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

/**
 * Reads the frontmatter field of a `SKILL.md`.
 *
 * @param text - Content of the file.
 * @param field - Field name.
 * @returns Its first line, or `undefined`.
 */
function frontmatterField(text, field) {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  return new RegExp(`^${field}:\\s*(.*)$`, "m").exec(frontmatter)?.[1];
}

describe("skills-catalog.json", () => {
  test("every listed skill has a SKILL.md with the same name and a description", () => {
    for (const skill of CATALOG.skills) {
      const text = readFileSync(join(ROOT, skill.path, "SKILL.md"), "utf8");

      assert.equal(frontmatterField(text, "name"), skill.name, skill.path);
      assert.ok(frontmatterField(text, "description") !== undefined, `${skill.name} has no description`);
    }
  });

  test("every skill folder is listed, and every requires names a listed skill", () => {
    const listed = CATALOG.skills.map((skill) => skill.name);

    assert.deepEqual(readdirSync(join(ROOT, "skills")).sort(), [...listed].sort());
    for (const skill of CATALOG.skills) {
      for (const name of skill.requires ?? []) {
        assert.ok(listed.includes(name), `${skill.name} requires ${name}, which is not listed`);
      }
    }
  });

  test("every editable file has its template and is not shipped itself", () => {
    for (const skill of CATALOG.skills) {
      for (const file of skill.editable ?? []) {
        assert.ok(existsSync(join(ROOT, skill.path, `${file}.template`)), `${skill.name}: missing ${file}.template`);
        assert.ok(!existsSync(join(ROOT, skill.path, file)), `${skill.name}: ships ${file} instead of a template`);
      }
    }
  });
});

describe("skill contents", () => {
  test("relative links resolve, to a skill this one ships or requires", () => {
    for (const skill of CATALOG.skills) {
      for (const file of files(join(ROOT, skill.path)).filter((path) => path.endsWith(".md"))) {
        for (const [, target] of readFileSync(file, "utf8").matchAll(RELATIVE_LINK)) {
          const resolved = join(dirname(file), target);
          const owner = resolved.split(`${join(ROOT, "skills")}/`)[1]?.split("/")[0];

          assert.ok(existsSync(resolved), `${file} links to ${target}, which does not exist`);
          assert.ok([skill.name, ...(skill.requires ?? [])].includes(owner), `${file} links to ${owner}, which ${skill.name} does not require`);
        }
      }
    }
  });

  test("every issue-flow command a skill names is in the CLI's usage", () => {
    const usage = spawnSync(process.execPath, [join(ROOT, "dist", "cli.js"), "--help"], { encoding: "utf8" }).stdout;

    for (const file of files(join(ROOT, "skills"))) {
      for (const [, command] of readFileSync(file, "utf8").matchAll(ISSUE_FLOW_COMMAND)) {
        assert.match(usage, new RegExp(`issue-flow ${command}(\\s|$)`, "m"), `${file} runs 'issue-flow ${command}', which the CLI does not have`);
      }
    }
  });

  test("no file of a shared skill names the project it came from", () => {
    for (const file of files(join(ROOT, "skills"))) {
      assert.doesNotMatch(readFileSync(file, "utf8"), PROJECT_NAMES, file);
    }
  });
});
