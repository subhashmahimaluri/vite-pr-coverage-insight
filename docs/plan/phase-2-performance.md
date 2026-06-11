# Phase 2 — Performance: single-run pipeline

**The problem:** today every PR workflow runs the full test+coverage suite **twice** — once on the base branch, once on the PR branch — just to get two coverage files to diff. That doubles CI time and cost on every PR.

**The fix:** never compute base coverage in a PR workflow. Compute it **once per main-branch commit** in a separate workflow, store it, and let every PR fetch it. One main-branch run is amortized across all PRs targeting it.

```
push to main ──► baseline workflow ──► test+coverage (once)
                                          │
                                          ▼
                              baseline store (git branch `coverage-baseline`
                                + actions/cache keyed by SHA)
                                          │
PR opened ──► PR workflow ──► test+coverage on HEAD only (once)
                  │                       │
                  └──► resolve baseline by merge-base SHA ◄┘
                                │
                  cache hit? → branch lookup? → ancestor walk (≤50)
                                │                    │
                                ▼                    ▼ none found
                          diff + report      "no baseline" report
                                             (absolute numbers only)
```

Expected result: PR CI wall time ≈ **halved** immediately; additionally the baseline store doubles as the trend-history store for Phase 4 sparklines — one mechanism, two features.

## Stage 2.1 — Baseline publisher workflow

Steps: new reusable workflow `baseline.yml` (and composite action `coverage-insight/baseline`): on push to default branch, run tests with coverage, write `{sha, ref, timestamp, coverage-summary.json}` to orphan git branch `coverage-baseline` (one JSON per commit, pruned to last 200), and save to `actions/cache` with key `covins-baseline-${sha}`.

Accept: pushing to main produces a commit on `coverage-baseline` containing the summary keyed by SHA; cache entry exists; runtime overhead of store step <5s.

**Prompt:**

> Implement the baseline publisher from docs/plan/phase-2-performance.md. Create packages/action/src/baseline.ts and a second action entry (action-baseline.yml or a `mode: baseline` input): given a coverage-summary.json path, commit it to an orphan branch coverage-baseline as baselines/<sha>.json with a meta header (sha, ref, timestamp), prune to the newest 200 entries, and also save it to actions/cache with key covins-baseline-<sha>. Include a reusable workflow example in docs. Unit-test the pruning and path logic; e2e-test against this repo.

## Stage 2.2 — Baseline resolver in the action

Steps: in PR mode, resolve base coverage automatically: compute `merge-base` SHA → try `actions/cache` → try `coverage-baseline` branch via API → walk first-parent history (≤50 commits) for nearest ancestor baseline (report "baseline is N commits behind") → else emit the **no-baseline report state**. Keep explicit `base:` input working (D4) as an override.

Accept: PR workflow with no `base` input produces a correct diff using stored baseline; ancestor fallback and no-baseline paths covered by tests; resolution adds <3s.

**Prompt:**

> Implement the baseline resolver from docs/plan/phase-2-performance.md stage 2.2. In PR mode the action must auto-resolve base coverage: merge-base SHA via octokit compare API, then actions/cache restore, then fetch baselines/<sha>.json from the coverage-baseline branch, then walk first-parent ancestors (max 50) accepting the nearest baseline and noting staleness in the report, finally a graceful no-baseline report showing absolute coverage only. The existing explicit base input must still override everything. Mock octokit in tests; cover all four resolution paths.

## Stage 2.3 — Single-run workflow templates & migration guide

Steps: rewrite README quick-start: PR workflow runs `npm test -- --coverage` once on HEAD + the action; baseline workflow on main. Add `docs/migration-v1-to-v2.md` showing before (2 runs) / after (1 run) with measured timings. Add `concurrency: cancel-in-progress` and `actions/setup-node` dependency caching to all templates.

Accept: a fresh repo following the quick-start gets PR comments with a single test run; templates lint clean with actionlint.

**Prompt:**

> Rewrite the README quick-start and add docs/migration-v1-to-v2.md per docs/plan/phase-2-performance.md stage 2.3. Provide two copy-paste workflows: coverage-baseline.yml (on push to main, single test run, publish baseline via the action's baseline mode) and pr-coverage.yml (single HEAD test run, action auto-resolves baseline). Both with setup-node npm caching and concurrency cancel-in-progress. Include a before/after table explaining why this halves CI time. Validate workflows with actionlint.

## Stage 2.4 — Optional further speedups

Steps (each opt-in, documented, off by default): vitest `--changed`-style affected-only test runs with full-run nightly safety net; test sharding matrix for large suites with coverage merge (`istanbul-merge`/`nyc merge`); skip-on-docs-only-PR path filter.

Accept: docs section "Going faster" with tradeoffs; sharded fixture run merges to identical totals as single run.

**Prompt:**

> Add the opt-in speedups from docs/plan/phase-2-performance.md stage 2.4: (1) document affected-only testing with vitest --changed plus a nightly full-coverage workflow that refreshes the baseline, with an honest tradeoffs section; (2) support merged coverage input — accept a directory of coverage-summary.json shards and merge them before diffing, with tests proving merged totals equal a single run; (3) docs for paths-filter to skip the action on docs-only PRs.
