# Implementation plan — Coverage Insight v2

Execution-ready plan in 6 phases. Each phase has stages; each stage is sized for **one Claude Code session ending in one PR**, with acceptance criteria and a ready-to-paste prompt.

## How to use with Claude Code

1. Open this repo in Claude Code.
2. Work stages **in order** — later stages assume earlier ones are merged.
3. Paste the stage prompt. Always append: _"Read docs/plan/README.md and the relevant phase file first. Follow the global decisions. Write tests for everything you add. Run the full test suite before finishing."_
4. Review the diff, merge, move to the next stage.
5. If a stage reveals a needed refactor, do the refactor in its own PR first — don't mix.

## Global decisions (binding for every stage)

| #   | Decision                     | Rule                                                                                                                                                                                                                                                               |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **Package manager: npm**     | npm workspaces, `package-lock.json`, `engines: node >=20`. No pnpm/yarn-only features. CI uses `npm ci`. Contributors may use other PMs locally but never commit their lockfiles.                                                                                  |
| D2  | **AI is strictly optional**  | All AI code lives in `packages/agents`. Core/reporters never import it. Action input `ai: 'off'` by default. AI disabled ⇒ zero network calls beyond GitHub API, byte-identical deterministic report. Enterprises can omit the package entirely (air-gapped mode). |
| D3  | **Single-test-run pipeline** | PR workflows run tests **once** (head only). Base coverage comes from the baseline store (see Phase 2). Never instruct users to check out and test the base branch in a PR workflow.                                                                               |
| D4  | **v1 compatibility**         | Existing `action.yml` inputs keep working until v3. New behavior behind new inputs with safe defaults.                                                                                                                                                             |
| D5  | **One comment per PR**       | The action updates its own comment in place (marker: `<!-- coverage-insight -->`); never stacks comments.                                                                                                                                                          |
| D6  | **Versioned JSON schema**    | Every run emits `coverage-report.json` with `schemaVersion`. Reporters, agents, and skills consume only this — never raw istanbul files.                                                                                                                           |
| D7  | **Deterministic core**       | Same inputs ⇒ same outputs. AI text is appended, clearly labeled `generated`, never merged into deterministic sections.                                                                                                                                            |

## Phase index

| Phase                   | File                                                         | Outcome                                                        | Est.    |
| ----------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- | ------- |
| 1. Foundation           | [phase-1-foundation.md](phase-1-foundation.md)               | Node 24, clean monorepo (npm workspaces), tests, CI            | 4–6 wk  |
| 2. Performance          | [phase-2-performance.md](phase-2-performance.md)             | Single-run pipeline — PR CI time roughly halved                | 2–3 wk  |
| 3. Policy & packaging   | [phase-3-policy-packaging.md](phase-3-policy-packaging.md)   | Config + thresholds + ratchet, `covins` CLI, lcov/v8 parsers   | 4 wk    |
| 4. Reports & visuals    | [phase-4-reports-visuals.md](phase-4-reports-visuals.md)     | All 8 report states, badges/sparklines, HTML artifact, history | 6 wk    |
| 5. AI agents (optional) | [phase-5-ai-agents.md](phase-5-ai-agents.md)                 | analyst, test-suggester, risk-reviewer behind `ai` flag        | 6–8 wk  |
| 6. Skills & enterprise  | [phase-6-skills-enterprise.md](phase-6-skills-enterprise.md) | Claude Code plugin, signing/SBOM, monorepo projects            | ongoing |

## Definition of done (every stage)

- Unit tests added/updated; `npm test` green; core packages ≥90% coverage (dogfood!)
- `npm run lint` and `npm run build` green
- No new runtime dependencies without a note in the PR description justifying them
- Docs updated when behavior or inputs change
- Changeset added (`npx changeset`) from Phase 1.5 onward
