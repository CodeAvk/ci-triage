# VALIDATION_PLAN.md

Rule: do not build the product until the gates it depends on pass. Results are logged below, including failures.

## Gate 0: data, access and terms
Pass when all hold:
- A collector gathers labelled failed jobs from public repositories: **flaky** = failed on one attempt and passed on the next with the same commit; **real** = failed and failed again on re-run with the same commit. Approval waits, cancellations, skipped jobs and summary jobs that only report other jobs are excluded, and the exclusions are counted.
- At least 150 labelled jobs, with at least 40 of each class, from at least 5 repositories.
- GitHub's terms for storing public Actions logs are read and recorded, and the repo stores only what they allow (by default: run and job ids, labels and short excerpts).
- The Gemini model chosen for the free tier works from a script, and its live limits are recorded.

## Gate 1: does AI beat the baselines? (decided before looking at results)
Split by repository and time into a **dev set** (for tuning) and a **held-out set** (run once, at least 60 jobs).

Compare on the held-out set:
1. always "real";
2. deterministic keyword rules for known flaky signatures;
3. Gemini over a deterministically trimmed excerpt of the log, asked for a label, a category and the supporting log lines.

Metrics: macro-F1 over the two labels, precision on "flaky" (calling a real bug flaky is the costly mistake, because it gets re-run and ignored), and the share of AI decisions whose quoted lines really appear in the log.

Pass when Gemini beats the keyword rules by at least 10 points of macro-F1, has flaky precision no lower than the rules, and at least 95% of its quoted lines are found in the log. Labels come from re-runs, never from the model under test.

If it does not pass: report it here, then either ship the dataset and the deterministic extractor without the AI step, or reject the idea. Do not hide the result.

## Gate 2: user validation
**Waived by the owner, as for the earlier portfolio projects.** Demand is **not validated**, and nothing in the README, docs, commits or profile text may claim demand, users or validation.

## Gate 3: narrow MVP
After Gates 0 and 1. A CLI (and a GitHub Action) that takes a failed job, trims the log, classifies it, quotes and verifies its evidence lines, and writes a short report to the job summary; plus the evaluation that keeps it honest in CI. Measurable success criteria are fixed in `PLAN.md` before building.

## Log
| Date | Gate | Result |
|---|---|---|
| 2026-11-19 | Research | Started. Re-run labels exist but are rare (~1.3% of 8,000 runs in 8 repos); approval waits and summary jobs must be excluded; logs are fetchable. Copilot already explains failed jobs. Free-tier text limits unpublished. See `PRODUCT_RESEARCH.md`. |
| 2026-11-20 | Gate 0 | Collector built (TypeScript). First partial sample: 273 labelled jobs (95 flaky, 178 real) from 129 runs in 4 repos. Size and class minimums met; repos 4 of 5; label mix differs strongly by repo, so splits must be by repo or run. Log terms and Gemini limits still open. See `docs/DATA.md`. |
| 2026-11-21 | Gate 0 | Log trimmer reviewed on 12 real logs: cause kept in 11 (the 12th log has no cause, cut off). Found identical compile-error text labelled flaky in 2 jobs and real in 1, so labels from re-runs cap achievable accuracy. See `docs/TRIM.md`. |
