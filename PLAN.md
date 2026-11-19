# PLAN.md

Status as of 2026-11-19: research started. No product code yet.

## Phases
1. **Research**: in progress. See `PRODUCT_RESEARCH.md`.
2. **Gate 0, data and terms**: a collector for re-run labelled jobs across public repos; log storage terms checked; free-tier limits recorded.
3. **Gate 1, AI versus baselines**: keyword rules and always-real versus Gemini on a held-out set. Reject or narrow if AI does not win.
4. **Gate 2, user validation**: waived. Demand is not validated and is never claimed.
5. **Gate 3, MVP**: CLI and GitHub Action; success criteria below.
6. **Publish**: each push follows `CLAUDE.md`.

## MVP success criteria (draft, to confirm after Gate 1)
- On the held-out set, the Gemini classifier meets the Gate 1 bar, and the result is reproducible from frozen data and a stored config.
- Every reported decision quotes log lines, and a deterministic check confirms they exist; a decision whose quote is not found is reported as "unsure".
- One failed job costs at most one free-tier request, usually less through batching and caching.
- Tests cover the label collector, the log trimmer, the baselines, the evidence check and the metrics.

## Next actions
- [ ] Decide the language before the first code commit (owner).
- [ ] Owner: create the GitHub repo `CodeAvk/ci-triage` (the push token cannot create repositories).
- [ ] Check GitHub's terms for storing public Actions logs.
- [ ] Label collector over date windows and repos, with exclusion counts.
- [ ] Log trimmer: cut a job log to the failing window deterministically.
- [ ] Keyword baseline and metrics on the dev set.
- [ ] Gemini classifier with evidence check, dev set only, then a single held-out run.
