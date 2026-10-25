// Fake npx and npm for the tests of init, doctor and upgrade: log their arguments and folder
// to FAKE_NPX_LOG. npx fails (exit 1) when its arguments contain FAKE_NPX_FAIL, and prints
// FAKE_NPX_DOCTOR for claude-repo-guard's `doctor --json`. As npm (FAKE_NPX_AS=npm) it
// prints FAKE_NPM_VIEW for `npm view`, or fails without it.
import { appendFileSync } from "node:fs";

const program = process.env.FAKE_NPX_AS === "npm" ? "npm" : "npx";
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_NPX_LOG, `${JSON.stringify({ program, args, cwd: process.cwd() })}\n`);
const line = args.join(" ");
if (program === "npm") {
  if (process.env.FAKE_NPM_VIEW === undefined) {
    process.stderr.write("npm error 404 Not Found\n");
    process.exit(1);
  }
  process.stdout.write(process.env.FAKE_NPM_VIEW);
  process.exit(0);
}
if (process.env.FAKE_NPX_FAIL && line.includes(process.env.FAKE_NPX_FAIL)) process.exit(1);
if (line.includes("claude-repo-guard doctor --json")) process.stdout.write(process.env.FAKE_NPX_DOCTOR ?? "[]");
