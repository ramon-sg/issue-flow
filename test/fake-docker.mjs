// Fake docker for the tests: a state in FAKE_DOCKER_STATE with `running` and items
// ({ kind: "container" | "volume" | "network", id, project, dir }), the calls logged to
// FAKE_DOCKER_LOG. It answers what docker.ts asks: info, ps, volume ls, network ls and
// their rm.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_DOCKER_LOG, `${JSON.stringify(args)}\n`);
const state = JSON.parse(readFileSync(process.env.FAKE_DOCKER_STATE, "utf8"));
const save = () => writeFileSync(process.env.FAKE_DOCKER_STATE, JSON.stringify(state));
const fail = () => {
  process.stderr.write("Cannot connect to the Docker daemon\n");
  process.exit(1);
};
if (!state.running) fail();

function filtered(kind, rest) {
  const at = rest.indexOf("--filter");
  const label = at === -1 ? null : rest[at + 1].replace(/^label=/, "");
  return state.items.filter((item) => {
    if (item.kind !== kind) return false;
    if (label === null || label === "com.docker.compose.project") return true;
    return label === `com.docker.compose.project=${item.project}`;
  });
}

function remove(kind, ids) {
  if (state.items.some((item) => item.kind === kind && ids.includes(item.id) && item.stuck)) fail();
  state.items = state.items.filter((item) => !(item.kind === kind && ids.includes(item.id)));
  save();
}

const [first, second, ...rest] = args;
if (first === "info") process.exit(0);
if (first === "ps") {
  const items = filtered("container", [second, ...rest]);
  const format = args.includes("--format");
  const lines = items.map((item) => (format ? `${item.project}\t${item.dir}` : item.id));
  process.stdout.write(lines.join("\n") + (lines.length > 0 ? "\n" : ""));
  process.exit(0);
}
if ((first === "volume" || first === "network") && second === "ls") {
  const lines = filtered(first, rest).map((item) => item.id);
  process.stdout.write(lines.join("\n") + (lines.length > 0 ? "\n" : ""));
  process.exit(0);
}
if (first === "rm") remove("container", rest);
else if ((first === "volume" || first === "network") && second === "rm") remove(first, rest);
else fail();
