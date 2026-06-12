# @coverage-insight/core

## 1.1.0

### Minor Changes

- 5ab9c74: Phase 1 foundation: node24 runtime, npm workspaces monorepo split into
  `@coverage-insight/core` (pure compare/format) and `@coverage-insight/action`
  (GitHub wrapper), Vitest suite with fixture snapshots, CI with dogfood job,
  ESLint + Prettier, changesets.
- 469c5c4: Coverage Insight v2: single-run pipeline with baseline store and resolver,
  lcov/v8/istanbul parser plugins, config-driven thresholds + ratchet policy
  engine, versioned coverage-report.json (schemaVersion 1), markdown comment v2
  with 8 states updated in place, self-contained HTML report, trend history +
  sparkline badges, optional AI layer (analyst, test-suggester, risk reviewer)
  behind ai: off, covins CLI, monorepo project gates, Claude Code skills plugin
  and supply-chain hardening.
