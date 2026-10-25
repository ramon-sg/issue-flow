// A GitHub with state, for the tests of `issue start`: fake-gh.mjs hands the call here when
// FAKE_GH_WORLD names a JSON file. It answers the REST calls github-rest makes for one repo,
// reads the branches from a real bare origin, and saves PRs it creates or edits back to the
// file. GraphQL always fails, as in Claude's cloud.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const PAGE_REST = /[?&]page=(\d+)/;

function answer(status, body) {
  process.stdout.write(JSON.stringify(body ?? {}));
  if (status >= 300) {
    process.stderr.write(`gh: ${body?.message ?? "error"} (HTTP ${status})\n`);
    process.exit(1);
  }
  process.exit(0);
}

function originHeads(world) {
  const out = execFileSync("git", ["--git-dir", world.origin, "for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads"], {
    encoding: "utf8",
  });
  return Object.fromEntries(out.split("\n").filter(Boolean).map((line) => line.split(" ")));
}

function rawPull(world, pull) {
  const full = world.repo;
  return {
    number: pull.number,
    state: pull.state === "open" ? "open" : "closed",
    merged_at: pull.state === "merged" ? "2026-10-01T00:00:00Z" : null,
    draft: pull.draft ?? false,
    title: pull.title ?? "",
    body: pull.body ?? "",
    html_url: `https://github.com/${full}/pull/${pull.number}`,
    head: { ref: pull.branch, sha: pull.sha ?? "", repo: pull.fork ? { full_name: "someone/widgets" } : { full_name: full } },
    base: { ref: pull.base ?? world.defaultBranch, repo: { full_name: full } },
  };
}

function refs(body, number) {
  return new RegExp(`\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|part of):?\\s*#${number}(?![0-9])`, "i").test(body ?? "");
}

export function handle(method, path, body) {
  const file = process.env.FAKE_GH_WORLD;
  const world = JSON.parse(readFileSync(file, "utf8"));
  const save = () => writeFileSync(file, JSON.stringify(world, null, 2));
  const page = Number(PAGE_REST.exec(path)?.[1] ?? 1);
  const base = `repos/${world.repo}`;
  const [route, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  if (route === "graphql") return answer(404, { message: "GraphQL is blocked" });
  if (route === "user") return answer(200, { login: world.login });
  if (route === base) {
    if (world.offline) return answer(503, { message: "offline" });
    return answer(200, { full_name: world.repo, default_branch: world.defaultBranch });
  }
  if (route === `${base}/branches`) {
    const heads = originHeads(world);
    return answer(200, page > 1 ? [] : Object.keys(heads).map((name) => ({ name })));
  }
  let match = new RegExp(`^${base}/issues/(\\d+)(/timeline|/assignees)?$`).exec(route);
  if (match !== null) {
    const issue = world.issues[match[1]];
    if (issue === undefined) return answer(404, { message: "Not Found" });
    if (match[2] === "/timeline") {
      const events = world.pulls
        .filter((pull) => refs(pull.body, Number(match[1])))
        .map((pull) => ({
          event: "cross-referenced",
          source: { issue: { number: pull.number, pull_request: {}, repository_url: `https://api.github.com/${base}` } },
        }));
      return answer(200, page > 1 ? [] : events);
    }
    if (match[2] === "/assignees") {
      if (world.assignFails) return answer(403, { message: "Forbidden" });
      issue.assignees = body.assignees.map((login) => ({ login }));
      save();
      return answer(201, issue);
    }
    return answer(200, issue);
  }
  if (route === `${base}/pulls` && method === "GET") {
    const head = decodeURIComponent(params.get("head") ?? "").split(":").slice(1).join(":");
    const found = world.pulls.filter((pull) => pull.branch === head && !pull.fork).sort((a, b) => b.number - a.number);
    return answer(200, found.map((pull) => rawPull(world, pull)));
  }
  if (route === `${base}/pulls` && method === "POST") {
    const sha = originHeads(world)[body.head];
    if (sha === undefined) return answer(422, { message: `head ${body.head} is not on GitHub` });
    const pull = { number: world.nextPr, branch: body.head, base: body.base, state: "open", draft: body.draft, title: body.title, body: body.body, sha };
    world.nextPr += 1;
    world.pulls.push(pull);
    save();
    return answer(201, rawPull(world, pull));
  }
  match = new RegExp(`^${base}/pulls/(\\d+)$`).exec(route);
  if (match !== null) {
    const pull = world.pulls.find((item) => item.number === Number(match[1]));
    if (pull === undefined) return answer(404, { message: "Not Found" });
    if (method === "PATCH") {
      if (body.body !== undefined) pull.body = body.body;
      if (body.state !== undefined) pull.state = body.state;
      save();
    }
    return answer(200, rawPull(world, pull));
  }
  return answer(404, { message: `fake-github does not know ${method} ${path}` });
}
