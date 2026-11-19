# CI Triage

A planned tool that reads a failed GitHub Actions job, decides whether the failure is **flaky** (a re-run would pass) or **real**, and quotes the log lines that support the decision, checked to exist. It is measured against simple non-AI baselines on public jobs labelled by GitHub re-runs, and the AI step is kept only if it wins.

> **Status: research.** No product code yet. This is a portfolio project; demand has not been validated.

- [PRODUCT_RESEARCH.md](PRODUCT_RESEARCH.md): the idea, how labels are obtained, prior research, competitors, the free-tier terms and risks
- [VALIDATION_PLAN.md](VALIDATION_PLAN.md): the gates to pass before building
- [PLAN.md](PLAN.md): phases, draft success criteria and next actions
