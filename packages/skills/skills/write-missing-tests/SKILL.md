---
name: write-missing-tests
description: Write real, runnable tests for the uncovered code a coverage-report.json identifies. Use when asked to "cover the uncovered lines", "write the missing tests", or after coverage-review finds uncovered changed code.
---

# write-missing-tests

Turn the `uncoveredRanges` in a Coverage Insight JSON report into real tests
in this repo — written locally, run locally, never auto-committed.

## Steps

1. Obtain `coverage-report.json`: reuse the artifact-download steps from the
   `coverage-review` skill, or accept a local path argument
   (`/write-missing-tests coverage/coverage-report.json`).
2. Select targets: files with `change: "new"` or `"modified"` and non-empty
   `uncoveredRanges`, ranked by (uncovered line count × whether any policy
   violation names the file). Take the top 3 unless told otherwise.
3. For each target:
   - Read the source file and the uncovered ranges in context.
   - Detect the test framework from package.json (vitest vs jest) and find
     the nearest existing test file to mirror its conventions (imports,
     describe/it style, fixture patterns).
   - Write tests that actually exercise the uncovered branches/lines —
     assert behavior, not implementation. Place them in the repo's
     conventional test location.
4. Run the new tests (`npx vitest run <file>` / `npx jest <file>`) and fix
   failures. If coverage tooling is configured, re-run with coverage and
   confirm the targeted lines are now covered.
5. Summarize: tests added per file, lines newly covered, anything that
   genuinely cannot be tested (e.g. process.exit paths) with the reason.
   Leave committing to the user.
