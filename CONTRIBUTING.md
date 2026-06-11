# Contributing

Thanks for helping improve Coverage Insight!

## Package manager: npm only

This repo uses **npm workspaces**. `package-lock.json` is the **only** lockfile —
never commit `yarn.lock`, `pnpm-lock.yaml`, or `bun.lockb`. You may use another
package manager locally, but CI runs `npm ci` against `package-lock.json`, so
dependency changes must be made with npm. Node **>= 20** is required (the action
itself runs on node24).

## Workspace layout

```
packages/core     @coverage-insight/core — coverage types, diff and markdown
                  formatting. Pure functions: no @actions/* or @octokit/*
                  imports, no network, no GitHub knowledge.
packages/action   @coverage-insight/action — the GitHub Action wrapper: reads
                  inputs, calls core, posts the PR comment / check run.
                  Bundled with ncc to the committed dist/index.js (the
                  action.yml entry point).
fixtures/         base/head coverage-summary.json pairs used by unit tests,
                  snapshot tests and the CI dogfood job.
examples/         helper scripts referenced by the README.
docs/plan/        the v2 implementation plan; read its README before larger work.
```

Keep that boundary: anything that talks to GitHub belongs in `packages/action`;
anything deterministic and reusable belongs in `packages/core`.

## Day-to-day commands

```bash
npm ci                  # install
npm test                # vitest run
npm run test:coverage   # with coverage (90% thresholds on packages/core)
npm run typecheck       # tsc -b project references
npm run lint            # eslint flat config
npm run format          # prettier --write
npm run build           # builds all workspaces + bundles dist/index.js
```

`dist/index.js` is committed because GitHub runs the action from it. CI fails
if it is stale — rerun `npm run build` and commit the result whenever
`packages/` changes.

## Workflow: one stage per PR

Larger work follows the staged plan in [docs/plan/README.md](docs/plan/README.md):
work stages in order, one Claude Code session / one PR per stage, and respect
the global decisions table (npm-only, AI strictly optional, single-test-run
pipeline, v1 input compatibility, one comment per PR, versioned JSON schema,
deterministic core). If a stage needs a refactor, land the refactor in its own
PR first.

Every PR needs:

- unit tests for anything added or changed; suite green (`npm test`)
- `npm run lint`, `npm run format:check` and `npm run build` green
- no new runtime dependencies without justification in the PR description
- docs updated when behavior or inputs change
- a changeset (`npx changeset`) describing the change for the release notes

## Releases

Versioning is automated with [changesets](https://github.com/changesets/changesets):
each merged PR carries a changeset; the release workflow on `main` opens a
"Version Packages" PR that bumps versions and changelogs. Publishing to npm and
tagging the marketplace action (`v1.x` git tags) are still manual and will be
automated in a later stage.
