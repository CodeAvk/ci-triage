# CI Triage

[![ci](https://github.com/CodeAvk/ci-triage/actions/workflows/ci.yml/badge.svg)](https://github.com/CodeAvk/ci-triage/actions/workflows/ci.yml)

A planned tool that reads a failed GitHub Actions job, decides whether the failure is **flaky** (a re-run would pass) or **real**, and quotes the log lines that support the decision, checked to exist. It is measured against simple non-AI baselines on public jobs labelled by GitHub re-runs, and the AI step is kept only if it wins.

> **Status: Gate 0 (data).** The label collector and the log trimmer work; no classifier yet. This is a portfolio project; demand has not been validated.

## Collect labelled jobs

Needs Node 22 and a GitHub token in `GITHUB_TOKEN` (read access to public repositories is enough).

```
npm install
npm test
npm run collect -- --repos vercel/next.js,pytorch/pytorch --since 2026-11-16 --until 2026-11-18 --max-requests 1500
```

It writes `data/labels/<owner>__<repo>.jsonl` (one labelled failed job per line), a `.runs` file of processed runs so a repeated command skips them, and `summary.json` with what was excluded and why. How labels are made and the first results: [docs/DATA.md](docs/DATA.md).

## Trim a job log

```
npm run trim -- path/to/job.log [--budget 6000]
```

Prints the lines that explain the failure, with their original line numbers, inside a character budget. How it chooses and a review on 12 real logs: [docs/TRIM.md](docs/TRIM.md).

## Documents

- [PRODUCT_RESEARCH.md](PRODUCT_RESEARCH.md): the idea, how labels are obtained, prior research, competitors, the free-tier terms and risks
- [VALIDATION_PLAN.md](VALIDATION_PLAN.md): the gates to pass before building
- [PLAN.md](PLAN.md): phases, draft success criteria and next actions
- [docs/DATA.md](docs/DATA.md): how failed jobs are labelled, and the first collection
- [docs/TRIM.md](docs/TRIM.md): the log trimmer and what a review of 12 logs showed
