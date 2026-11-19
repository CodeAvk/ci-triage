import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collect, days, LIST_CAP, parseCollectArgs, runsBetween, type ApiRun } from "../src/collect/run.js";
import { GitHub } from "../src/github/client.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const step = (name: string, conclusion: string) => ({ name, conclusion });
const job = (id: number, name: string, conclusion: string) => ({
  id, name, conclusion, started_at: "2026-11-18T10:00:00Z", completed_at: "2026-11-18T10:10:00Z",
  steps: [step("Set up job", "success"), step("Checkout", "success"), step("Test", conclusion), step("Post", "success")],
});

type FakeRun = ApiRun;

/**
 * A fake api.github.com. The runs list honours `created=from..to`, reports `total_count`, pages
 * results and caps them at 1,000 like the real API. By default it holds one ordinary run and one
 * re-run run on 2026-11-18.
 */
function fakeApi(runs: FakeRun[] = [
  { id: 1, name: "CI", head_sha: "s1", created_at: "2026-11-18T09:00:00Z", run_attempt: 1 },
  { id: 2, name: "CI", head_sha: "s2", created_at: "2026-11-18T09:30:00Z", run_attempt: 2 },
]) {
  const urls: string[] = [];
  const routes: Record<string, unknown> = {
    "/repos/o/r/actions/runs/2/attempts/1": { conclusion: "failure" },
    "/repos/o/r/actions/runs/2/attempts/2": { conclusion: "failure" },
    "/repos/o/r/actions/runs/2/attempts/1/jobs": { jobs: [job(21, "unit", "failure"), job(22, "e2e", "failure"), job(23, "lint", "success")] },
    "/repos/o/r/actions/runs/2/attempts/2/jobs": { jobs: [job(31, "unit", "success"), job(32, "e2e", "failure"), job(33, "lint", "success")] },
  };
  const impl = (async (input: string | URL) => {
    const url = new URL(String(input));
    urls.push(url.pathname + url.search);
    const perPage = Number(url.searchParams.get("per_page") ?? 30);
    const page = Number(url.searchParams.get("page") ?? 1);
    if (url.pathname === "/repos/o/r/actions/runs") {
      const [from, to] = (url.searchParams.get("created") ?? "").split("..").map((t) => Date.parse(t));
      const hits = runs.filter((r) => Date.parse(r.created_at) >= from! && Date.parse(r.created_at) <= to!);
      const visible = hits.slice(0, LIST_CAP);
      return new Response(JSON.stringify({ total_count: hits.length, workflow_runs: visible.slice((page - 1) * perPage, page * perPage) }));
    }
    const body = routes[url.pathname];
    if (body === undefined) return new Response("{}", { status: 404 });
    if (page !== 1) return new Response(JSON.stringify({ jobs: [] }));
    return new Response(JSON.stringify(body));
  }) as typeof fetch;
  return { impl, urls };
}

/** n ordinary runs spread evenly from `start` over `spanMs`. */
const manyRuns = (n: number, start: string, spanMs: number, idFrom = 1000): FakeRun[] =>
  Array.from({ length: n }, (_, i) => ({
    id: idFrom + i, name: "CI", head_sha: `x${i}`, run_attempt: 1,
    created_at: new Date(Date.parse(start) + Math.floor((i * spanMs) / n)).toISOString().replace(/\.\d{3}Z$/, "Z"),
  }));

describe("runsBetween", () => {
  const day = Date.parse("2026-11-18T00:00:00Z");

  it("splits a window holding more than 1,000 runs until every part fits, and finds them all", async () => {
    const runs = manyRuns(2500, "2026-11-18T00:00:00Z", 86_400_000);
    const api = fakeApi(runs);
    const got = await runsBetween(new GitHub({ token: "t", fetchImpl: api.impl }), "o/r", day, day + 86_399_000);
    expect(got.truncated).toBe(false);
    expect(new Set(got.runs.map((r) => r.id)).size).toBe(2500);
    expect(got.runs).toHaveLength(2500); // halves do not overlap
  });

  it("uses one request for a quiet window", async () => {
    const api = fakeApi();
    const gh = new GitHub({ token: "t", fetchImpl: api.impl });
    expect((await runsBetween(gh, "o/r", day, day + 86_399_000)).runs).toHaveLength(2);
    expect(gh.requests).toBe(1);
  });

  it("reports a window it cannot split further as truncated", async () => {
    const runs = manyRuns(1200, "2026-11-18T10:00:00Z", 0); // 1,200 runs in the same second
    const got = await runsBetween(new GitHub({ token: "t", fetchImpl: fakeApi(runs).impl }), "o/r", day, day + 86_399_000);
    expect(got.truncated).toBe(true);
    expect(got.runs).toHaveLength(LIST_CAP);
  });
});

