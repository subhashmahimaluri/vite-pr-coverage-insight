# Coverage Insight — Claude Code plugin

Three skills that work entirely off the versioned artifacts the action
produces (`coverage-report.json`, the `coverage-baseline` branch — decision
D6; no raw coverage parsing):

| Skill                 | What it does                                                            |
| --------------------- | ----------------------------------------------------------------------- |
| `coverage-review`     | Verdict, gate failures, regressions and risky uncovered code for a PR   |
| `write-missing-tests` | Writes and runs real tests for the uncovered ranges in the report       |
| `coverage-trends`     | Trend summary with sparklines from the coverage-baseline history branch |

## Install

From a marketplace that lists this repo:

```
/plugin install coverage-insight
```

Or point Claude Code directly at the repo:

```
/plugin marketplace add subhashmahimaluri/vite-pr-coverage-insight
/plugin install coverage-insight
```

(For local development: `claude --plugin-dir packages/skills`.)

## Requirements

- `gh` CLI authenticated with repo read access (artifacts + contents).
- The repo must run the Coverage Insight action ≥ v2 so the
  `coverage-report.json` artifact and `coverage-baseline` branch exist.

## Dogfood check

All three skills work against this repo's own CI artifacts: run
`/coverage-review` on any open PR here, `/coverage-trends` after a few main
pushes, and `/write-missing-tests` whenever a report shows uncovered changed
lines.
