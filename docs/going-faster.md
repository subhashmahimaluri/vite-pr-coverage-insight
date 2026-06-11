# Going faster (opt-in speedups)

All of these are **off by default** and independent. Read the tradeoffs — the
default single-run pipeline is already the safe fast path.

## 1. Affected-only test runs (`vitest --changed`)

Run only tests affected by the PR's changes, with a nightly full run as the
safety net that also refreshes the baseline:

```yaml
# in pr-coverage.yml — replace the test step
- run: npm test -- --coverage --changed origin/${{ github.base_ref }}
```

```yaml
# .github/workflows/nightly-coverage.yml
on:
  schedule:
    - cron: '0 3 * * *'
jobs:
  full:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm test -- --coverage
      - uses: subhashmahimaluri/vite-pr-coverage-insight@v2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          mode: baseline
          coverage: coverage/coverage-summary.json
```

**Tradeoffs, honestly:**

- Coverage of _unaffected_ files is missing from the PR summary, so totals are
  not comparable to the baseline — per-file deltas for touched files remain
  meaningful, totals do not.
- Vitest's change detection follows the module graph; it misses dynamic
  imports, file I/O coupling, and global setup effects. A PR can go green and
  still break an "unaffected" test — that's what the nightly run catches,
  **up to a day later**.
- Recommended only for suites >10 minutes where the latency win clearly pays
  for the weaker per-PR signal.

## 2. Sharded test matrices with coverage merge

For large suites, shard tests across a matrix and pass the directory of shard
summaries as `head:` — the action merges them before diffing:

```yaml
jobs:
  test:
    strategy:
      matrix: { shard: [1, 2, 3, 4] }
    steps:
      # ...
      - run: npm test -- --coverage --shard=${{ matrix.shard }}/4
      - uses: actions/upload-artifact@v4
        with:
          name: coverage-shard-${{ matrix.shard }}
          path: coverage/coverage-summary.json

  report:
    needs: test
    steps:
      - uses: actions/download-artifact@v5
        with: { pattern: 'coverage-shard-*', path: shards, merge-multiple: false }
      - uses: subhashmahimaluri/vite-pr-coverage-insight@v2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          head: shards # directory → shards are merged
```

**Tradeoffs:** summary-level merge is exact when shards are **file-disjoint**
(the usual case — vitest shards by test file). If the same source file is
covered by several shards, the merge keeps the shard with the most covered
lines rather than unioning hits — for overlapping shards, merge raw
`coverage-final.json` files with `nyc merge`/`istanbul-merge` first and pass
the single summary instead.

## 3. Skip coverage on docs-only PRs

```yaml
on:
  pull_request:
    paths-ignore:
      - '**.md'
      - 'docs/**'
```

**Tradeoffs:** skipped runs post no comment at all (required-check setups need
a no-op fallback job), and a "docs-only" filter that's too broad will skip
PRs that did change behavior (e.g. `.json` config). Keep the ignore list
short and explicit.
