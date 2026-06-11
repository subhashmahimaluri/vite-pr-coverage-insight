---
name: coverage-review
description: Review coverage for a PR from its coverage-report.json artifact — verdict, regressions, risky uncovered code, link to the HTML report. Use when asked to "review coverage", "check the coverage report", or "why did the coverage gate fail" for a PR.
---

# coverage-review

Summarize the coverage state of a pull request using the versioned JSON
artifact the Coverage Insight action uploads on every run (decision D6: the
JSON is the only contract — never parse raw istanbul/lcov files or the PR
comment).

## Steps

1. Identify the PR: from the argument (`/coverage-review 123`), the current
   branch (`gh pr view --json number`), or ask.
2. Find the latest artifact for the PR's head SHA:

   ```bash
   gh pr view <number> --json headRefOid,headRefName
   gh api repos/{owner}/{repo}/actions/artifacts --jq \
     '.artifacts[] | select(.name=="coverage-report") | {id, created_at, workflow_run}' \
     | head  # newest first; match workflow_run.head_sha to the PR head
   gh api repos/{owner}/{repo}/actions/artifacts/<id>/zip > /tmp/cov.zip
   unzip -o /tmp/cov.zip -d /tmp/cov
   ```

3. Read `/tmp/cov/coverage-report.json`. Check `schemaVersion` — if it is not
   `1`, say so and summarize only fields you recognize.
4. Report, in this order:
   - **Verdict**: `state` + `policy.verdict`, in one line.
   - **Gate failures**: each `policy.violations[]` as "metric scope: actual%
     vs required% (gap)". Rank by `gap` and name the shortest path to green.
   - **Regressions**: files where any `metrics.*.delta < 0`, worst first;
     flag drops > 5pp as critical.
   - **Risky uncovered code**: files with `change: "new" | "modified"` and
     non-empty `uncoveredRanges` — list path + ranges.
   - **Baseline context**: `baseline.source` and `staleness` (mention when
     stale or `no-baseline`).
   - **HTML report**: if an artifact named `coverage-report-html` exists,
     link its workflow-run artifact page.
5. Keep it tight: a verdict line, then at most ~10 bullet findings. Offer to
   run `/write-missing-tests` when uncovered changed code exists.
