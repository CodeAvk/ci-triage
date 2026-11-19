import { describe, expect, it } from "vitest";
import { addCounts, isSummaryJob, labelRun, type Attempt, type Job } from "../src/collect/labels.js";

const run = { repo: "o/r", id: 7, workflow: "CI", headSha: "abc", createdAt: "2026-11-19T00:00:00Z" };
let nextId = 1;
const job = (name: string, conclusion: string | null, over: Partial<Job> = {}): Job => ({
  id: nextId++, name, conclusion,
  started_at: "2026-11-19T10:00:00Z", completed_at: "2026-11-19T10:20:00Z",
  steps: [
    { name: "Set up job", conclusion: "success" },
    { name: "Checkout", conclusion: "success" },
    { name: "Run tests", conclusion: conclusion === "failure" ? "failure" : "success" },
    { name: "Post", conclusion: "success" },
  ],
  ...over,
});
const attempt = (n: number, conclusion: string | null, jobs: Job[]): Attempt => ({ attempt: n, conclusion, jobs });

// The summary job seen in vercel/next.js run 44564664430: 3 steps, 2 seconds, "Run exit 1".
const summaryJob = (conclusion: string) => job("thank you, next", conclusion, {
  started_at: "2026-11-19T10:21:00Z", completed_at: "2026-11-19T10:21:02Z",
  steps: [
    { name: "Set up job", conclusion: "success" },
    { name: "Run exit 1", conclusion: conclusion === "failure" ? "failure" : "skipped" },
    { name: "Complete job", conclusion: "success" },
  ],
});

describe("labelRun", () => {
  it("labels failed-then-passed as flaky and skips the summary job", () => {
    const failed = job("test (1/10)", "failure");
    const { labelled, excluded } = labelRun(run, [
      attempt(1, "failure", [failed, job("lint", "success"), summaryJob("failure")]),
      attempt(2, "success", [job("test (1/10)", "success"), job("lint", "success"), summaryJob("success")]),
    ]);
    expect(labelled.map((l) => [l.jobName, l.label, l.jobId, l.attempt, l.outcomes])).toEqual([
      ["test (1/10)", "flaky", failed.id, 1, ["1:failure", "2:success"]],
    ]);
    expect(labelled[0]!.failedSteps).toEqual(["Run tests"]);
    expect(excluded).toEqual({ "summary job": 1 });
  });

  it("labels a job that failed on every re-run as real", () => {
    const { labelled } = labelRun(run, [
      attempt(1, "failure", [job("build", "failure")]),
      attempt(2, "failure", [job("build", "failure")]),
    ]);
    expect(labelled.map((l) => [l.label, l.outcomes])).toEqual([["real", ["1:failure", "2:failure"]]]);
  });

  it("counts a job as flaky when it needed several re-runs, and labels the first failure", () => {
    const first = job("e2e", "failure");
    const { labelled } = labelRun(run, [
      attempt(1, "failure", [first]),
      attempt(2, "failure", [job("e2e", "failure")]),
      attempt(3, "success", [job("e2e", "success")]),
    ]);
    expect(labelled.map((l) => [l.label, l.jobId])).toEqual([["flaky", first.id]]);
  });

  it("excludes attempts that never ran: approval waits, startup failures and cancellations", () => {
    const { labelled, excluded } = labelRun(run, [
      attempt(1, "action_required", []),
      attempt(2, "success", [job("test", "success")]),
    ]);
    expect(labelled).toEqual([]);
    expect(excluded).toEqual({ "attempt action_required": 1 });

    const cancelled = labelRun(run, [
      attempt(1, "cancelled", [job("test", "failure")]),
      attempt(2, "startup_failure", []),
      attempt(3, "success", [job("test", "success")]),
    ]);
    expect(cancelled.labelled).toEqual([]);
    expect(cancelled.excluded).toEqual({ "attempt cancelled": 1, "attempt startup_failure": 1 });
  });

  it("excludes a failure that was never re-run and ignores cancelled or skipped jobs", () => {
    const { labelled, excluded } = labelRun(run, [
      attempt(1, "failure", [job("a", "failure"), job("b", "failure")]),
      attempt(2, "failure", [job("a", "skipped"), job("b", "cancelled")]),
    ]);
    expect(labelled).toEqual([]);
    expect(excluded).toEqual({ "not re-run": 2 });
  });

  it("excludes job names that repeat within an attempt", () => {
    const { labelled, excluded } = labelRun(run, [
      attempt(1, "failure", [job("matrix", "failure"), job("matrix", "success")]),
      attempt(2, "success", [job("matrix", "success"), job("matrix", "success")]),
    ]);
    expect(labelled).toEqual([]);
    expect(excluded).toEqual({ "duplicate job name": 1 });
  });

  it("sorts attempts before following a job", () => {
    const { labelled } = labelRun(run, [
      attempt(2, "success", [job("t", "success")]),
      attempt(1, "failure", [job("t", "failure")]),
    ]);
    expect(labelled[0]!.outcomes).toEqual(["1:failure", "2:success"]);
  });
});

describe("isSummaryJob", () => {
  it("recognises explicit exit-1 and needs. checks, and tiny jobs next to a real failure", () => {
    const real = job("test", "failure");
    expect(isSummaryJob(summaryJob("failure"), [real])).toBe(true);
    const needs = job("gate", "failure", { steps: [{ name: "Check ${{ needs.build.result }}", conclusion: "failure" }] });
    expect(isSummaryJob(needs, [needs])).toBe(true);
    const tiny = job("report", "failure", {
      started_at: "2026-11-19T10:00:00Z", completed_at: "2026-11-19T10:00:05Z",
      steps: [{ name: "Report", conclusion: "failure" }],
    });
    expect(isSummaryJob(tiny, [tiny, real])).toBe(true);
    expect(isSummaryJob(tiny, [tiny])).toBe(false); // nothing else failed: it failed on its own
    expect(isSummaryJob(real, [real, summaryJob("failure")])).toBe(false);
  });
});

describe("addCounts", () => {
  it("adds exclusion counts", () => {
    expect(addCounts({ a: 1 }, { a: 2, b: 1 })).toEqual({ a: 3, b: 1 });
  });
});
