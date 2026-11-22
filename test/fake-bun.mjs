// Fake bun for the tests: `--version` answers like Bun 1.4.4 without logging (the
// runner library asks it to pick a runner and to write packageManager); any other call is
// logged to FAKE_NPX_LOG, so a test can tell that a command ran no tool, and fails.
import { appendFileSync } from "node:fs";

const program = "bun";
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") {
  process.stdout.write("1.4.4\n");
  process.exit(0);
}
if (process.env.FAKE_NPX_LOG) appendFileSync(process.env.FAKE_NPX_LOG, `${JSON.stringify({ program, args, cwd: process.cwd() })}\n`);
process.exit(1);
