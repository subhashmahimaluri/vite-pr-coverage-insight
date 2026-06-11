# Coverage Insight (vite-pr-coverage-insight)

Coverage intelligence for pull requests: compares coverage between your base
branch and the PR, **runs your tests only once per PR**, enforces configurable
gates, and posts one continuously-updated PR comment — plus a versioned JSON
artifact, a self-contained HTML report, trend sparklines, an optional AI risk
review, and a `covins` CLI for GitLab/Jenkins/Azure.

## Features

- **Single-run pipeline** — PRs test only HEAD; base coverage comes from a
  stored baseline (PR CI time roughly halved vs. testing both branches)
- **Any coverage format** — istanbul `coverage-summary.json`, `lcov.info`, or
  v8/c8 `coverage-final.json`, auto-detected
- **Policy gates** — thresholds per metric, per-path overrides, and a ratchet
  ("coverage never decreases"), all from one config file
- **8 report states** — pass/fail/regression/tests-failed/no-baseline/error/
  no-change/monorepo, each with a purpose-built comment layout
- **One comment per PR**, updated in place — never stacks
- **Artifacts on every run** — `coverage-report.json` (versioned schema) and a
  self-contained, air-gap-safe `coverage-report.html`
- **Trend history & badges** — sparklines and shields.io endpoints from the
  baseline branch
- **Optional AI** (off by default) — risk analysis, test suggestions and an
  advisory verdict; zero non-GitHub network calls when off
- **Monorepo projects** — independent gates and verdict rows per package
- **`covins` CLI** — the same engine for GitLab CI, Jenkins, Azure, local use

---

## Quick start in your repo

Two small workflows. The first publishes a coverage baseline on every push to
`main`; the second runs on PRs, tests **only the PR head**, and the action
resolves the baseline automatically.

**`.github/workflows/coverage-baseline.yml`**

```yaml
name: Coverage baseline

on:
  push:
    branches: [main]

permissions:
  contents: write # commits baselines to the coverage-baseline branch

concurrency:
  group: coverage-baseline
  cancel-in-progress: true

jobs:
  baseline:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm test -- --coverage
      - uses: subhashmahimaluri/vite-pr-coverage-insight@v2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          mode: baseline
          coverage: coverage/coverage-summary.json
```

**`.github/workflows/pr-coverage.yml`**

```yaml
name: PR coverage

on:
  pull_request:
    branches: [main]

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: pr-coverage-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - name: Run tests with coverage (HEAD only)
        run: npm test -- --coverage
        continue-on-error: true
      - uses: subhashmahimaluri/vite-pr-coverage-insight@v2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          head: coverage/coverage-summary.json
          # no `base:` — resolved from the baseline store automatically
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage-report
          path: |
            coverage-report.json
            coverage-report.html
          if-no-files-found: warn
```

Your test runner must emit a coverage file. For vitest:

```ts
// vitest.config.ts
export default defineConfig({
  test: { coverage: { reporter: ['text', 'json-summary'] } },
});
```

The very first PR before any baseline exists gets an absolute-numbers report
("Baseline recorded"); every PR after a main-branch run shows full deltas.
Migrating from v1's two-run setup? See
[docs/migration-v1-to-v2.md](docs/migration-v1-to-v2.md). Copy-paste templates
live in [examples/workflows/](examples/workflows/).

## Inputs

