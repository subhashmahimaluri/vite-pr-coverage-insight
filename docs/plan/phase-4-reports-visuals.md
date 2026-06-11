# Phase 4 — Reports & visuals

Goal: the report UX designed in planning — all states, richer visuals, history, HTML artifact.

## Report state matrix (the contract)

| # | State | Trigger | Header |
|---|---|---|---|
| 1 | Passed | gate met, tests pass | ✅ Coverage gate passed |
| 2 | Threshold failed | metric < threshold | ❌ Coverage gate failed + compliance table + "shortest path to green" |
| 3 | Tests failed | failed suites in input | 🛑 Failure mode: failed suites/tests first, coverage marked partial, gate deferred |
| 4 | Regression | any file decreased | 🔻 Regressions section (severity: critical >5pp or below path threshold; warning = any drop; "touched / indirect" tag) |
| 5 | No baseline | first run / unresolvable | ℹ️ Baseline recorded — absolute numbers only |
| 6 | Invalid data | missing/corrupt input | ⚠️ Error report: which input, what was wrong, how to fix |
| 7 | No change | zero coverage delta | single-line minimal comment |
| 8 | Monorepo | multiple projects | per-package verdict rows, expandable |

Cross-state rules: one comment updated in place (D5); verdict in line 1 (visible in notification previews); thresholds always shown next to actuals; JSON artifact emitted in **every** state (D6); AI sections fenced + labeled `generated` (D7); changed files always before full table (full table collapsed).

## Stage 4.1 — JSON reporter (versioned schema)

Steps: `packages/reporters/json` — `coverage-report.json` with `schemaVersion: 1`: totals, per-file metrics + deltas, uncovered ranges, PolicyResult, test failures, state id, baseline meta (sha, staleness). Uploaded as artifact every run. This is the integration surface for HTML, agents, skills.

Accept: JSON schema file published in repo; schema validated in tests; every state 1–8 produces valid output.

**Prompt:**
> Implement the versioned JSON reporter per docs/plan/phase-4-reports-visuals.md stage 4.1. Define schema v1 as a zod schema exported from packages/core (single source of truth), generate coverage-report.json containing state id, totals with deltas, per-file results, uncovered ranges, PolicyResult violations, test failures, baseline metadata. The action uploads it as an artifact in all states including errors. Tests: every report state 1-8 from the state matrix produces schema-valid JSON.

## Stage 4.2 — Markdown renderer v2 (all 8 states)

Steps: rewrite `packages/reporters/markdown` as a state machine over the JSON report: implement the 8 states + cross-state rules above; changed-files table first; collapsible full table; regression section with severity badges; threshold compliance table; "shortest path to green" (rank files by violation contribution); failed-suites section with error excerpts (truncate at 10 lines per test, 5 tests per suite).

Accept: snapshot test per state; comment under GitHub's 65k char limit even for 500-file repos (auto-truncate with link to HTML report).

**Prompt:**
> Rewrite the markdown PR comment renderer per docs/plan/phase-4-reports-visuals.md stage 4.2. Input is only the stage 4.1 JSON report. Implement all 8 states and the cross-state rules (in-place comment marker, verdict first line, changed-files first, collapsed full table, regression severity badges, threshold compliance table with gap column, shortest-path-to-green ranking, failed-suite excerpts truncated sensibly). Enforce GitHub's 65536-char comment limit with graceful truncation that links to the HTML artifact. Snapshot tests for each state plus a 500-file truncation test.

## Stage 4.3 — Trend history & SVG badges

Steps: extend the `coverage-baseline` branch into the history store (it already has one JSON per main commit — Phase 2 synergy); `packages/history` reads last N entries; render per-metric **SVG sparklines + delta badges** committed to the history branch and embedded in the comment via raw URLs (GitHub markdown can't inline SVG — must be image links); shields.io-style endpoint JSON for README badges.

Accept: comment shows 30-run sparkline images; badge URLs stable; works on private repos (raw URL auth caveat documented, fallback: unicode mini-chart `▁▂▄▆█`).

**Prompt:**
> Implement trend history and badges per docs/plan/phase-4-reports-visuals.md stage 4.3. packages/history: read the coverage-baseline branch (from phase 2) as a time series, expose lastN(metric). Generate compact SVG sparklines and delta badges per metric, commit them to the history branch under badges/, reference them as images in the PR comment. Add a unicode block-character sparkline fallback (config flag, default on for private repos where raw URLs need auth). Also emit a shields.io endpoint JSON for README badges. Test SVG generation deterministically (fixed series in, exact SVG out).

## Stage 4.4 — Interactive HTML artifact

Steps: `packages/reporters/html` — **single self-contained file** (inline CSS/JS, zero CDN — air-gap safe): verdict header, trend chart with threshold line, directory treemap colored by coverage, sortable file table, per-file uncovered-lines view (needs lcov/v8 detail when available), dark mode, search. Uploaded as artifact; optional GitHub Pages publish workflow.

Accept: file <1.5 MB, opens from `file://`, no network requests (assert in test via CSP meta + grep for http); renders the same JSON report the comment used.

**Prompt:**
> Build the self-contained HTML report per docs/plan/phase-4-reports-visuals.md stage 4.4. One template in packages/reporters/html that inlines all CSS/JS (no CDN, no external requests — must open from file:// in an air-gapped env), embedding the stage 4.1 JSON. Sections: verdict header, line-coverage trend chart with threshold line (hand-rolled SVG, no chart lib), CSS-grid treemap of directories colored green/amber/red by coverage, sortable+searchable file table, per-file uncovered line viewer when line detail exists. Dark mode via prefers-color-scheme. Keep under 1.5MB; add a test asserting zero external URLs in output. Provide an optional gh-pages publish workflow example.
