# CLAUDE.md — ci-triage rules

Personal portfolio project. Owner's GitHub account: `CodeAvk` (https://github.com/CodeAvk). Planned repo: `CodeAvk/ci-triage`.

## Product requirements
- AI must do real work: classify a failed CI job as flaky or real, and quote the log lines that support it. A chatbot that "explains the error" does not qualify; GitHub Copilot already does that.
- The AI step must beat deterministic baselines (keyword rules, always "real") on a measured held-out set. If it does not, record that in `PRODUCT_RESEARCH.md` and drop or narrow it.
- Use free-tier AI APIs (Gemini). No local or built-in models. If no free API fits, use deterministic logic. Never present canned output as AI output.
- Verify free-tier limits and data terms on the provider's own page before relying on them. Free-tier content may be used to improve the provider's products, so send only logs from public repositories, never private logs. Stay inside free quota.
- Labels come from GitHub re-runs, never from the model under test. Never fabricate interviews, demand, benchmarks or sources. Mark unverified claims as unverified.
- Gates in `VALIDATION_PLAN.md` apply, except Gate 2 (user interviews), which the owner waived. Never claim user demand or validation anywhere. Say "demand not validated".

## Git and GitHub safety
- The machine's global git identity is a work identity. Never commit or push with it. This repo uses a repo-local identity: `CodeAvk` / `avksmlavk@gmail.com`.
- Before any push, check `git config user.name`, `git config user.email` and `git remote -v` (destination must be `CodeAvk/ci-triage`). If anything is ambiguous, stop and report.
- Never push to company repos. Never copy company code, secrets, data or proprietary material here. Keep employer details out of this repo, and use only public open-source repositories as data sources.
- Keys and tokens live in a git-ignored `.env`, never in the repo, never printed. Run tests, a secret scan and a dependency audit before every push.
- One feature per commit, pushed when finished, tested and verified. No fake, backdated or filler commits. No AI co-author trailers on commits.

## Data
- Store run and job ids, labels and short excerpts. Do not commit full logs until GitHub's terms for redistributing them are checked. Record each data source and its licence or terms next to the data.
