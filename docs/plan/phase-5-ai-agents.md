# Phase 5 — AI agents (strictly optional)

Goal: explain, don't just measure — without ever being required.

**Hard rules (decision D2):** all AI code in `packages/agents`; dynamically imported only when `ai !== 'off'`; default `off`; AI off ⇒ zero non-GitHub network calls and byte-identical deterministic report; redaction mode sends metrics/paths only, never source; every prompt+response written to an audit artifact.

`ai` modes: `off` (default) | `comment` (analysis + suggestions in comment) | `review` (adds advisory verdict; blocking only with explicit `ai-can-block: true`).

## Stage 5.1 — Agent runtime & provider abstraction

Steps: `packages/agents/runtime` — `ModelProvider` interface; implementations: Anthropic API, AWS Bedrock, Google Vertex (env/config selected); guards: max tokens per run, max spend estimate, hard timeout (default 60s) with graceful skip; audit log artifact `ai-audit.json` (prompts, responses, token counts, cost estimate); redaction layer.

Accept: provider swap via config only; timeout/budget exceeded ⇒ report renders without AI sections + a notice; audit artifact present whenever AI ran.

**Prompt:**
> Create packages/agents/runtime per docs/plan/phase-5-ai-agents.md stage 5.1. ModelProvider interface {complete(prompt, opts): json} with Anthropic API, Bedrock, and Vertex implementations selected by config. Wrap with guards: token budget, cost ceiling, 60s timeout — on any breach skip AI gracefully and note it in the report. Redaction mode strips source snippets, sending only file paths, metrics, and uncovered ranges. Write ai-audit.json (full prompts, responses, usage, est. cost) as a CI artifact. The package must never be statically imported by core/action — verify with a dependency-cruiser rule. Test with a mock provider including breach paths.

## Stage 5.2 — coverage-analyst agent

Steps: input = JSON report + (unless redacted) snippets of uncovered changed code; output = strict JSON `{summary, findings: [{file, lines, risk: high|med|low, reason}]}` (validate, retry once, skip on second failure); renderer maps to the fenced "AI risk analysis" comment section.

Accept: malformed model output never breaks the report; findings reference only files present in the diff; snapshot test of rendered section with mock provider.

**Prompt:**
> Implement the coverage-analyst agent per docs/plan/phase-5-ai-agents.md stage 5.2. Build its prompt from the stage 4.1 JSON report plus up-to-40-line snippets around uncovered changed lines (omitted in redaction mode). Require strict JSON output {summary, findings[{file, lines, risk, reason}]} validated with zod; one retry on invalid output, then skip with notice. Renderer adds the fenced, 'generated'-labeled AI risk analysis section with risk badges. Guard: findings referencing files outside the diff are dropped. Tests with mock provider: happy path, malformed output, redaction mode, oversized PR truncation.

## Stage 5.3 — test-suggester agent

Steps: for top-N risk findings, generate runnable test skeletons (detect framework from deps: vitest/jest; match project import style); output into collapsible "Suggested tests" section; never auto-commits.

Accept: suggestions compile-checked (tsc --noEmit against a scratch file) before posting — invalid ones dropped; capped at 3 suggestions per PR (config).

**Prompt:**
> Implement the test-suggester agent per docs/plan/phase-5-ai-agents.md stage 5.3. For the top 3 coverage-analyst findings, prompt for a runnable test skeleton; detect vitest vs jest from package.json and mirror the repo's existing test file conventions (scan one neighboring test for style). Validate each suggestion by type-checking it in isolation with tsc --noEmit plus the repo's tsconfig — drop failures silently. Render into the collapsible Suggested tests section, labeled generated. Config: maxSuggestions (default 3). Tests with mock provider including a suggestion that fails type-check.

## Stage 5.4 — pr-risk-reviewer agent

Steps: combines analyst findings + policy result + test failures into one verdict `{verdict: looks-safe|review-carefully|high-risk, rationale, likelyCause?}`; in failure mode (state 3) produces the "likely cause" box; advisory by default, affects check-run conclusion only with `ai-can-block: true`.

Accept: verdict never contradicts deterministic gate (cannot say looks-safe when policy failed); blocking path requires both config flag and explicit input.

**Prompt:**
> Implement pr-risk-reviewer per docs/plan/phase-5-ai-agents.md stage 5.4. Input: analyst findings, PolicyResult, test failures, diff stats. Output strict JSON {verdict, rationale, likelyCause?}. Render as a fenced section; in tests-failed state render the likely-cause box instead. Constraint enforced in code, not prompt: verdict is clamped to at-most-as-positive-as the deterministic gate. Advisory by default; only with config ai:'review' AND ai-can-block:true may it set the check run to neutral/failure. Tests: clamping, blocking opt-in matrix, failure-mode rendering.
