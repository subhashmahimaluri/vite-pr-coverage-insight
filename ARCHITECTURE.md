# Architecture — Coverage Insight v2

Target architecture for evolving `vite-pr-coverage-insight` from a single-purpose GitHub Action into an extensible, AI-augmented coverage intelligence platform for enterprise CI/CD. Horizon: 2026–2028.

## 1. Where we are (v1)

- Single GitHub Action (`node16` runtime — **deprecated by GitHub**, must move to `node20`/`node24`)
- ~690 LOC TypeScript; reads two Istanbul `coverage-summary.json` files, diffs totals + per-file metrics, posts a markdown PR comment or Check Run
- No unit tests, no CI, no linting; duplicate dead modules (`src/compareCoverage.ts` vs `src/utils/compareCoverage.ts`, `src/formatMarkdown.ts` vs `src/utils/formatMarkdown.ts`)
- GitHub-only, Istanbul-only, no history, no thresholds enforcement, no extensibility

## 2. Design principles

1. **Core/adapter separation** — coverage logic never imports CI- or AI-specific code. Adapters wrap the core.
2. **Plugin-first** — parsers, analyzers, and reporters are plugins behind stable interfaces. New capability = new plugin, not a core change.
3. **AI is optional and additive** — every AI feature degrades gracefully to a deterministic report when no API key/agent runtime is present. Enterprise clients can disable AI entirely (air-gapped mode).
4. **Deterministic artifacts** — same inputs always produce the same report; AI commentary is clearly marked as generated.
5. **Bring-your-own-model** — agent layer targets Claude first but speaks a provider interface (Anthropic API, Bedrock, Vertex) since enterprises mandate specific clouds.

## 3. Target structure (monorepo)

```
packages/
  core/                 @coverage-insight/core
    parsers/            istanbul-json, lcov, v8, cobertura, jacoco (interface: CoverageParser)
    diff/               compare base vs head, changed-files-aware via git diff
    policy/             threshold rules, ratchet ("never decrease"), per-path overrides
    model/              normalized CoverageModel (single internal schema)
  reporters/            @coverage-insight/reporters
    markdown/           PR comment: delta tables, severity icons, SVG sparkline badges
    html/               self-contained interactive HTML artifact (file tree, charts, line view)
    json/               machine-readable output (feeds dashboards, agents, SARIF-style)
    junit-annotations/  inline PR annotations on uncovered changed lines
  history/              @coverage-insight/history
    stores/             git-branch store (default, zero-infra), S3/GCS, SQLite artifact
    trends/             time-series per branch/team; powers trend charts + ratchet policy
  agents/               @coverage-insight/agents
    runtime/            provider abstraction (Anthropic, Bedrock, Vertex), budget/timeout guards
    coverage-analyst/   explains drops, ranks risk of uncovered changed code
    test-suggester/     drafts test skeletons for uncovered branches/functions
    pr-risk-reviewer/   combines coverage + diff + failures into a risk verdict
  adapters/
    action/             GitHub Action (node24), thin wrapper over core
    cli/                `covins` CLI — GitLab/Jenkins/Azure/local use
  skills/               Claude Code / Cowork plugin
    coverage-review/    "review coverage on this PR" skill
    write-missing-tests/ skill that reads json report + source, writes tests
```

Tooling: **npm workspaces** (lowest common denominator — many enterprises disallow pnpm; contributors may use other PMs locally but `package-lock.json` is the only lockfile), tsup builds, Vitest, ESLint + Prettier, changesets for versioning, GitHub Actions CI (lint → test → build → e2e against fixture repos).

## 4. Data flow

```
coverage files ─► parser plugin ─► CoverageModel ─► diff engine ─► PolicyResult
                                        │                              │
                              history store (read/write)              ▼
                                        │                    reporters (md/html/json)
                                        ▼                              │
                                 agent layer (optional) ◄──────────────┘
                                        │
                              AI commentary + suggestions merged into reports
```

The normalized `CoverageModel` is the contract everything depends on. Parsers map any format into it; reporters and agents only consume it.

### Performance: single-test-run pipeline

