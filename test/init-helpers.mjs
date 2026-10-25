// Helpers of the init, doctor and upgrade tests: the fake npx and npm in the sandbox's PATH,
// their log, and the JSON files of the repo.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fake-npx.mjs");

// Puts the fake npx and npm in the sandbox's PATH.
export function withNpx(s) {
  writeFileSync(join(s.tmp, "bin", "npx"), `#!/bin/sh\nexec node "${FAKE}" "$@"\n`, { mode: 0o755 });
  writeFileSync(join(s.tmp, "bin", "npm"), `#!/bin/sh\nFAKE_NPX_AS=npm exec node "${FAKE}" "$@"\n`, { mode: 0o755 });
  writeFileSync(join(s.tmp, "npx.jsonl"), "");
  return s;
}

// The environment of a CLI run with the fakes; the log starts empty.
export function npxEnv(s, env = {}) {
  writeFileSync(join(s.tmp, "npx.jsonl"), "");
  return { FAKE_NPX_LOG: join(s.tmp, "npx.jsonl"), ...env };
}

// The calls to npx (and npm, with `program: "npm"`) of the last run.
export function npxCalls(s, program = "npx") {
  const file = join(s.tmp, "npx.jsonl");
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
  return lines.map((line) => JSON.parse(line)).filter((call) => call.program === program);
}

export const readRepoJson = (s, path) => JSON.parse(readFileSync(join(s.main, path), "utf8"));
