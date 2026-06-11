# Phase 6 — Skills & enterprise hardening

## Stage 6.1 — Claude Code plugin & skills

Steps: `packages/skills` shipping a Claude Code/Cowork plugin with three skills, all consuming the JSON artifact (D6): `coverage-review` (fetch latest coverage-report.json for a PR, summarize, link HTML report), `write-missing-tests` (read uncovered ranges + local source, write real test files interactively), `coverage-trends` (read history branch, summarize direction).

Accept: plugin installs from marketplace zip; each skill works against this repo's own artifacts.

**Prompt:**
> Create a Claude Code plugin in packages/skills per docs/plan/phase-6-skills-enterprise.md. Three skills with SKILL.md each: coverage-review (gh api to find the latest coverage-report.json artifact for a PR, summarize verdict/regressions/risks, link the HTML report), write-missing-tests (parse uncovered ranges from the JSON, open the source files, write real runnable tests locally and run them), coverage-trends (read baselines from the coverage-baseline branch, summarize trend). Skills must consume only the schemaVersion-ed JSON. Include plugin manifest and install docs; test each skill against this repo's own CI artifacts.

## Stage 6.2 — Supply-chain & release hardening

Steps: provenance (`npm publish --provenance`), SLSA build attestation for the action, SBOM (cyclonedx) published per release, pin-by-SHA usage docs, OpenSSF scorecard workflow.

Accept: release artifacts carry provenance; scorecard ≥7.

**Prompt:**
> Harden releases per docs/plan/phase-6-skills-enterprise.md stage 6.2: npm publish with --provenance in the changesets release workflow, GitHub artifact attestations for dist/, CycloneDX SBOM generated and attached to each GitHub release, OpenSSF scorecard workflow, and README security section telling users to pin the action by commit SHA with dependabot config example.

## Stage 6.3 — Monorepo project support

Steps: config `projects: [{name, path, coverage, thresholds}]`; per-project diff + policy; single comment with per-project verdict rows (state 8); per-project baselines in the history branch.

Accept: fixture monorepo (2 packages) gets one comment with two verdict rows and independent gates.

**Prompt:**
> Add monorepo project support per docs/plan/phase-6-skills-enterprise.md stage 6.3. Extend config with projects[] (name, path, coverage file or glob, optional thresholds overriding root). Run parse→diff→policy per project, store per-project baselines (baselines/<sha>/<project>.json), render one comment with a per-project verdict table and expandable detail per project, and aggregate exit code (worst verdict wins). Fixture: a 2-package monorepo exercising independent pass/fail.

## Stage 6.4 — Performance & scale

Steps: stream-parse large lcov (>100k lines) without loading into memory; p95 action runtime <10s excluding user tests; org-level rollup (read many repos' history branches → static dashboard) as design spike, build only if clients ask.

Accept: 100k-line lcov fixture parses <2s; benchmark job in CI tracks runtime regression.

**Prompt:**
> Optimize for scale per docs/plan/phase-6-skills-enterprise.md stage 6.4: rewrite the lcov parser as a streaming line parser, add a generated 100k-line lcov fixture with a benchmark test asserting <2s parse, add a CI benchmark job that fails on >20% runtime regression for the end-to-end fixture run, and profile the action to get p95 under 10s excluding the user's test run. Write a short design doc (not implementation) for org-level multi-repo coverage rollup.
