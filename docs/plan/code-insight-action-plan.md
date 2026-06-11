# Code Insight — PR Code Scan & Review Action (new repo)

A sibling action to `vite-pr-coverage-insight`: scan the PR for **dead code,
duplication, complexity, security, OWASP, accessibility, pentest checks and
Sonar-style code smells**, then post one premium PR comment — graphs visible
on top, details collapsed below — and gate the merge on what the PR
_introduced_.

Reference for scope and spirit: [fallow-rs/fallow](https://github.com/fallow-rs/fallow)
(deterministic, graph-aware TS/JS analysis; changed-file attribution;
pass/warn/fail verdicts; SARIF + PR comments). We build the same product
shape with npm-native scanners and the report/UX system already proven in
coverage-insight.

---

## 1. Repo name — three candidates

| Name                                 | Why                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **`pr-code-insight`** ⭐ recommended | Family brand with `vite-pr-coverage-insight`; says exactly what it does; `code-insight` scope name matches `@coverage-insight/*` precedent |
| **`codegate-action`**                | "The gate your code passes through" — short, memorable, gate-first identity                                                                |
| **`scanline-action`**                | Scan + line-level findings; clean single word, good logo potential                                                                         |

Marketplace title: **"Code Insight — PR quality, security & a11y gate"**.

---

## 2. Product decisions (carried over + new)

| #   | Decision                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | npm-only. Every scanner is an npm package invoked in-process — no pip/binaries/docker                                                                                                                                                              |
| D2  | AI strictly optional (`ai: off` default, dynamic import only, zero non-GitHub calls when off)                                                                                                                                                      |
| D3  | **Diff-aware by default**: the gate fails only on findings the PR _introduces_ (fingerprint not present in the baseline). Pre-existing debt is reported, never blocking — this is the Sonar "new code" model and fallow's changed-file attribution |
| D4  | One comment per PR, updated in place (`<!-- code-insight -->` marker)                                                                                                                                                                              |
| D5  | Versioned JSON artifact `code-report.json` (`schemaVersion: 1`, zod-validated, emitted in every state) — the only integration surface                                                                                                              |
| D6  | Deterministic core: same repo state in → byte-identical report out. Scanners are pinned; no Date.now/random in the model                                                                                                                           |
| D7  | Also emit **SARIF** so findings appear in GitHub's code-scanning tab for free                                                                                                                                                                      |

## 3. Check categories → npm scanners

| Category                               | Scanner(s)                                                                                                        | Notes                                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🪦 Dead code                           | **knip**                                                                                                          | unused files, exports, types, dependencies (fallow parity); framework-aware entry points (vite/next/etc.)                                                                                                                                                                                                         |
| 👯 Duplication                         | **jscpd**                                                                                                         | token-based clone detection, % duplicated + clone pairs with both locations                                                                                                                                                                                                                                       |
| 🌀 Complexity                          | **eslint** `complexity`, `max-depth`, `max-lines-per-function` + **eslint-plugin-sonarjs** `cognitive-complexity` | cyclomatic _and_ cognitive, per-function hotspots                                                                                                                                                                                                                                                                 |
| 🧹 Code smells                         | **eslint-plugin-sonarjs** (full ruleset)                                                                          | the "Sonar checks" ask: ~200 smell/bug rules                                                                                                                                                                                                                                                                      |
| 🔐 Security (SAST)                     | **eslint-plugin-security**, **eslint-plugin-no-unsanitized**, **secretlint**                                      | injection sinks, unsafe regex/eval, unsanitized DOM, committed secrets                                                                                                                                                                                                                                            |
| 📦 Security (deps)                     | **npm audit --json** (offline-tolerant)                                                                           | known CVEs in the dependency tree, severity-mapped                                                                                                                                                                                                                                                                |
| 🛡️ OWASP                               | taxonomy layer, not a scanner                                                                                     | every security finding is tagged with its OWASP Top-10 2021 category (A01-Broken Access Control … A10-SSRF); report groups by category                                                                                                                                                                            |
| ♿ Accessibility                       | **eslint-plugin-jsx-a11y** + **html-validate**                                                                    | static a11y for JSX + HTML; phase 2 option: axe-core against built `dist/index.html`                                                                                                                                                                                                                              |
| 🎯 Pentest checks                      | **own static ruleset** (`@code-insight/pentest-lite`)                                                             | honest scope: _static_ pentest hygiene — missing CSP, `http://` URLs, `target="_blank"` without `rel`, wildcard CORS, cookie flags, `dangerouslySetInnerHTML`/`eval`, exposed `VITE_*` secrets, open-redirect patterns. True DAST is out of scope; provide a `dast-report` input to ingest external ZAP/Burp JSON |
| 🔄 Architecture (bonus, fallow parity) | **madge**                                                                                                         | circular dependencies; cheap to add, high perceived value                                                                                                                                                                                                                                                         |

All scanners run through one adapter interface so categories ship
independently and partial failure degrades to a warning, never a crash.

## 4. Unified finding model (core)

```ts
type Finding = {
  category:
    | 'dead-code'
    | 'duplication'
    | 'complexity'
    | 'smell'
    | 'security'
    | 'deps'
    | 'a11y'
    | 'pentest'
    | 'architecture';
  ruleId: string; // e.g. sonarjs/cognitive-complexity
  severity: 'info' | 'minor' | 'major' | 'critical';
  owasp?: string; // 'A03:2021-Injection' when applicable
  file: string;
  range?: { start: number; end: number };
  message: string;
  fingerprint: string; // stable hash: ruleId + file + normalized code context
  isNew?: boolean; // not in the baseline → introduced by this PR
  touched?: boolean; // file is in the PR diff
};
```

`fingerprint` uses rule + relative path + a normalized snippet hash (not line
numbers) so findings survive unrelated edits — this is what makes D3 reliable.

## 5. The report (the part that must feel premium)

Reuse the exact comment system that now works in coverage-insight:

**Visible (top):**

- Verdict header: `✅ Code gate passed` / `❌ Code gate failed `blocks merge``/`⚠️ Scan error` — 8-state machine, same priority discipline
  (scan-crashed > invalid-data > gate-failed > new-findings > improved > no-change > passed)
- Policy line: `policy: zero new critical · max duplication 3% · PR #12`
- **Overview SVG band** (`<picture>` light/dark, committed to the
  `code-insight-baseline` orphan branch): one card per category —
  count, colored severity dot, **Δ vs base** (▲ red = new debt, ▼ green = paid
  down), 30-run sparkline. Live per-PR band with `contents: write`,
  base-branch band + caption hint otherwise (lesson learned)
- A `> [!CAUTION]` alert when new critical findings block the merge, naming
  the worst offender

**Collapsible (below) — one spoiler per category, count in the summary:**

- `▶ 🪦 Dead code (4 new · 12 total)` — table: file (blob-linked), symbol, why
- `▶ 👯 Duplication (2 clones, 3.1%)` — clone pairs, both sides linked
- `▶ 🌀 Complexity hotspots (3)` — function, cognitive/cyclomatic, threshold
- `▶ 🔐 Security & OWASP (1 new critical)` — grouped by OWASP category, rule link
- `▶ ♿ Accessibility (6)` / `▶ 🎯 Pentest checks (2)` / `▶ 🧹 Code smells (14)`
- `▶ 📋 All findings by file` (≤100 files only)
- New-findings rows bold + 🆕 chip; pre-existing rows muted (`isNew` drives it)
- Truncation ladder: drop all-findings table → cap category rows at 25 →
  protected only (verdict + alerts + new-critical list). 65k char budget

**Also:** check-run with ≤200 inline annotations on touched lines
(failures-first), SARIF upload option, self-contained `code-report.html`
artifact with the full interactive table.

## 6. Gates (configurable, input-overridable)

`code-insight.config.json` (file < action inputs, same precedence engine):

```jsonc
{
  "gates": {
    "newFindings": { "critical": 0, "major": 5 }, // D3 — default-on
    "duplication": { "maxPercent": 5 },
    "complexity": { "maxCognitive": 15 },
    "deadCode": "warn", // report-only
    "totals": { "critical": 0 }, // optional absolute gate
  },
  "ignore": ["**/generated/**"],
  "owaspProfile": "top10-2021",
}
```

Action input `gates` accepts the same JSON (the `thresholds` input pattern).
Job fails only on: gate violations, scanner _crash_ with `strict: true`, or
invalid inputs. A scanner that merely _finds things_ never fails the job
unless a gate says so.

## 7. Repo layout

```
packages/core        finding model, fingerprints, schema, gate engine, diff attribution
packages/scanners    one adapter per tool (knip, jscpd, eslint×4, secretlint, audit, madge, pentest-lite)
packages/reporters   json builder, markdown comment, html artifact, sarif
packages/history     category-count series + overview band SVG (port from coverage-insight)
packages/action      GitHub wrapper (ncc → dist/index.js), baseline branch, annotations
packages/cli         `codein scan|gate|report` for GitLab/Jenkins/local
packages/agents      optional AI explain/fix-suggest layer (dynamic import only)
```

## 8. Phases

| Phase                          | Scope                                                                                                     | Acceptance                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1. Foundation                  | core model + fingerprints + schema, knip/jscpd/eslint-sonarjs adapters, JSON report                       | `codein scan` on a fixture repo → deterministic code-report.json                               |
| 2. Baseline & diff             | orphan `code-insight-baseline` branch, fingerprint diff (`isNew`), touched-files via PR API               | re-run on same SHA → 0 new; seeded fixture shows new vs pre-existing split                     |
| 3. Comment & gates             | markdown renderer (all states), overview SVG band, gate engine, one-comment upsert, job failure semantics | comment matches the approved coverage-insight layout style; gate blocks merge on new criticals |
| 4. Security/OWASP/a11y/pentest | remaining adapters + OWASP taxonomy + pentest-lite rules + npm audit                                      | each category renders its spoiler; SARIF validates                                             |
| 5. Annotations, HTML, CLI      | check-run annotations, html artifact, `codein` CLI, SARIF upload input                                    | annotations on touched lines only; CLI exit codes 0/1/2                                        |
| 6. Polish & launch             | live per-PR band, trends, README with screenshots, marketplace listing, provenance/SBOM                   | dry-run gallery of every state; smoke + determinism tests green                                |

## 9. Hard-won rules from coverage-insight (do not relearn)

1. **Pin CJS-compatible majors** (`@actions/github@^6`, `@actions/cache@^4`) —
   ESM-only majors make ncc emit `webpackMissingModule` and the action dies at
   load. Ship the **dist smoke test** (no stubs + loads with empty env) and
   the dependabot `ignore` rules from day one.
2. **Failure semantics first**: job must fail when gates fail and stay green
   on incidental tool noise; crashes never decide the workflow; posting the
   comment can never mask the verdict.
3. **The visible area is graphs + verdict only**; every table is a spoiler.
   Mermaid renders only outside collapsed spoilers (or accept render-on-expand).
4. **Never headline base-branch data as if it were the PR's** — live per-PR
   band needs `contents: write`; the fallback caption must say what it shows.
5. Relativize every path against `GITHUB_WORKSPACE`; blob-link with `#Lx-Ly`.
6. Capture run output; parse real names (here: scanner stderr) — never print
   "exited with code 1" without the why.
7. Strip ANSI from anything quoted into the comment.
8. `vitest` aliases all workspace packages to `src/`; snapshot every report
   state; fixture dry-runs of the **bundled** dist before every release.

## 10. Open questions (decide at kickoff)

- Monorepo support in v1 (per-package gates) or phase 7?
- axe-core on built output (needs a build step / linkedom) — phase 2 or cut?
- Scanner versions pinned exactly (determinism) vs caret (freshness): propose
  exact pins + Renovate/dependabot grouped minor PRs gated by the determinism test.
- Default gate when no config: report-only (coverage-insight precedent) or
  `newFindings.critical: 0`? Propose the latter — it is the product's point.
