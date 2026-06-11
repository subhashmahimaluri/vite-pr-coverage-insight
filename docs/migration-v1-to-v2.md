# Migrating from v1 (two test runs) to v2 (single run)

## Why migrate

v1 PR workflows ran your full test+coverage suite **twice** — once on the PR
head and once on a fresh checkout of `main` — just to produce two
`coverage-summary.json` files to diff. v2 removes the base run entirely: a
baseline workflow runs coverage **once per main-branch push** and stores it;
every PR fetches that stored baseline by merge-base SHA.

|                                    | v1 (before)                  | v2 (after)                                                  |
| ---------------------------------- | ---------------------------- | ----------------------------------------------------------- |
| Test runs per PR push              | 2 (head + main checkout)     | **1** (head only)                                           |
| Test runs per main push            | 0                            | 1 (amortized across all PRs)                                |
| PR wall-clock (suite of T minutes) | ~2×T + 2 installs            | ~T + 1 install                                              |
| Base accuracy                      | main at PR time (race-prone) | exact merge-base SHA (or nearest ancestor, staleness shown) |

For a 6-minute suite that's roughly **13 min → 7 min** per PR push — about
half — and the saving grows with suite size since installs amortize too.

## Steps

1. **Add the baseline workflow** — copy
   [examples/workflows/coverage-baseline.yml](../examples/workflows/coverage-baseline.yml)
   into `.github/workflows/`. It needs `permissions: contents: write` to commit
   to the orphan `coverage-baseline` branch.
2. **Replace your PR workflow** with
   [examples/workflows/pr-coverage.yml](../examples/workflows/pr-coverage.yml):
   delete the "checkout main / install / run coverage on main" steps and the
   `base:` input. That's the whole change — `head:` stays as it was.
3. **Push any commit to `main`** (or run the baseline workflow manually) to
   seed the store. Until then PRs get the "Baseline recorded" absolute-numbers
   report instead of deltas — nothing breaks.
4. Optionally delete your old `base-coverage` artifacts/steps.

## Compatibility (decision D4)

- The explicit `base:` input **keeps working** and overrides baseline
  resolution — you can migrate one workflow at a time or never.
- All v1 inputs (`head`, `test-failures`, `use-check-run`) are unchanged.
- v1 tags keep working; the baseline store only activates when you omit
  `base:`.

## How the baseline is stored

- One JSON per main commit at `baselines/<sha>.json` on the orphan
  `coverage-baseline` branch (pruned to the newest 200), plus an `index.json`
  manifest.
- A copy goes to `actions/cache` under `covins-baseline-<sha>` for the fast
  path; cache misses fall back to the branch, then to the nearest ancestor
  (≤50 commits, staleness noted in the comment), then to the no-baseline
  report.
- The same branch doubles as the trend-history store for sparklines (Phase 4).

## Troubleshooting

- **"Baseline recorded" on every PR** — the baseline workflow isn't running on
  main, or it lacks `contents: write`, or your PRs target a branch other than
  the one publishing baselines (`baseline-branch` input must match).
- **Stale baseline note** — main moved ahead of the last baseline run (e.g.
  baseline workflow skipped on docs-only pushes). Harmless; the note shows how
  many commits behind the comparison is.
- **Fork PRs** — `GITHUB_TOKEN` is read-only on forks; resolution still works
  (reads only), but the comment post needs `pull_request_target` or a
  same-repo PR.