v1's biggest cost: PR workflows run the full test suite **twice** (base + head). v2 eliminates the base run entirely. A baseline workflow on every push to main runs tests once and publishes `coverage-summary.json` to an orphan `coverage-baseline` git branch plus `actions/cache` (keyed by SHA). PR workflows test only HEAD, then the action resolves the baseline: merge-base SHA → cache → branch lookup → nearest-ancestor walk (≤50 commits, staleness noted) → graceful no-baseline report. One main-branch run is amortized across all PRs; PR CI wall time roughly halves. The same branch doubles as the trend-history store for sparklines. Full design: `docs/plan/phase-2-performance.md`.

## 5. Agent layer (the differentiator)

Three pipeline agents, each a small, auditable unit with a strict JSON contract:

| Agent            | Input                                          | Output                                           | Guardrails                                     |
| ---------------- | ---------------------------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| coverage-analyst | diff result + changed-file source snippets     | ranked risk findings, plain-English summary      | token budget, no code execution                |
| test-suggester   | uncovered lines/branches + surrounding source  | test skeletons (framework-aware: Vitest/Jest)    | suggestions only; never commits                |
| pr-risk-reviewer | analyst output + test failures + policy result | verdict: approve-signal / warn / block-recommend | advisory by default; blocking is opt-in policy |

Enterprise controls: model allowlist, max-spend per run, PII/source-redaction option (send only file paths + metrics, not code), full prompt/response audit log emitted as a CI artifact.

## 6. Skills (Claude Code / Cowork)

Ship the repo as an installable plugin exposing skills that reuse the same `json` report and agent prompts:

- `coverage-review` — dev asks "how's coverage on PR #123"; skill pulls the JSON artifact, summarizes, links HTML report.
- `write-missing-tests` — reads uncovered ranges, opens the source, writes real test files locally (interactive, unlike the CI suggester).
- `coverage-trends` — queries the history store, renders trend summary.

Same core, three surfaces: CI agent (automated), CLI (manual), skill (conversational).

## 7. Report visuals

- **PR comment (default):** overall delta header with ✅/⚠️/❌, per-metric SVG badge sparklines (last N runs from history), changed-files-only table, collapsible full table, "top 5 riskiest uncovered changes" section (agent-generated when enabled).
- **HTML artifact:** single self-contained file (inline JS/CSS, no CDN — air-gap safe): sunburst/treemap of coverage by directory, sortable file table, per-file line-level view, trend charts, dark mode. Uploaded as CI artifact and optionally published to GitHub Pages.
- **JSON:** stable versioned schema (`schemaVersion`) — the integration surface for dashboards, skills, and customer tooling.

## 8. Enterprise readiness checklist

- Runtime: Node 24, provenance-signed releases (SLSA), pinned action by SHA docs
- Security: no source code leaves CI unless AI explicitly enabled; redaction mode; SBOM published
- Multi-CI: CLI exit codes map to policy verdicts so Jenkins/GitLab gate natively
- Config: `coverage-insight.config.{ts,json}` with per-path thresholds, ratchet, monorepo project mapping
- Docs: versioned docs site, migration guide from v1 inputs (backward-compatible `action.yml`)

## 9. Decisions log

| Decision              | Choice                                                    | Why                                                                                      |
| --------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Repo shape            | **npm workspaces** monorepo, keep this repo               | enterprise-safe (no pnpm requirement); preserve history; packages publishable separately |
| Base coverage         | never computed in PR workflows                            | baseline store on main-branch pushes; PR CI time ~halved (see Performance section)       |
| AI packaging          | separate `packages/agents`, dynamic import, default `off` | air-gapped enterprises omit it entirely; AI off ⇒ byte-identical deterministic report    |
| Default history store | git branch (`coverage-history`)                           | zero infrastructure; S3 optional for scale                                               |
| AI provider           | Anthropic-first behind provider interface                 | quality + enterprise Bedrock/Vertex paths                                                |
| HTML report           | single static file, no server                             | air-gap + artifact-friendly; hosted dashboard deferred to Phase 4+                       |
| v1 compatibility      | keep existing action inputs working                       | existing users upgrade with zero workflow changes                                        |
