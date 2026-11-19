# PRODUCT_RESEARCH.md

Research started 2026-11-19. Sources are linked; anything not checked on a primary source is marked **unverified**.

## The idea

When a GitHub Actions job fails, a developer has to decide quickly: is this a real bug in the change, or a flaky failure (network, timeout, runner, a test that fails at random) that a re-run will clear? CI Triage would read the failed job's log and:

1. classify the failure as **flaky** or **real**, with a category (network, timeout, dependency download, test assertion, compile error, ...);
2. quote the exact log lines that support the decision, and check deterministically that those lines exist in the log;
3. be measured against a simple non-AI baseline on labelled public data, and only kept if it beats it.

Portfolio project. Demand is not validated.

## Where labels come from (measured 2026-11-19)

GitHub keeps every attempt of a re-run workflow run. A job that **failed on attempt 1 and passed on attempt 2 with the same commit** is very likely flaky. That gives labels without hand labelling and without a model grading itself.

Measured with the REST API (`/repos/{owner}/{repo}/actions/runs`, latest 1,000 completed runs per repo):

| Repo | Runs | Re-run (`run_attempt` > 1) | Re-run and final attempt passed |
|---|---|---|---|
| nodejs/node | 1,000 | 10 | 9 |
| python/cpython | 1,000 | 6 | 6 |
| microsoft/vscode | 1,000 | 30 | 23 |
| pytorch/pytorch | 1,000 | 32 | 25 |
| vercel/next.js | 1,000 | 15 | 14 |
| rust-lang/rust | 1,000 | 3 | 3 |
| facebook/react | 1,000 | 4 | 4 |
| home-assistant/core | 1,000 | 3 | 3 |

Findings:

