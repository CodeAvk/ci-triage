/**
 * Turns the attempts of one re-run workflow run into labelled failed jobs. Pure: no network.
 *
 * All attempts of a run share one commit. A job name is followed across the attempts that really
 * executed:
 *   - it failed in one attempt and succeeded in another  -> "flaky"
 *   - it failed in two or more attempts and never passed -> "real"
 *   - it failed once and never ran again                 -> excluded ("not re-run")
 * Excluded, and counted, so the label set is honest about what it leaves out:
 *   - attempts that never really ran: waiting for approval, startup failures, cancelled
 *     (approval waits alone were two thirds of re-runs in the flaky-builds study, arXiv 2602.02307);
 *   - summary jobs that only report that another job failed (see isSummaryJob);
 *   - job names that are not unique within an attempt, which cannot be matched across attempts.
 * A single re-run under-counts flakiness, and a failure that repeats can still be an outage, so
 * these labels are noisy; that is recorded in PRODUCT_RESEARCH.md.
 */

export interface Step {
  name: string;
  conclusion: string | null;
}

export interface Job {
  id: number;
  name: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  steps?: Step[];
}

export interface Attempt {
  attempt: number;
  conclusion: string | null; // the whole run's conclusion for this attempt
  jobs: Job[];
}

export interface RunInfo {
  repo: string;
  id: number;
  workflow: string;
  headSha: string;
  createdAt: string;
}

export type Label = "flaky" | "real";

export interface LabelledJob {
  repo: string;
  runId: number;
  workflow: string;
  headSha: string;
  createdAt: string;
  jobName: string;
  jobId: number; // the first failing execution; its log is the one to classify
  attempt: number;
  failedSteps: string[];
  label: Label;
  outcomes: string[]; // e.g. ["1:failure", "2:success"]
}

export type ExclusionCounts = Record<string, number>;

/** Run-level conclusions that mean the attempt did not really execute its jobs. */
const NOT_EXECUTED = new Set(["action_required", "startup_failure", "cancelled", "skipped", "stale"]);

const seconds = (j: Job) =>
  j.started_at && j.completed_at ? (Date.parse(j.completed_at) - Date.parse(j.started_at)) / 1000 : Infinity;

/**
 * A summary job fails only because other jobs failed (for example "Run exit 1" after checking
 * `needs.*.result`). Rule: its failing step is an explicit `exit 1` or reads `needs.`, or it is a
 * very short job (at most 3 steps, at most 30 s) in an attempt where another job also failed.
 */
export function isSummaryJob(job: Job, attemptJobs: Job[]): boolean {
  const failing = (job.steps ?? []).filter((s) => s.conclusion === "failure").map((s) => s.name);
  if (failing.some((n) => /^run exit 1$/i.test(n.trim()) || /\bneeds\./.test(n))) return true;
  const tiny = (job.steps?.length ?? 0) <= 3 && seconds(job) <= 30;
  const othersFailed = attemptJobs.some((j) => j.id !== job.id && j.conclusion === "failure");
  return tiny && othersFailed;
}

export function labelRun(run: RunInfo, attempts: Attempt[]): { labelled: LabelledJob[]; excluded: ExclusionCounts } {
  const excluded: ExclusionCounts = {};
  const skip = (reason: string, n = 1) => (excluded[reason] = (excluded[reason] ?? 0) + n);

  const executed = [...attempts].sort((a, b) => a.attempt - b.attempt).filter((a) => {
    if (a.conclusion && NOT_EXECUTED.has(a.conclusion)) {
      skip(`attempt ${a.conclusion}`);
      return false;
    }
    return true;
  });

  // name -> executions in attempt order; names that repeat within an attempt are dropped.
  const byName = new Map<string, { attempt: Attempt; job: Job }[]>();
  const ambiguous = new Set<string>();
  for (const a of executed) {
    const seen = new Set<string>();
    for (const job of a.jobs) {
      if (seen.has(job.name)) ambiguous.add(job.name);
      seen.add(job.name);
      if (job.conclusion !== "success" && job.conclusion !== "failure") continue; // skipped, cancelled, neutral
      const list = byName.get(job.name) ?? [];
      list.push({ attempt: a, job });
      byName.set(job.name, list);
    }
  }

  const labelled: LabelledJob[] = [];
  for (const [name, runs] of byName) {
    const failures = runs.filter((r) => r.job.conclusion === "failure");
    if (failures.length === 0) continue;
    if (ambiguous.has(name)) { skip("duplicate job name"); continue; }
    const first = failures[0]!;
    if (isSummaryJob(first.job, first.attempt.jobs)) { skip("summary job"); continue; }
    const passed = runs.some((r) => r.job.conclusion === "success");
    let label: Label;
    if (passed) label = "flaky";
    else if (failures.length >= 2) label = "real";
    else { skip("not re-run"); continue; }
    labelled.push({
      repo: run.repo, runId: run.id, workflow: run.workflow, headSha: run.headSha, createdAt: run.createdAt,
      jobName: name, jobId: first.job.id, attempt: first.attempt.attempt,
      failedSteps: (first.job.steps ?? []).filter((s) => s.conclusion === "failure").map((s) => s.name),
      label, outcomes: runs.map((r) => `${r.attempt.attempt}:${r.job.conclusion}`),
    });
  }
  return { labelled, excluded };
}

/** Adds one set of exclusion counts into another. */
export function addCounts(into: ExclusionCounts, from: ExclusionCounts): ExclusionCounts {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
  return into;
}
