# PLAN.md

Status as of 2026-11-21: research done; Gate 0 in progress. The label collector (`docs/DATA.md`), CI and the log trimmer (`docs/TRIM.md`) work; language is TypeScript.

## Phases
1. **Research**: done (2026-11-19). See `PRODUCT_RESEARCH.md`.
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
- [x] Language: TypeScript, Node 22 (2026-11-20; same setup as rag-gate).
- [x] GitHub repo `CodeAvk/ci-triage` created by the owner (2026-11-19).
- [ ] Check GitHub's terms for storing public Actions logs.
- [x] Label collector over date windows and repos, with exclusion counts (2026-11-20): window splitting past the 1,000-run cap, request budget, clean stop; first sample 273 labelled jobs.
- [ ] Add a fifth repository and a longer window, holding out whole repositories for evaluation.
- [x] CI on every push: typecheck, tests, audit (2026-11-21).
- [x] Log trimmer: cut a job log to the failing window deterministically (2026-11-21). Cause kept in 11 of 12 reviewed logs; the 12th has none.
- [ ] Keyword baseline and metrics on the dev set.
- [ ] Gemini classifier with evidence check, dev set only, then a single held-out run.
