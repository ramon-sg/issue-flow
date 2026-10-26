// Fake npx and npm for the tests of init, doctor and upgrade: log their arguments and folder
// to FAKE_NPX_LOG, so a test can tell that a command ran no other tool, and fail.
import { appendFileSync } from "node:fs";

const program = process.env.FAKE_NPX_AS === "npm" ? "npm" : "npx";
appendFileSync(process.env.FAKE_NPX_LOG, `${JSON.stringify({ program, args: process.argv.slice(2), cwd: process.cwd() })}\n`);
process.exit(1);
