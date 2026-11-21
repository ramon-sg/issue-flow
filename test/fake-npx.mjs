// Fake npx and npm for the tests of init, doctor and upgrade: `--version` answers 10.9.0
// without logging (the runner library asks it to pick a runner and to write packageManager);
// any other call logs its arguments and folder to FAKE_NPX_LOG, so a test can tell that a
// command ran no other tool, and fails.
import { appendFileSync } from "node:fs";

const program = process.env.FAKE_NPX_AS === "npm" ? "npm" : "npx";
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") {
  process.stdout.write("10.9.0\n");
  process.exit(0);
}
appendFileSync(process.env.FAKE_NPX_LOG, `${JSON.stringify({ program, args, cwd: process.cwd() })}\n`);
process.exit(1);
