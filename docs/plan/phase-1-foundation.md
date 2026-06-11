# Phase 1 — Foundation

Goal: trustworthy base. No features until this is done.

## Stage 1.1 — Runtime & dependency upgrade

Steps: `action.yml` `using: node16` → `node24`; bump `@actions/*`, `@octokit/rest`, TypeScript; remove unused devDeps (`express`, `chokidar` — only used by ad-hoc test server); set `engines: { "node": ">=20" }`; rebuild `dist/`.

Accept: action runs on a fixture PR under node24; `npm run build` green; no `express`/`chokidar` in deps.

**Prompt:**
> Upgrade this GitHub Action from node16 to node24. Update action.yml runtime, bump @actions/core, @actions/github, @octokit/rest and typescript to latest, add engines node>=20 to package.json, remove unused devDependencies express and chokidar (verify nothing imports them first), rebuild dist with ncc, and fix any type errors the upgrades surface. Do not change behavior.

## Stage 1.2 — Dead code removal & src cleanup

Steps: delete unused root modules `src/compareCoverage.ts`, `src/formatMarkdown.ts`, `src/postComment.ts` (index.ts uses `utils/compareCoverage`, `formatCoverageMarkdown.ts`, `postCoverageCheckRun.ts` — verify with imports before deleting); consolidate remaining files into coherent modules; remove ad-hoc `test/` scripts into `examples/` or delete.

Accept: every file in `src/` is imported from `index.ts`'s graph; build output unchanged in behavior.

**Prompt:**
> In src/ there are duplicate modules: compareCoverage.ts, formatMarkdown.ts and postComment.ts at the root duplicate logic in src/utils/ and other files. Trace the import graph from src/index.ts, delete every unreachable file, and consolidate so each concern (compare, format, post) lives in exactly one module. Move or delete the manual scripts in test/. No behavior changes — diff the generated markdown for the fixture inputs before and after to prove it.

## Stage 1.3 — npm workspaces monorepo

Steps: create `packages/core` (model, diff, format — pure, no GitHub deps) and `packages/action` (thin wrapper: inputs, octokit, comment posting); root `package.json` with `"workspaces": ["packages/*"]`; root tsconfig with project references; keep `action.yml` pointing at `packages/action/dist/index.js` (or root dist re-export for v1 path compat).

Accept: `npm ci && npm run build -ws` green; action behavior unchanged; `packages/core` has zero `@actions/*` imports.

**Prompt:**
> Restructure this repo into an npm workspaces monorepo (npm, NOT pnpm — decision D1 in docs/plan/README.md). Create packages/core (coverage types, compare logic, markdown formatting — pure functions, no GitHub/actions imports) and packages/action (GitHub Action wrapper consuming core). Root package.json with workspaces, TypeScript project references, shared tsconfig.base.json. Keep action.yml entry path working. Verify with a build and a dry run on the fixture coverage files.

## Stage 1.4 — Tests & CI

Steps: add Vitest at root; fixture pairs (base/head coverage-summary.json) covering: improvement, regression, new file, deleted file, empty/corrupt input; snapshot tests for markdown output; GitHub Actions workflow `ci.yml`: lint → typecheck → test → build, plus an e2e job that runs the action against fixtures; **run this action on its own PRs** (dogfood).

Accept: ≥90% coverage on `packages/core`; CI green; coverage comment appears on this repo's PRs.

**Prompt:**
> Add Vitest to this npm workspace. Write unit tests for packages/core: compareCoverage (improvement, regression, new file, removed file, identical, corrupt input) and markdown formatting (snapshot tests). Create test fixtures as JSON files under fixtures/. Add .github/workflows/ci.yml running lint, typecheck, test, build on every PR, plus a job that executes this action against fixture data and posts the coverage comment on this repo's own PRs. Target 90% coverage on packages/core.

## Stage 1.5 — Tooling: lint, format, releases

Steps: ESLint (typescript-eslint, flat config) + Prettier; `changesets` for versioning/publishing; CONTRIBUTING.md noting npm-only lockfile policy.

Accept: `npm run lint` green; changeset release dry-run produces correct versions.

**Prompt:**
> Add ESLint (flat config, typescript-eslint recommended) and Prettier to this npm workspace, fix all violations, add lint+format check to ci.yml. Set up changesets for independent package versioning with a GitHub Actions release workflow (dry-run publish). Write CONTRIBUTING.md covering: npm-only (package-lock.json is the only lockfile), workspace layout, how to run tests, stage-per-PR workflow from docs/plan/README.md.
