# Log trimmer

`src/logs/trim.ts` cuts a failed job's log down to the lines that explain the failure, with no model involved. The excerpt is what both the keyword baseline and the Gemini classifier will read, so it has to keep the cause while staying small enough for the free tier.

```
npm run trim -- path/to/job.log [--budget 6000]
```

## What it keeps

1. Timestamps and colour codes are removed; every kept line keeps its original line number (`L2628: ...`), so a model's quoted evidence can be checked against the real log.
2. The failing step is the last `##[group]Run ...` line before the first `##[error]`.
3. From that step to the last error marker it keeps, in priority order:
   - the error lines, and the 3 lines after each (some tools print the marker first and the details after it);
   - the 40 lines before the first error;
   - the step's first 3 lines (its command);
   - lines that look like a cause (error, failed, exception, traceback, timeout, killed, out of memory, connection reset, rate limit, `✕`, `●`, ...) with 2 lines of context, nearest an error first.
4. Progress lines that only look like errors by name are never kept as keyword hits: Rust crates such as `proc-macro-error` or `static_assertions`, package downloads and installs, deprecation warnings.
5. Everything stays within a budget (default 6,000 characters, about 1,500 tokens).
6. A log with no `##[error]` marker is flagged: the excerpt says the log may have been cut off. That happens when a runner is lost, which is itself a clue.

## Review on 12 real logs (2026-11-21)

Sample: 3 flaky and 3 real jobs each from vercel/next.js and pytorch/pytorch, taken from the labelled set (`docs/DATA.md`), one per run. The logs were downloaded to the git-ignored `data/` folder and are not in the repository. "Cause in excerpt" is my reading of each full log; it is a manual judgement on a small sample.

| Label | Repo | Log size | Excerpt | Cause in excerpt |
|---|---|---|---|---|
| flaky | next.js | 198 KB | 4.2 KB | yes: `error[E0425]` Rust compile error |
| flaky | next.js | 409 KB | 6.0 KB | yes: failing test file and test name |
| flaky | next.js | 197 KB | 4.4 KB | yes: same `error[E0425]` |
| real | next.js | 19 KB | 2.6 KB | yes: preview tarball not published within 30 min (waits on another job) |
| real | next.js | 130 KB | 4.3 KB | yes: same `error[E0425]` |
| real | next.js | 19 KB | 2.6 KB | yes: same tarball wait |
| flaky | pytorch | 2.0 MB | 6.0 KB | yes: CMake download from github.com failed |
| flaky | pytorch | 2.1 MB | 6.0 KB | **no cause in the log**: it stops mid-output with no error marker; flagged as cut off |
| flaky | pytorch | 41 KB | 3.4 KB | yes: GitHub API rate limit exceeded |
| real | pytorch | 239 KB | 6.0 KB | yes: `pushd: ... No such file or directory` in a runner hook |
| real | pytorch | 1.9 MB | 6.0 KB | yes: same `pushd` failure |
| real | pytorch | 5 KB | 1.2 KB | yes: CI disabled by a `[no-ci]` PR title prefix |

Excerpts are 0.3% to 22% of the original size. In 11 of 12 the cause is in the excerpt; the 12th log contains no cause at all.

## What the review shows about the labels

- **The same log text can carry either label.** The `error[E0425]: cannot find value generate_source_map` compile error appears in two next.js jobs labelled flaky (they passed when re-run on the same commit) and one labelled real (it failed again). A compile error that passes on re-run points to a build cache or a race between jobs, not to random tests. Whatever the reason, identical evidence with opposite labels caps the accuracy any classifier can reach from the log alone, and Gate 1 results must be read with that in mind.
- **"Real" is not always "a bug in the change".** The `[no-ci]` title check and the tarball wait failed on every attempt, so they are labelled real, but one is a repository policy and the other a knock-on effect of another job.
- **Infrastructure flakes are easy to see.** A rate-limited API call and a failed download are plain in the excerpt; these are the cases keyword rules should already catch.