- Re-runs are rare: about 1.3% of runs here. A useful dataset needs many repos and a longer time window (the list endpoint returns at most 1,000 results per query, so the window has to be split by date; **unverified** for this endpoint without filters).
- **Label trap 1, approvals.** Attempt 1 of the node.js, pytorch and vscode examples I opened was `action_required` (waiting for a maintainer to approve a first-time contributor), not a failure. These must be excluded. The paper below hit the same trap at scale.
- **Label trap 2, summary jobs.** In next.js run 44564664430, attempt 1 had 110 jobs and 2 failures: a real test job and a summary job ("thank you, next", 58 log lines, `exit 1`) that fails only because another job failed. Summary jobs must be filtered out or labelled separately.
- **Job-level labels work.** In that run, the failed test job `test prod (1/10) / build` passed on attempt 2. Its log was 4,040 lines (345 KB); the cause is findable with plain patterns (`FAIL <file>`, `✕ <test>`, `● <test>`), so a deterministic baseline can already locate failures.
- **Logs are fetchable.** `GET /repos/{o}/{r}/actions/jobs/{id}/logs` redirects to blob storage; the auth header must not be forwarded across the redirect (Python's urllib forwards it and gets 401; curl does not). GitHub keeps logs for a limited time (90 days by default, **unverified** for each repo), so a dataset must be downloaded and frozen.
- **Negatives are the hard part.** A "real" label needs a job that failed and **failed again** on re-run with the same commit. In my sample those are a minority. The paper reports that 32% of its re-run builds were not flaky, so they exist, but the class balance has to be checked.

## Prior research

"Understanding and Detecting Flaky Builds in GitHub Actions", arXiv 2602.02307 ([html](https://arxiv.org/html/2602.02307v1)). Read 2026-11-19, partly verbatim, partly from a summary (marked).

- 1,960 Java projects, 4,861,768 builds. 155,488 builds were re-runs; 102,878 were excluded as approval-related (`action_required`). Of the remaining 52,610 re-run builds, 35,634 (67.73%) were flaky. Flaky builds affected about half the projects.
- One re-run is not always enough: 10,406 flaky builds needed more than one re-run (up to 20). So a label from one re-run under-counts flakiness.
- Categories of flaky failures: flaky tests 64.99%, network issues 15.8%, dependency resolution 6.32%, external environment 4.7%, API service unavailable 1.16%, and smaller ones.
- Their detector is classical ML, not an LLM: log filtering, MiniLM sentence embeddings, nearest-neighbour search over past logs, logistic regression (from the summary, **unverified**). The abstract reports up to 20.3% better F1 than an earlier baseline; absolute numbers were not in the part I read.
- They say they release two datasets, with categories at https://flaky-build.github.io/. **Licence not stated** in what I read; not usable here until a licence is confirmed. Their data is Java-only.

## Competitors and alternatives (checked 2026-11-19)

| Tool | What I confirmed | Not confirmed |
|---|---|---|
| GitHub Copilot | "Explain error" on a failed workflow run opens a Copilot chat that suggests a fix ([docs](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows)). "Fix with Copilot" investigates and pushes a fix; extended to Pro, Pro+ and Max on 2026-06-04 ([changelog](https://github.blog/changelog/2026-06-04-fix-with-copilot-for-failing-actions-now-in-pro-pro-and-max/)). | Whether it labels a failure flaky versus real; any published accuracy. |
| Mergify CI Insights | Flaky test detection for GitHub Actions using scheduled repeated runs and uploaded reports ([docs](https://docs.mergify.com/ci-insights/flaky-test-detection.md)). | Pricing; whether it reads logs or only test reports. |
| Poly | Search result describes real-time classification of CI failures as real or flaky, for GitHub Actions, GitLab CI and Jenkins. **Unverified**: I did not open its site. | Everything else. |
| Trunk, BuildPulse, Datadog CI Visibility | Not checked. | Everything. |
| DIY LLM triage | Several blog projects send failed-job logs to an LLM for a cause and a confidence score. | Any of them measuring accuracy against labels. |

What this means:

- **The space is crowded, and GitHub itself explains failed jobs.** A tool that "explains the error" adds nothing.
- The open gap, as far as I found: **measured** flaky-versus-real accuracy on public, re-run-labelled data, against a stated non-AI baseline, with each decision backed by quoted log lines that are checked to exist. None of the product pages I read publish such a number. That is a portfolio angle, not proof of demand.

## Is AI needed? (rule: AI must beat a simpler baseline)

Baselines to beat, both deterministic:

1. **Keyword rules:** known flaky signatures (`ETIMEDOUT`, `ECONNRESET`, `502 Bad Gateway`, `Could not resolve host`, `No space left on device`, runner lost, cancelled by timeout) mean flaky; anything else is real.
2. **Always "real"**, the trivial majority-class baseline if real failures dominate.

The AI step has to beat both on held-out jobs, mainly on the cases the rules cannot see: a test that failed on a timing assertion, an error message never seen before, or a network error inside a genuinely broken test. If it does not beat them by a clear margin, the product narrows to the dataset and the deterministic extractor, and the AI part is dropped (recorded here).

## Gemini free tier (checked 2026-11-19)

The docs moved from ai.google.dev to aistudio.google.com/docs (301 redirects).

- `gemini-2.5-flash-lite`: not deprecated, "served until further notice"; input limit 1,048,576 tokens. `gemini-3.5-flash-lite`: stable since 2026-07-21, free of charge on the free tier, same input limit. `gemini-2.5-flash` shuts down 2026-12-01. Source: aistudio.google.com/docs/models and /docs/deprecations.
- Free-tier text-model rate limits are **not published**; the docs point to AI Studio. In rag-gate this account measured about 20 requests a day for `gemini-2.5-flash-lite` (an earlier measurement, not re-checked). The owner should read the live numbers for `gemini-3.5-flash-lite` in AI Studio.
- Free-tier content is "used to improve our products". Public CI logs from public repositories are already public, so this is acceptable; no private logs are ever sent.
- Consequence: with roughly 20 requests a day, classifying one job per request is too slow. The design has to trim each log to the failing window and batch several jobs per request, and every result has to be cached.

## Risks

- Crowded space; GitHub Copilot explains failed jobs for free-tier users within chat limits.
- Labels are noisy: one re-run misses some flaky failures, and some "flaky" jobs are infrastructure outages, not flaky tests.
- Class balance and dataset size are unknown until a collector runs over many repos.
- Logs expire, so the dataset must be frozen with its source run ids; GitHub's terms for redistributing logs are **not checked**. Until checked, only run ids, derived labels and short excerpts should be committed, not full logs.
- Free-tier quota may be too small for a large test set.
- Without users, demand is not validated.

## Open research tasks

- [ ] Check GitHub's terms on storing and redistributing public Actions logs.
- [ ] Write a collector that walks date windows across repos and counts flaky and consistently failing jobs, after excluding approvals, cancellations and summary jobs.
- [ ] Owner: read the free-tier limits for `gemini-3.5-flash-lite` in AI Studio.
- [ ] Check the licence of the flaky-build.github.io datasets.
- [ ] Check Trunk, BuildPulse and Datadog feature pages.
