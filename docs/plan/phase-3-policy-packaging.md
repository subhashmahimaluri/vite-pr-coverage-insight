# Phase 3 — Policy & packaging

Goal: configurable gates enterprises can enforce, usable beyond GitHub.

## Stage 3.1 — Config loader

Steps: `packages/core/config` — load `coverage-insight.config.{ts,mjs,json}` (and `coverage-insight` key in package.json); schema-validate with zod; defaults: thresholds none, ratchet off, ai off. Action inputs override file config; file config overrides defaults.

Accept: invalid config fails with a precise message (path + expected type); precedence covered by tests.

**Prompt:**
> Create a config loader in packages/core per docs/plan/phase-3-policy-packaging.md. Support coverage-insight.config.ts/.mjs/.json and a package.json key, validated with zod. Shape: { thresholds?: {lines,branches,functions,statements: number}, overrides?: [{path: glob, thresholds}], ratchet?: boolean, ai?: 'off'|'comment'|'review', reporters?: string[] }. Precedence: action inputs > config file > defaults. Fail with exact path of invalid keys. Full unit tests including precedence and bad-config messages.

## Stage 3.2 — Policy engine (thresholds + ratchet)

Steps: `packages/core/policy` — evaluate diff result against config: global thresholds per metric, per-path overrides (glob), ratchet (no metric may decrease vs baseline, per-file and total). Output `PolicyResult`: verdict `pass|warn|fail`, list of violations (metric, scope, required, actual, gap). Action maps verdict → check-run conclusion + exit code.

Accept: every report state in phase 4's matrix derivable from PolicyResult; table-driven tests for threshold/override/ratchet combinations.

**Prompt:**
> Implement the policy engine in packages/core/policy per docs/plan/phase-3-policy-packaging.md stage 3.2. Input: diff result + validated config. Evaluate global thresholds, per-path glob overrides (most specific wins), and ratchet mode (fail when any file or total metric decreases beyond a configurable tolerance, default 0.1pct). Output PolicyResult {verdict, violations[]} with everything the reporter needs to render the threshold-compliance and regression tables. Table-driven tests covering at least 12 combinations.

## Stage 3.3 — `covins` CLI

Steps: `packages/cli` — commands: `covins compare --base x.json --head y.json`, `covins check` (exit 0/1/2 = pass/warn/fail), `covins report --format md|json|html`; no GitHub dependencies; reads same config. Publish as npm bin. This is the GitLab/Jenkins/Azure story — document examples for each.

Accept: `npx covins check` gates a Jenkins-style script via exit code; CLI shares 100% of logic with the action (thin arg-parsing layer only).

**Prompt:**
> Create packages/cli (bin name covins) per docs/plan/phase-3-policy-packaging.md stage 3.3, using commander or a zero-dep arg parser. Commands: compare (print summary table to stdout), check (exit code maps to PolicyResult verdict), report --format md|json|html --out path. Must reuse packages/core for all logic and the stage 3.1 config loader. No @actions/* or octokit imports. Add docs/ci-examples.md with GitLab CI, Jenkins, and Azure Pipelines snippets. Integration-test the CLI against fixtures with execa.

## Stage 3.4 — Parser plugins (lcov, v8)

Steps: `packages/core/parsers` — `CoverageParser` interface → normalized `CoverageModel`; implement istanbul-summary (current), lcov (`lcov.info`), v8 (`coverage-final.json` / c8 output); auto-detect by file content; uncovered-line extraction for each.

Accept: same fixture project produces equivalent CoverageModel from all three formats (tolerance 0.1pct); unknown format error names supported ones.

**Prompt:**
> Add a parser plugin layer in packages/core/parsers per docs/plan/phase-3-policy-packaging.md stage 3.4. Define CoverageParser {detect(content), parse(content): CoverageModel} and a normalized CoverageModel type that the diff engine consumes. Implement parsers for istanbul coverage-summary.json (port existing logic), lcov.info, and v8/c8 coverage-final.json, each extracting per-file metrics plus uncovered line ranges. Auto-detect format. Generate the three formats from one fixture project and assert the parsed models match within 0.1pct.
