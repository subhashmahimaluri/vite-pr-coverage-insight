# Vite PR Coverage Insight

A GitHub Action that compares test coverage between base and PR branches, and posts the results as a comment on the PR — **running your tests only once per PR**.

## Features

- **Single-run pipeline** — PRs test only HEAD; base coverage comes from a stored baseline (PR CI time roughly halved vs. testing both branches)
- Compares overall coverage metrics (statements, branches, functions, lines)
- Shows file-level coverage changes in a collapsible section
- Highlights newly added files and modified files
- Shows uncovered lines for each file
- Supports failed test reporting
- Supports sharded test matrices (pass a directory of coverage shards to merge)

## Quick start (v2 — single test run)

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
```

The very first PR before any baseline exists gets an absolute-numbers report
("Baseline recorded"); every PR after a main-branch run shows full deltas.
Migrating from v1's two-run setup? See
[docs/migration-v1-to-v2.md](docs/migration-v1-to-v2.md). Copy-paste templates
live in [examples/workflows/](examples/workflows/).

## Inputs

| Input             | Description                                                                       | Required | Default             |
| ----------------- | --------------------------------------------------------------------------------- | -------- | ------------------- |
| `github-token`    | GitHub token for PR comment                                                       | Yes      | -                   |
| `mode`            | `report` posts the PR comment; `baseline` publishes coverage on main pushes       | No       | `report`            |
| `head`            | Path to PR coverage-summary.json, **or a directory of shard summaries** to merge  | Yes\*    | -                   |
| `base`            | Path to base coverage-summary.json — omit to auto-resolve from the baseline store | No       | auto-resolved       |
| `coverage`        | Coverage file for `baseline` mode (falls back to `head`)                          | No       | -                   |
| `baseline-branch` | Orphan branch used as the baseline/history store                                  | No       | `coverage-baseline` |
| `test-failures`   | Path to test failures JSON file                                                   | No       | -                   |
| `use-check-run`   | Whether to use GitHub Check Run API                                               | No       | `false`             |

\* required in `report` mode.

Explicit `base:` still works exactly as in v1 and overrides baseline
resolution.

## How baseline resolution works

1. compute the PR's **merge-base** SHA with `main`
2. try `actions/cache` (key `covins-baseline-<sha>`)
3. try `baselines/<sha>.json` on the `coverage-baseline` branch
4. walk up to 50 ancestor commits and use the nearest baseline (the comment
   notes how many commits behind it is)
5. otherwise post the absolute-numbers "Baseline recorded" report

## Going faster (opt-in)

See [docs/going-faster.md](docs/going-faster.md) for affected-only test runs
with a nightly full-coverage safety net, **sharded test matrices with coverage
merge** (pass a directory as `head:`), and skipping coverage on docs-only PRs.

## Test Failures JSON Format

If you want to include failed test information in the coverage report, you need to provide a JSON file with the following format:

```json
{
  "numFailedTests": 3,
  "numTotalTests": 50,
  "failedTests": [
    {
      "testName": "should render component correctly",
      "filePath": "src/components/Button.test.js"
    },
    {
      "testName": "should handle click events",
      "filePath": "src/components/Input.test.js"
    }
  ]
}
```

Generate it with your test runner's JSON output — see
[examples/extract-test-failures.js](examples/extract-test-failures.js).

## Output

The action will post a comment to the PR with:

1. A summary table showing overall coverage metrics
2. A collapsible section with file-level coverage details
3. A collapsible section with failed test information (if provided)

The comment is updated on subsequent pushes instead of stacking.

## Security

Pin the action by **commit SHA**, not a tag — tags can move, SHAs cannot:

```yaml
- uses: subhashmahimaluri/vite-pr-coverage-insight@<full-40-char-sha> # v2.x.y
```

Let Dependabot keep the pin fresh:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

Releases ship with build provenance attestations
(`gh attestation verify dist/index.js --repo subhashmahimaluri/vite-pr-coverage-insight`)
and a CycloneDX SBOM attached to each GitHub release. npm packages publish
with `--provenance`.

## License

MIT
