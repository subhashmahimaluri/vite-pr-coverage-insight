# Roadmap — Coverage Insight v2 (2026–2028)

Six phases. Each ships independently and keeps the existing Action working throughout. Effort assumes part-time solo development; halve timelines with a second contributor.

## Shipped June 2026 — AI-assisted coverage & dual-run (out of band)

Ported from the sibling [pr-review-insight](https://github.com/subhashmahimaluri/pr-review-insight). The strategy for AI: **produce prompts and context, not API calls** — teams already pay for Copilot/Claude/Cursor; the action hands them perfect context, no vendor keys needed.

- [x] 🚦 **Coverage gate card** leading the metric band (PASS/FAIL + policy subtitle + trend sparkline)
- [x] **Unique per-run band filenames** — camo/raw CDN cache by path; fixed paths served stale bands
- [x] **Dual-run baselines** (`baseline-mode: scan`) — test the merge-base in a temp git worktree in the same job; zero-setup alternative to the baseline branch (needs `fetch-depth: 0`)
- [x] **Coverage fix plan** (`coverage-fix-plan.md`) — changed files with gaps first, one paste-ready AI test prompt each (with uncovered line ranges); repo-wide debt as a batch prompt
- [x] 🤖 **Cover with AI** block in the PR comment (top 5 changed files with gaps)
- [x] **`covins emit-instructions`** — writes the coverage policy into `.github/copilot-instructions.md` (idempotent, marker-delimited) so assistants ship tests with the code they write
- [x] **Built-in artifact upload** — JSON + HTML + fix plan on every run, 📥-linked from the comment footer
- [ ] `gh`-native fix loop (`gh run download` → Copilot Workspace per fix-plan item)
- [ ] **Patch coverage gate** — % of the PR's added lines covered, as a first-class gate next to totals/ratchet
- [x] **🧬 Mutation score** (display + AI loop) — `mutation:` input ingests Stryker's json report: band card with score + Δ vs the baseline's recorded score, surviving-mutants-in-changed-files table in the comment, kill prompts in the fix plan. Plan: [pr-review-insight/docs/test-strength-plan.md](https://github.com/subhashmahimaluri/pr-review-insight/blob/main/docs/test-strength-plan.md)
- [ ] **🧬 Mutation gate** (blocking) — fail the job on surviving mutants in changed files / score drop vs base, once teams have lived with the display tier
- [ ] Test-strength dogfood — fast-check property tests (truncation budget, parser invariants) + Stryker nightly on `packages/core`, mirroring the sibling repo
- [ ] Band pruning — clean old `badges/pr-*/` files during baseline runs

## Phase 1 — Foundation (Q3 2026, ~4–6 weeks)

Goal: trustworthy base. No new features until this is done.

- [ ] Upgrade Action runtime `node16` → `node24`; bump deps; pin tooling
- [ ] Delete duplicate modules (`src/compareCoverage.ts`, `src/formatMarkdown.ts`, `src/postComment.ts` — keep `utils/` versions); single source of truth
- [ ] Convert to npm workspaces monorepo: `packages/core`, `packages/adapters/action` (npm, not pnpm — enterprise compatibility)
- [ ] Extract normalized `CoverageModel`; move diff logic into `core/diff`
- [ ] Vitest unit tests for diff + formatting (fixture-driven, target ≥90% on core — eat our own dog food)
- [ ] CI: lint, typecheck, test, build, e2e against a fixture repo; run this Action on its own PRs
- [ ] ESLint + Prettier + changesets

Exit criteria: green CI, v1-compatible Action published as `v2.0.0-beta`, zero dead code.

## Phase 2 — Packaging & policy (Q4 2026, ~4 weeks)

Goal: works beyond GitHub; coverage gates enterprises can enforce.

- [ ] `covins` CLI (`compare`, `report`, `check`) with exit codes for any CI
- [ ] Parser plugins: lcov + v8 raw output (beyond istanbul summary); parser auto-detection
- [ ] Policy engine: global + per-path thresholds, ratchet mode, `coverage-insight.config.ts`
- [ ] Changed-files-aware diff (git diff integration) — report what the PR touched, not the whole repo
- [ ] Inline PR annotations on uncovered changed lines (Check Run annotations)

Exit criteria: same report from GitHub Action, GitLab CI, and Jenkins on demo repos.

## Phase 3 — Visuals & history (Q1 2027, ~6 weeks)

Goal: reports people actually want to read.

- [ ] JSON reporter with versioned schema (integration surface for everything later)
- [ ] Richer PR comment: severity icons, changed-files-first layout, collapsible sections, SVG delta badges
- [ ] History store (git-branch default, S3 optional); trend sparklines in PR comment
- [ ] Self-contained interactive HTML artifact: treemap by directory, sortable tables, per-file line view, trend charts, dark mode
- [ ] Optional GitHub Pages publishing workflow

Exit criteria: HTML report demo-able to a client; trends visible after 5 PRs on a repo.

## Phase 4 — AI agents in CI (Q2–Q3 2027, ~8 weeks)

Goal: the differentiator — explain, don't just measure. All opt-in.

- [ ] Agent runtime: provider abstraction (Anthropic API, Bedrock, Vertex), token budgets, timeouts, prompt/response audit artifact
- [ ] `coverage-analyst`: plain-English summary + ranked risk of uncovered changed code in the PR comment
- [ ] `test-suggester`: Vitest/Jest test skeletons for uncovered branches, posted as collapsible suggestions
- [ ] `pr-risk-reviewer`: advisory verdict combining coverage, diff, and test failures; opt-in blocking mode
- [ ] Redaction mode (metrics-only, no source sent) for strict enterprises; AI fully disabled by default

Exit criteria: AI sections render on real PRs; disabling AI yields byte-identical deterministic report.

## Phase 5 — Skills & plugin surface (Q4 2027, ~4 weeks)

Goal: meet developers where they work — conversational surface over the same core.

- [ ] Package as Claude Code / Cowork plugin
- [ ] `coverage-review` skill: summarize a PR's coverage from the JSON artifact
- [ ] `write-missing-tests` skill: interactively write real test files for uncovered code locally
- [ ] `coverage-trends` skill: query history store, summarize direction
- [ ] Plugin marketplace listing + docs

Exit criteria: install plugin → ask "review coverage on PR #N" → grounded answer with links.

## Phase 6 — Enterprise hardening & scale (2028)

Goal: procurement-ready.

- [ ] Signed releases (SLSA provenance), SBOM, pin-by-SHA docs
- [ ] Monorepo project mapping (per-package thresholds/reports in one repo)
- [ ] Org-level rollup: aggregate trends across repos (S3/SQLite store + static dashboard)
- [ ] Performance: stream-parse large lcov (>100k lines), <10s p95 action runtime
- [ ] Evaluate hosted dashboard as commercial tier (decide, don't assume)

## Risks & mitigations

| Risk                                                  | Mitigation                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| GitHub deprecates node16 actions before Phase 1 ships | Phase 1 runtime bump is the very first task                      |
| AI cost/trust blocks enterprise adoption              | opt-in, budgets, redaction, audit logs (Phase 4 design)          |
| Scope creep into hosted SaaS                          | static-artifact-first; SaaS is an explicit Phase 6 decision gate |
| Solo-maintainer bus factor                            | tests + CI from Phase 1; changesets make releases mechanical     |

## North-star metrics

Adoption: workflows using the action; retention: repos still posting after 90 days; AI value: % of suggested tests merged; enterprise: non-GitHub CI installs via CLI.