describe("collect", () => {
  it("labels the jobs of re-run runs only, writes JSON lines and a summary, and skips processed runs", async () => {
    const out = mkdtempSync(join(tmpdir(), "ci-triage-collect-"));
    dirs.push(out);
    const api = fakeApi();
    const args = { repos: ["o/r"], since: "2026-11-17", until: "2026-11-18", maxRequests: 100, out };
    const s = await collect(args, new GitHub({ token: "t", fetchImpl: api.impl }), () => undefined);

    expect(s.repos["o/r"]).toEqual({ runsSeen: 2, reruns: 1, flaky: 1, real: 1, excluded: {}, truncatedDays: [] });
    expect(api.urls.some((u) => u.includes("/runs/1/"))).toBe(false); // run 1 was never re-run: not fetched
    const lines = readFileSync(join(out, "o__r.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => [l.jobName, l.label, l.jobId, l.runId])).toEqual([["unit", "flaky", 21, 2], ["e2e", "real", 22, 2]]);
    expect(JSON.parse(readFileSync(join(out, "summary.json"), "utf8")).requests).toBe(s.requests);

    const again = await collect(args, new GitHub({ token: "t", fetchImpl: api.impl }), () => undefined);
    expect(again.repos["o/r"]!.flaky).toBe(0); // run 2 already processed
    expect(readFileSync(join(out, "o__r.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("skips a run the API keeps failing on, counts it, and tries it again next time", async () => {
    const out = mkdtempSync(join(tmpdir(), "ci-triage-collect-"));
    dirs.push(out);
    const api = fakeApi();
    let broken = true;
    const flaky = (async (input: string | URL, init?: RequestInit) =>
      broken && String(input).includes("/attempts/2/jobs") ? new Response("{}", { status: 502 }) : api.impl(input, init)) as typeof fetch;
    const args = { repos: ["o/r"], since: "2026-11-18", until: "2026-11-18", maxRequests: 100, out };
    const first = await collect(args, new GitHub({ token: "t", fetchImpl: flaky, sleep: async () => undefined }), () => undefined);
    expect(first.repos["o/r"]).toMatchObject({ flaky: 0, real: 0, excluded: { "API error (retry later)": 1 } });
    broken = false;
    const second = await collect(args, new GitHub({ token: "t", fetchImpl: flaky }), () => undefined);
    expect(second.repos["o/r"]).toMatchObject({ flaky: 1, real: 1, excluded: {} });
  });

  it("stops cleanly at the request budget and still writes the summary", async () => {
    const out = mkdtempSync(join(tmpdir(), "ci-triage-collect-"));
    dirs.push(out);
    const args = { repos: ["o/r"], since: "2026-11-18", until: "2026-11-18", maxRequests: 2, out };
    const gh = new GitHub({ token: "t", fetchImpl: fakeApi().impl, maxRequests: args.maxRequests });
    const s = await collect(args, gh, () => undefined);
    expect(s.stopped).toMatch(/budget of 2/);
    expect(s.requests).toBe(2);
    expect(existsSync(join(out, "summary.json"))).toBe(true);
  });
});

describe("collect arguments", () => {
  it("parses repos and a date range, with defaults", () => {
    expect(parseCollectArgs(["--repos", "vercel/next.js, nodejs/node", "--since", "2026-11-10"])).toEqual({
      repos: ["vercel/next.js", "nodejs/node"], since: "2026-11-10", until: "2026-11-10", maxRequests: 1500, out: "data/labels",
    });
    expect(() => parseCollectArgs(["--since", "2026-11-10"])).toThrow(/--repos/);
    expect(() => parseCollectArgs(["--repos", "bad", "--since", "2026-11-10"])).toThrow(/owner\/name/);
    expect(() => parseCollectArgs(["--repos", "o/r", "--since", "11/10/2026"])).toThrow(/YYYY-MM-DD/);
    expect(() => parseCollectArgs(["--repos", "o/r", "--since", "2026-11-12", "--until", "2026-11-10"])).toThrow(/after/);
  });

  it("lists every day in a range", () => {
    expect(days("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(days("2026-11-02", "2026-11-02")).toEqual(["2026-11-02"]);
  });
});
