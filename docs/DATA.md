# Labelled data (Gate 0)

`npm run collect` builds the label set from public GitHub Actions history. Labels come from GitHub re-runs, never from a model.

## How a failed job is labelled

All attempts of a re-run workflow run use the same commit. Each job name is followed across the attempts that really executed (`src/collect/labels.ts`):

| Job history across attempts | Label |
|---|---|
| failed in one attempt, succeeded in another | **flaky** |
| failed in two or more attempts, never passed | **real** |
| failed once, never ran again | excluded: not re-run |

Also excluded, and counted in `data/labels/summary.json`:

- attempts that never really ran: waiting for maintainer approval (`action_required`), startup failures, cancelled or skipped attempts;
- summary jobs that fail only because another job failed (an explicit `exit 1` or `needs.` step, or a job of at most 3 steps and 30 seconds next to another failure);
- job names that repeat within one attempt, which cannot be matched across attempts.

The collector stores run ids, job ids, job and step names and labels. It stores no logs.

## Listing every run

The runs list returns at most 1,000 results per query. Busy repositories create far more: pytorch/pytorch created 1,225 completed runs between 06:00 and 07:00 UTC on 2026-11-18. `runsBetween` reads `total_count` from the first page and halves the time window until each part fits, down to one minute; a minute that still holds more is reported as incomplete. A full day of vercel/next.js (2026-11-18) came to 1,787 runs in 102 requests.

## First collection (2026-11-19 and 2026-11-20)

Repositories: vercel/next.js, pytorch/pytorch, microsoft/vscode, nodejs/node. Window: 2026-11-16 to 2026-11-18. The first pass listed only the first 1,000 runs of each day (before window splitting); next.js 2026-11-18 was then collected in full. So these counts are a partial sample, not a rate.

| Repository | Flaky | Real | Runs with labels | Most labels from one run |
|---|---|---|---|---|
| microsoft/vscode | 6 | 0 | 6 | 1 |
| nodejs/node | 4 | 0 | 4 | 1 |
| pytorch/pytorch | 19 | 120 | 73 | 6 |
| vercel/next.js | 66 | 58 | 46 | 12 |
| **Total** | **95** | **178** | **129** | |

Excluded in the first pass, per repository: approval waits were the largest group for nodejs/node (51 of 60 re-run runs) and microsoft/vscode (27 of 35); pytorch/pytorch had 42 approval waits and 35 failures that were never re-run; vercel/next.js had 28 summary jobs.

## What this shows

- **Enough labels, unevenly spread.** 273 jobs and both classes above 40 meet the size part of Gate 0, but the label mix depends on the repository: pytorch is mostly "real", vscode and node only "flaky". A classifier could learn which repository a log came from instead of what failed, so the evaluation must hold out whole repositories, or at least whole runs, and report results per repository.
- **Labels cluster.** One next.js run gave 12 labels. Jobs from the same run are not independent, so splits are by run, never by job.
- **Some "real" labels are knock-on failures.** In next.js, "Wait for preview tarball" failed three times because the native build it waits for failed. These are real for the run, but not separate bugs.
- **Labels are noisy.** One re-run misses some flaky failures, and a failure that repeats can be an outage that lasted through both attempts.
- **Gate 0 is not met yet:** 4 repositories of the 5 required, GitHub's terms for storing logs are unchecked, and the Gemini limits are unrecorded.
