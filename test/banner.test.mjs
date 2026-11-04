// Tests of the final-message block: Kuro, the layout, color and the `art` option.
import { test } from "node:test";
import assert from "node:assert/strict";
import { banner, blockOpts, KURO } from "../dist/banner.js";

const SAVED = {
  mood: "ok",
  title: "Sesión guardada - issue #34",
  rows: [["Rama", "feat/34-x"], ["PR", "#51 (draft)"]],
  next: { label: "Para retomarla:", command: "bun run issue:start:free 34" },
};

test("KURO is the drawing of issue #49, byte for byte", () => {
  assert.equal(
    KURO.join("\n"),
    ["    ▄█████▄", " ≋≋██▀▀▀▀▀██", "    █ ▄  ▄ █   ╱", "    ▀█▄▄▄▄█▀  ╱"].join("\n"),
  );
});

test("with art, the block is Kuro on the left and the text from row 1 at column 26", () => {
  // Written out literally, so a bug in the layout code cannot hide in both sides.
  const literal =
    "\n" +
    "    ▄█████▄\n" +
    " ≋≋██▀▀▀▀▀██" + " ".repeat(14) + "[ok] Sesión guardada - issue #34\n" +
    "    █ ▄  ▄ █   ╱\n" +
    "    ▀█▄▄▄▄█▀  ╱" + " ".repeat(11) + "Rama  feat/34-x\n" +
    "                          PR    #51 (draft)\n" +
    "\n" +
    "                          Para retomarla:\n" +
    "                            bun run issue:start:free 34\n" +
    "\n";

  assert.equal(banner(SAVED, { art: true, color: false }), literal);
});

test("without art there is no drawing, and the text is indented by two", () => {
  const text = banner(SAVED, { art: false, color: false });

  assert.ok(!text.includes("█"));
  assert.ok(text.startsWith("\n  [ok] "));
  assert.equal(
    text,
    "\n  [ok] Sesión guardada - issue #34\n\n  Rama  feat/34-x\n  PR    #51 (draft)\n\n  Para retomarla:\n    bun run issue:start:free 34\n\n",
  );
});

test("color only shows up when asked", () => {
  assert.ok(!banner(SAVED, { art: true, color: false }).includes("\x1b"));
  const colored = banner(SAVED, { art: true, color: true });
  assert.ok(colored.includes("\x1b[32m"));
  assert.ok(colored.includes("\x1b[1mbun run issue:start:free 34"));
  assert.ok(banner({ mood: "error", title: "x" }, { art: false, color: true }).includes("\x1b[31m"));
  assert.ok(banner({ mood: "question", title: "x" }, { art: false, color: true }).includes("\x1b[33m"));
});

test("moods use ASCII marks", () => {
  assert.ok(banner({ mood: "error", title: "x" }, { art: false, color: false }).includes("[!] x"));
  assert.ok(banner({ mood: "question", title: "x" }, { art: false, color: false }).includes("[?] x"));
});

test("a long value stays whole on one line", () => {
  const branch = `feat/34-${"a".repeat(112)}`;
  const text = banner({ ...SAVED, rows: [["Rama", branch]] }, { art: true, color: false });

  assert.equal(branch.length, 120);
  assert.ok(text.split("\n").some((line) => line.endsWith(`Rama  ${branch}`)));
});

test("a block without rows or next still has its title, and extra lines follow the rows", () => {
  const text = banner({ mood: "error", title: "Falló", lines: ["uno", "dos"] }, { art: false, color: false });

  assert.equal(text, "\n  [!] Falló\n\n  uno\n  dos\n\n");
});

test("blockOpts needs a terminal, NO_COLOR unset and art not turned off", () => {
  const out = (stdout, stderr) => ({ terminal: { stdout, stderr } });
  const saved = process.env.NO_COLOR;
  try {
    delete process.env.NO_COLOR;
    assert.deepEqual(blockOpts(out(true, false), "stdout", null), { art: true, color: true });
    assert.deepEqual(blockOpts(out(true, false), "stderr", null), { art: false, color: false });
    assert.deepEqual(blockOpts(out(true, true), "stdout", { art: false }), { art: false, color: true });
    process.env.NO_COLOR = "";
    assert.equal(blockOpts(out(true, true), "stdout", null).color, true);
    process.env.NO_COLOR = "1";
    assert.deepEqual(blockOpts(out(true, true), "stdout", null), { art: true, color: false });
  } finally {
    if (saved === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = saved;
  }
});
