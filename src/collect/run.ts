/**
 * Collect re-run labelled failed jobs from public repositories.
 *
 * Usage: npm run collect -- --repos vercel/next.js,nodejs/node --since 2026-11-10 --until 2026-11-18
 *                           [--max-requests 1500] [--out data/labels]
 *
 * Walks each repository one day at a time. The runs list returns at most 1,000 results per query,
 * and busy repositories create more than that in an hour, so a full window is split in halves until
 * each part fits (see runsBetween). It keeps runs with more than one attempt, fetches each attempt's conclusion and jobs, and labels the
 * failed jobs with src/collect/labels.ts. Writes one JSON line per labelled job, and a summary with
 * the exclusion counts. Only ids, names, step names and labels are stored, no logs. Processed run ids
 * go to a `.runs` file, so repeating the command skips them. Needs GITHUB_TOKEN (read-only access to public repos is enough).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GitHub, GitHubError, loadToken, RequestBudgetError } from "../github/client.js";
import { addCounts, labelRun, type Attempt, type ExclusionCounts, type Job } from "./labels.js";

export interface CollectArgs {
  repos: string[];
  since: string;
  until: string;
  maxRequests: number;
  out: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;

function arg(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

export function parseCollectArgs(argv: string[]): CollectArgs {
  const repos = (arg(argv, "--repos") ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  if (repos.length === 0) throw new Error("--repos is required, e.g. --repos vercel/next.js,nodejs/node");
  for (const r of repos) if (!REPO.test(r)) throw new Error(`not owner/name: ${r}`);
  const since = arg(argv, "--since") ?? "";
  const until = arg(argv, "--until") ?? since;
  if (!DAY.test(since) || !DAY.test(until)) throw new Error("--since and --until must be YYYY-MM-DD");
  if (since > until) throw new Error("--since is after --until");
  const maxRequests = Number(arg(argv, "--max-requests") ?? "1500");
  if (!Number.isInteger(maxRequests) || maxRequests < 1) throw new Error(`bad --max-requests: ${maxRequests}`);
  return { repos, since, until, maxRequests, out: arg(argv, "--out") ?? "data/labels" };
}

/** Every day from `since` to `until`, inclusive, as YYYY-MM-DD. */
export function days(since: string, until: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${since}T00:00:00Z`); t <= Date.parse(`${until}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export interface ApiRun {
  id: number;
  name: string | null;
  head_sha: string;
  created_at: string;
  run_attempt?: number;
}

/** The runs list returns at most this many results for one query. */
export const LIST_CAP = 1000;
const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * Every completed run created in [from, to] (ms, inclusive). The first page tells the total; when
 * it is above the cap, the window is halved and each half listed, down to one minute. Returns the
 * runs and whether some minute-long window still held more than the cap (so results are incomplete).
 */
export async function runsBetween(gh: GitHub, repo: string, from: number, to: number): Promise<{ runs: ApiRun[]; truncated: boolean }> {
  const path = `/repos/${repo}/actions/runs?status=completed&created=${iso(from)}..${iso(to)}&per_page=100`;
  const first = await gh.json<{ total_count: number; workflow_runs: ApiRun[] }>(`${path}&page=1`);
  if (first.total_count > LIST_CAP && to - from >= 120_000) {
    const mid = from + Math.floor((to - from) / 2 / 1000) * 1000; // split on a whole second
    const a = await runsBetween(gh, repo, from, mid - 1000);
    const b = await runsBetween(gh, repo, mid, to);
    return { runs: [...a.runs, ...b.runs], truncated: a.truncated || b.truncated };
  }
  const runs = [...first.workflow_runs];
  const pages = Math.ceil(Math.min(first.total_count, LIST_CAP) / 100);
  for (let page = 2; page <= pages; page++) {
    runs.push(...(await gh.json<{ workflow_runs: ApiRun[] }>(`${path}&page=${page}`)).workflow_runs);
  }
  return { runs, truncated: first.total_count > LIST_CAP };
}

interface Summary {
  repos: Record<string, {
    runsSeen: number; reruns: number; flaky: number; real: number; excluded: ExclusionCounts; truncatedDays: string[];
  }>;
  requests: number;
  stopped: string | null;
}

/** Run ids already processed (labelled or not), so a repeated command does not fetch them again. */
function processedRuns(file: string): Set<number> {
  if (!existsSync(file)) return new Set();
  return new Set(readFileSync(file, "utf8").split("\n").filter(Boolean).map(Number));
}

export async function collect(args: CollectArgs, gh: GitHub, log: (s: string) => void = console.log): Promise<Summary> {
  mkdirSync(args.out, { recursive: true });
  const summary: Summary = { repos: {}, requests: 0, stopped: null };
  try {
    for (const repo of args.repos) {
      const base = join(args.out, repo.replace("/", "__"));
      const file = `${base}.jsonl`;
      const seenFile = `${base}.runs`;
      const done = processedRuns(seenFile);
      const s = (summary.repos[repo] = { runsSeen: 0, reruns: 0, flaky: 0, real: 0, excluded: {}, truncatedDays: [] as string[] });
      for (const day of days(args.since, args.until)) {
        const start = Date.parse(`${day}T00:00:00Z`);
        const { runs, truncated } = await runsBetween(gh, repo, start, start + 86_399_000);
        s.runsSeen += runs.length;
        if (truncated) s.truncatedDays.push(day); // a minute held more than the API returns
        for (const run of runs.filter((r) => (r.run_attempt ?? 1) > 1)) {
          s.reruns++;
          if (done.has(run.id)) continue;
          const attempts: Attempt[] = [];
          try {
            for (let n = 1; n <= (run.run_attempt ?? 1); n++) {
              const meta = await gh.json<{ conclusion: string | null }>(`/repos/${repo}/actions/runs/${run.id}/attempts/${n}`);
              // Job lists with many steps are heavy; small pages avoid most server errors.
              const jobs = await gh.all<Job>(`/repos/${repo}/actions/runs/${run.id}/attempts/${n}/jobs`, "jobs", 30);
              attempts.push({ attempt: n, conclusion: meta.conclusion, jobs });
            }
          } catch (err) {
            // A run the API keeps failing on is skipped and counted, not fatal. It is not marked as
            // processed, so a later run of the command tries it again.
            if (!(err instanceof GitHubError) || err.status < 500) throw err;
            addCounts(s.excluded, { "API error (retry later)": 1 });
            log(`${repo} run ${run.id}: ${err.message}`);
            continue;
          }
          const { labelled, excluded } = labelRun(
            { repo, id: run.id, workflow: run.name ?? "", headSha: run.head_sha, createdAt: run.created_at }, attempts);
          addCounts(s.excluded, excluded);
          for (const j of labelled) {
            appendFileSync(file, JSON.stringify(j) + "\n");
            s[j.label]++;
          }
          appendFileSync(seenFile, `${run.id}\n`);
        }
        log(`${repo} ${day}: ${runs.length} runs, ${s.reruns} re-runs so far, flaky ${s.flaky}, real ${s.real} (requests ${gh.requests})`);
      }
    }
  } catch (err) {
    if (!(err instanceof RequestBudgetError)) throw err;
    summary.stopped = err.message; // keep what was collected; a rerun continues from here
    log(`stopped: ${err.message}`);
  }
  summary.requests = gh.requests;
  writeFileSync(join(args.out, "summary.json"), JSON.stringify({ ...args, ...summary }, null, 2));
  return summary;
}

if (/collect[\\/]run\.ts$/.test(process.argv[1] ?? "")) {
  const args = parseCollectArgs(process.argv.slice(2));
  collect(args, new GitHub({ token: loadToken(), maxRequests: args.maxRequests }))
    .then((s) => {
      for (const [repo, r] of Object.entries(s.repos)) {
        console.log(`${repo}: runs ${r.runsSeen}, re-runs ${r.reruns}, flaky ${r.flaky}, real ${r.real}, excluded ${JSON.stringify(r.excluded)}` +
          (r.truncatedDays.length ? `; WARNING over 1,000 runs (incomplete) on ${r.truncatedDays.join(", ")}` : ""));
      }
      console.log(`requests used: ${s.requests}${s.stopped ? ` (stopped: ${s.stopped})` : ""}`);
    })
    .catch((err) => {
      console.error(String(err));
      process.exit(1);
    });
}
