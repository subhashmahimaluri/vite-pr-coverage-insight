---
name: coverage-trends
description: Summarize coverage direction over time from the coverage-baseline history branch. Use when asked "how is coverage trending", "coverage history", or for a periodic coverage health summary.
---

# coverage-trends

Read the repo's `coverage-baseline` branch (one JSON per main-branch commit,
maintained by the Coverage Insight action) and summarize the trend.

## Steps

1. Read the index and recent entries (no checkout needed):

   ```bash
   gh api repos/{owner}/{repo}/contents/index.json?ref=coverage-baseline \
     --jq '.content' | base64 -d   # {entries: [{sha, timestamp}]} newest first
   gh api repos/{owner}/{repo}/contents/baselines/<sha>.json?ref=coverage-baseline \
     --jq '.content' | base64 -d   # {sha, ref, timestamp, summary}
   ```

   Fetch the newest ~30 entries; each `summary.total` has pct per metric
   (statements, branches, functions, lines).

2. Build the series oldest → newest and compute per metric: current value,
   delta over the window, largest single-commit drop (with its SHA).
3. Report:
   - one line per metric: `lines 87.2% (▲1.4 over 30 commits)` with a
     unicode sparkline (▁▂▃▄▅▆▇█ normalized to the window).
   - call out inflection points: any commit with a >1pp drop, linked by SHA.
   - overall direction: improving / flat / eroding, one sentence.
4. If the branch is missing, say the baseline workflow hasn't run and point
   to `examples/workflows/coverage-baseline.yml` in the action repo.