| Input             | Description                                                                        | Required | Default             |
| ----------------- | ---------------------------------------------------------------------------------- | -------- | ------------------- |
| `github-token`    | GitHub token for the PR comment / check run                                        | Yes      | -                   |
| `mode`            | `report` posts the PR comment; `baseline` publishes coverage on main pushes        | No       | `report`            |
| `head`            | PR coverage file (any supported format), **or a directory of shard summaries**     | Yes\*    | -                   |
| `base`            | Base coverage file — omit to auto-resolve from the baseline store                  | No       | auto-resolved       |
| `coverage`        | Coverage file for `baseline` mode (falls back to `head`)                           | No       | -                   |
| `baseline-branch` | Orphan branch used as the baseline/history store                                   | No       | `coverage-baseline` |
| `test-failures`   | Path to test failures JSON file                                                    | No       | -                   |
| `use-check-run`   | Also publish a GitHub Check Run (conclusion follows the policy verdict)            | No       | `false`             |
| `ai`              | `off` \| `comment` \| `review` — see [AI assistance](#ai-assistance-optional)      | No       | `off`               |
| `ai-can-block`    | Only with `ai: review` — allow a high-risk AI verdict to set the check run neutral | No       | `false`             |

\* required in `report` mode. Explicit `base:` works exactly as in v1 and
overrides baseline resolution.

## Configuration file (gates)

Add `coverage-insight.config.json` (or `.ts`/`.mjs`, or a `"coverage-insight"`
key in package.json) at the repo root:

```jsonc
{
  // fail the gate when a total metric is below its threshold
  "thresholds": { "lines": 85, "branches": 75 },

  // stricter (or looser) rules for specific paths — most specific glob wins
  "overrides": [{ "path": "src/billing/**", "thresholds": { "lines": 95 } }],

  // no file or total metric may decrease vs. the baseline (±0.1pp tolerance)
  "ratchet": true,
  "ratchetTolerance": 0.1,

  // monorepos: independent gates + one comment with per-project verdict rows
  "projects": [
    {
      "name": "web",
      "path": "packages/web",
      "coverage": "packages/web/coverage/coverage-summary.json",
    },
    {
      "name": "api",
      "path": "packages/api",
      "coverage": "packages/api/coverage/coverage-summary.json",
      "thresholds": { "lines": 90 },
    },
  ],

  "ai": "off", // 'comment' | 'review'; action input overrides this
  "aiRedact": false, // true: AI prompts carry paths/metrics only, never source
}
```

Without a config file nothing fails: the action only reports. With thresholds
or ratchet configured, a violation sets the job (and check run) to failed —
the comment shows a compliance table and the "shortest path to green".

## How baseline resolution works

1. compute the PR's **merge-base** SHA with the base branch
2. try `actions/cache` (key `covins-baseline-<sha>`)
3. try `baselines/<sha>.json` on the `coverage-baseline` branch
4. walk up to 50 ancestor commits and use the nearest baseline (the comment
   notes how many commits behind it is)
5. otherwise post the absolute-numbers "Baseline recorded" report

## Artifacts (integration surface)

Every run — including error states — writes:

- **`coverage-report.json`** — `schemaVersion: 1`: state, totals with deltas,
  per-file metrics, uncovered ranges, policy violations, test failures,
  baseline metadata, trend history. This is the only contract for dashboards,
  agents and skills; never parse raw coverage files or the comment.
- **`coverage-report.html`** — one self-contained file (inline CSS/JS, CSP
  forbids all external loads, opens from `file://`): verdict header, trend
  chart with threshold line, directory treemap, sortable/searchable file
  table, uncovered-line ranges, dark mode.
- **`ai-audit.json`** — when AI ran: every prompt, response, token count and
  cost estimate.

Upload them with `actions/upload-artifact` as in the quick start.

## Trend history & badges

The baseline branch doubles as a history store. The `@coverage-insight/history`
package renders SVG sparklines, delta badges and shields.io endpoint JSON from
it — see [docs/badges.md](docs/badges.md) for README embedding and the
private-repo caveat (unicode sparkline fallback).

## AI assistance (optional)

**Off by default; with `ai: off` the action makes zero non-GitHub network
calls and the report is byte-identical and deterministic.**

| Mode      | Adds to the comment                                                         |
| --------- | --------------------------------------------------------------------------- |
| `comment` | 🤖 risk analysis of uncovered changed code + 🧪 compile-checked test ideas  |
| `review`  | the above + an advisory verdict (looks-safe / review-carefully / high-risk) |

```yaml
- uses: subhashmahimaluri/vite-pr-coverage-insight@v2
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    head: coverage/coverage-summary.json
    ai: comment
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

- **Providers**: Anthropic API (`ANTHROPIC_API_KEY`), AWS Bedrock
  (`AWS_BEARER_TOKEN_BEDROCK`, `AI_PROVIDER=bedrock`), Google Vertex
  (`GOOGLE_VERTEX_TOKEN` + `GOOGLE_VERTEX_PROJECT`, `AI_PROVIDER=vertex`).
- **Guardrails**: token budget (`AI_MAX_TOKENS`), cost ceiling
  (`AI_MAX_COST_USD`), 60s timeout — any breach skips AI gracefully and the
  deterministic report posts unchanged.
- **Privacy**: `"aiRedact": true` sends only paths, metrics and line ranges —
  never source code. `ai-audit.json` records everything that was sent.
- **AI never overrides the deterministic gate.** Its verdict is clamped (a
  failed gate can never be called looks-safe) and it can affect the check run
  (neutral at most) only with both `ai: review` **and** `ai-can-block: true`.
- All AI sections are fenced and labeled `(generated)`.

## Other CI systems (`covins` CLI)

```bash
npm i -D @coverage-insight/cli
npx covins check --head coverage/coverage-summary.json     # exit 0/1/2 = pass/warn/fail
npx covins compare --base old.json --head new.json
npx covins report --head lcov.info --format html --out report.html
```

Same config file, same engine, no GitHub dependency. GitLab/Jenkins/Azure
snippets: [docs/ci-examples.md](docs/ci-examples.md).

## Claude Code plugin

`packages/skills` ships three skills that consume the JSON artifact:
`/coverage-review` (PR verdict + risks), `/write-missing-tests` (real tests
for uncovered ranges), `/coverage-trends` (history summary). Install docs:
[packages/skills/README.md](packages/skills/README.md).

## Going faster (opt-in)

[docs/going-faster.md](docs/going-faster.md): affected-only test runs with a
nightly full-coverage net, sharded matrices with coverage merge (pass a
directory as `head:`), docs-only PR path filters.

## Test Failures JSON Format

```json
{
  "numFailedTests": 3,
  "numTotalTests": 50,
  "failedTests": [{ "testName": "should render correctly", "filePath": "src/Button.test.js" }]
}
```

Generate it from your runner's JSON output — see
[examples/extract-test-failures.js](examples/extract-test-failures.js). When
present and failing, the comment leads with the failures and defers the gate
(coverage is marked partial).

## Security

Pin the action by **commit SHA**, not a tag — tags can move, SHAs cannot:

```yaml
- uses: subhashmahimaluri/vite-pr-coverage-insight@<full-40-char-sha> # v2.x.y
```

Let Dependabot keep the pin fresh (`package-ecosystem: github-actions`).
Releases ship with build provenance attestations
(`gh attestation verify dist/index.js --repo subhashmahimaluri/vite-pr-coverage-insight`)
and a CycloneDX SBOM attached to each GitHub release. npm packages publish
with `--provenance`.

## Workspace layout (contributors)

```
packages/core       parsers (istanbul/lcov/v8), diff, config, policy, schemas
packages/reporters  JSON report builder, markdown comment, HTML artifact
packages/history    trend series, sparklines, badges
packages/agents     optional AI layer (never statically imported elsewhere)
packages/cli        covins
packages/action     the GitHub Action wrapper (bundled to dist/index.js)
packages/skills     Claude Code plugin
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and the staged plan in
[docs/plan/](docs/plan/).

## License

MIT
