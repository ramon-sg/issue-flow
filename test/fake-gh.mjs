// Fake gh for the tests: answers `gh api --method M <path> [--input -]` with the routes in
// FAKE_GH_ROUTES ({"GET repos/...": {status, body}}) and logs every call to FAKE_GH_LOG.
// No route: 404 like gh.
import { appendFileSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const method = args[2];
const path = args[3];
const body = args.includes("--input") ? JSON.parse(readFileSync(0, "utf8")) : undefined;
appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify({ method, path, body })}\n`);
const routes = JSON.parse(readFileSync(process.env.FAKE_GH_ROUTES, "utf8"));
const route = routes[`${method} ${path}`];
if (route === undefined) {
  process.stdout.write('{"message":"Not Found"}');
  process.stderr.write("gh: Not Found (HTTP 404)\n");
  process.exit(1);
}
const status = route.status ?? 200;
process.stdout.write(JSON.stringify(route.body ?? {}));
if (status >= 300) {
  process.stderr.write(`gh: ${route.body?.message ?? "error"} (HTTP ${status})\n`);
  process.exit(1);
}
