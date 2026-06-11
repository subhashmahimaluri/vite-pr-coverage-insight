# Design spike: org-level coverage rollup (Stage 6.4 — design only)

Status: **design spike, not scheduled** — build only if clients ask.

## Problem

Engineering leadership wants one view of coverage across N repos: which repos
are trending down, which gates fail most, where the uncovered hot spots are.
Today each repo's `coverage-baseline` branch is an island.

## Design

Zero new infrastructure — reuse the per-repo history branches as the data
layer and publish a static dashboard:

```
repo-a  coverage-baseline ──┐
repo-b  coverage-baseline ──┼──► rollup workflow (cron, org "metrics" repo)
repo-c  coverage-baseline ──┘        │ reads baselines/<sha>.json via API
                                     ▼
                       org-coverage.json (schemaVersion'd, per repo:
                       latest totals, 30-point series, verdict)
                                     │
                                     ▼
                       static HTML dashboard (same self-contained
                       renderer tech as packages/reporters/html)
                       published to GitHub Pages of the metrics repo
```

- **Collector**: a scheduled workflow in a dedicated `org-metrics` repo with a
  fine-grained PAT (read-only `contents` on selected repos). For each repo:
  read `index.json` + the newest ≤30 baseline entries → totals series. No
  test runs, no checkouts — pure API reads (~3 requests/repo).
- **Aggregate artifact**: `org-coverage.json` with `schemaVersion: 1`,
  `[{repo, defaultBranch, latest: {metrics, sha, timestamp}, series:
  HistoryPoint[], policy?: latest verdict}]`. Same D6 philosophy: the
  dashboard and any future agent consume only this.
- **Dashboard**: one self-contained HTML file (reuse `packages/history`
  sparklines + `packages/reporters/html` table/treemap components): org
  totals, per-repo rows with 30-run sparkline, sortable by delta, red/amber
  filter. Published via `actions/deploy-pages`.

## Sizing

~1 day collector + ~2 days dashboard reusing existing renderers; no new
packages — `packages/history` already exposes the series/sparkline API.

## Open questions

- Monorepo projects (Stage 6.3): roll up per project or per repo? Proposal:
  per project, keyed `repo#project`.
- Retention: history branches prune at 200 entries; the rollup snapshots the
  series, so the metrics repo becomes the long-term archive (append-only
  `archive/<repo>/<date>.json`).
- Private-repo raw URLs don't work on Pages — the collector must inline
  everything into the artifact (it does; the dashboard makes zero requests).
