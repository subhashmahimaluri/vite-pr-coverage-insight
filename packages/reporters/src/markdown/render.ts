import {
  METRIC_KEYS,
  type CoverageReport,
  type FileReport,
  type MetricDelta,
  type MetricKey,
  type PolicyViolation,
  type ProjectReport,
  type ReportState,
} from '@coverage-insight/core';

/**
 * Stage 4.2 — markdown PR comment, a state machine over the schemaVersion-1
 * report only. Layout follows the Coverage Insight design system, translated
 * to GitHub-Flavored Markdown: verdict header + policy context, metric tiles
 * with deltas and trend sparklines, "changed files (N of M)" with inline
 * arrow deltas, impact-sorted regression cards with severity/touched badges,
 * failures-first failure mode, compliance table + shortest path to green,
 * and a consistent footer. One comment, updated in place (D5).
 */

export const COMMENT_MARKER = '<!-- coverage-insight -->';

export type RenderMarkdownOptions = {
  /** link target for the self-contained HTML artifact */
  htmlReportUrl?: string;
  /** resolved visuals mode ('auto' is resolved by the caller via repo visibility) */
  visuals?: 'images' | 'mermaid' | 'text';
  /** raw URLs of the committed metric-band SVGs (images mode only) */
  badgeImages?: { light: string; dark: string };
  /** small caption under the metric band, e.g. what the cards are measured against */
  bandCaption?: string;
  /** GitHub's hard limit is 65536; default leaves headroom for AI sections */
  maxChars?: number;
};

const DEFAULT_MAX_CHARS = 65000;
const CHANGED_ROW_LIMIT_WHEN_TRUNCATING = 50;

const HEADERS: Record<ReportState, string> = {
  passed: '✅ Coverage gate passed',
  'threshold-failed': '❌ Coverage gate failed `blocks merge`',
  'tests-failed': '🛑 Tests failed — report in failure mode',
  regression: '🔻 Coverage regression',
  'no-baseline': 'ℹ️ Baseline recorded',
  'invalid-data': '⚠️ Coverage report error',
  'no-change': '✅ Coverage unchanged',
  monorepo: '📦 Monorepo coverage',
};

const METRIC_LABELS: Record<MetricKey, string> = {
  statements: 'Statements',
  branches: 'Branches',
  functions: 'Functions',
  lines: 'Lines',
};

// ---------------------------------------------------------------------------
// formatting helpers
// ---------------------------------------------------------------------------

function fmtPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** inline delta in the design system's style: +1.3 / −2.1 / ±0.0 */
function fmtDelta(delta: number | null): string {
  if (delta === null) return '';
  if (delta === 0) return '±0.0';
  return delta > 0 ? `+${delta.toFixed(1)}` : `−${Math.abs(delta).toFixed(1)}`;
}

/** green/red delta with arrow, reference-style: (+0.46% 🔼) / (-0.46% 🔻) */
function fmtDeltaRich(delta: number | null): string {
  if (delta === null) return '';
  if (delta === 0) return '(±0.0%)';
  const sign = delta > 0 ? '+' : '-';
  const color = delta > 0 ? 'green' : 'red';
  const arrow = delta > 0 ? '▲' : '▼';
  return `($\\color{${color}}{\\textsf{${sign}${Math.abs(delta).toFixed(2)}\\%}}$ ${arrow})`;
}

/** 🟢🟡🔴 health dot: threshold-aware, banded fallback (reference defaults) */
function statusIcon(pct: number, required?: number): string {
  if (required !== undefined) return pct >= required ? '🟢' : '🔴';
  return pct >= 80 ? '🟢' : pct >= 60 ? '🟡' : '🔴';
}

function blobUrl(report: CoverageReport, path: string): string | null {
  if (!report.repo || !report.pr?.headSha) return null;
  return `https://github.com/${report.repo.owner}/${report.repo.repo}/blob/${report.pr.headSha}/${path}`;
}

function linkedPath(report: CoverageReport, path: string): string {
  const url = blobUrl(report, path);
  return url ? `[\`${path}\`](${url})` : `\`${path}\``;
}

function linkedRanges(
  report: CoverageReport,
  path: string,
  ranges: { start: number; end: number }[] | undefined
): string {
  if (!ranges || ranges.length === 0) return '—';
  const url = blobUrl(report, path);
  return ranges
    .map((r) => {
      const label = r.start === r.end ? `${r.start}` : `${r.start}–${r.end}`;
      return url ? `[${label}](${url}#L${r.start}-L${r.end})` : label;
    })
    .join(', ');
}

/** arrow form used in regression cards: 70.7 → 62.5 (−8.2) */
function fmtArrow(m: MetricDelta): string {
  if (m.base === null || m.delta === null) return fmtPct(m.head);
  return `${m.base.toFixed(1)} → ${m.head.toFixed(1)} (${fmtDelta(m.delta)})`;
}

function fmtRanges(ranges: { start: number; end: number }[] | undefined): string {
  if (!ranges || ranges.length === 0) return '—';
  return ranges.map((r) => (r.start === r.end ? `${r.start}` : `${r.start}–${r.end}`)).join(', ');
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** required thresholds known from policy violations and/or policyMeta */
function requiredByMetric(report: CoverageReport): Partial<Record<MetricKey, number>> {
  const required: Partial<Record<MetricKey, number>> = { ...report.policyMeta?.thresholds };
  for (const violation of report.policy?.violations ?? []) {
    if (violation.scope === 'total' && violation.rule === 'threshold') {
      required[violation.metric] = violation.required;
    }
  }
  return required;
}

// ---------------------------------------------------------------------------
// shared sections
// ---------------------------------------------------------------------------

function headerBlock(report: CoverageReport): string {
  const lines = [`## ${HEADERS[report.state]}`];
  const meta: string[] = [];
  if (report.policyMeta) {
    meta.push(`policy: ${report.policyMeta.description}`);
    if (report.policyMeta.source) meta.push(report.policyMeta.source);
  }
  if (report.pr) meta.push(`PR #${report.pr.number}`);
  if (meta.length > 0) lines.push('', `_${meta.join(' · ')}_`);
  return lines.join('\n');
}

/** counts column is dropped when the metric-band cards are shown — they carry covered/total */
function totalsSection(report: CoverageReport, withDeltas: boolean, showCounts = true): string {
  const totals = report.totals;
  if (!totals) return '';
  const required = requiredByMetric(report);

  const header = ['St.', 'Category', 'Percentage', ...(showCounts ? ['Covered / Total'] : [])];
  const align = [':-:', '---', '---', ...(showCounts ? ['---:'] : [])];
  const lines = [`| ${header.join(' | ')} |`, `| ${align.join(' | ')} |`];

  for (const key of METRIC_KEYS) {
    const m = totals[key];
    const req = required[key];
    const pct =
      `**${fmtPct(m.head)}**` +
      (withDeltas && m.delta !== null ? ` ${fmtDeltaRich(m.delta)}` : '') +
      (req !== undefined ? ` — required ${req}%` : '');
    const counts =
      m.covered !== undefined && m.total !== undefined ? `${m.covered}/${m.total}` : '';
    const cells = [
      statusIcon(m.head, req),
      METRIC_LABELS[key],
      pct,
      ...(showCounts ? [counts] : []),
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

/** base-branch totals, shown inside the collapsible coverage report */
function baseTotalsSection(report: CoverageReport): string {
  const totals = report.totals;
  if (!totals) return '';
  const withBase = METRIC_KEYS.filter((key) => totals[key].base !== null);
  if (withBase.length === 0) return '';
  const lines = ['| St. | Category | Percentage |', '| :-: | --- | --- |'];
  for (const key of withBase) {
    const basePct = totals[key].base as number;
    lines.push(`| ${statusIcon(basePct)} | ${METRIC_LABELS[key]} | **${fmtPct(basePct)}** |`);
  }
  return lines.join('\n');
}

/** one spoiler with both detailed tables: this PR first, then the base branch */
function coverageTablesSpoiler(report: CoverageReport, withDeltas: boolean): string {
  const current = totalsSection(report, withDeltas, true);
  if (!current) return '';
  const base = baseTotalsSection(report);
  const lines = [
    '<details>',
    '<summary>📊 Coverage report — this PR vs base branch</summary>',
    '',
    '**Current PR**',
    '',
    current,
  ];
  if (base) lines.push('', '**Base branch**', '', base);
  lines.push('', '</details>');
  return lines.join('\n');
}

/** real rendered line chart via mermaid, collapsed (GitHub renders it on expand) */
function trendChartSection(report: CoverageReport): string {
  const history = report.history ?? [];
  if (history.length < 2) return '';
  const points = history.slice(-20);
  const labels = points.map((p) => `"${p.sha.slice(0, 7)}"`).join(', ');
  const values = points.map((p) => p.lines.toFixed(1)).join(', ');
  const min = Math.max(0, Math.floor(Math.min(...points.map((p) => p.lines)) - 5));
  return [
    '<details>',
    `<summary>📈 Coverage trend — lines % (last ${points.length} baselines)</summary>`,
    '',
    '```mermaid',
    'xychart-beta',
    `  x-axis [${labels}]`,
    `  y-axis "lines %" ${min} --> 100`,
    `  line [${values}]`,
    '```',
    '',
    '</details>',
  ].join('\n');
}

function testRunSection(report: CoverageReport): string {
  const t = report.testFailures;
  if (!t) return '';
  if (t.numFailedTests > 0) return ''; // failure state renders its own suites section
  const passed = t.numPassedTests ?? t.numTotalTests;
  if (!passed) return '';
  const suites = t.numTotalSuites ? ` in ${plural(t.numTotalSuites, 'suite')}` : '';
  return `### ✅ Test suite run success\n\n${plural(passed, 'test')} passing${suites}.`;
}

function touchedBadge(file: FileReport): string {
  if (file.touched === undefined) return '';
  return file.touched ? 'touched in this PR' : 'not touched — indirect';
}

function fileCells(file: FileReport, withDeltas: boolean): string[] {
  return METRIC_KEYS.map((key) => {
    const m = file.metrics[key];
    return withDeltas && m.delta !== null
      ? `${fmtPct(m.head)} ${fmtDelta(m.delta)}`
      : fmtPct(m.head);
  });
}

function fileTableHeader(): string[] {
  return [
    '| St. | File | Statements | Branches | Functions | Lines | Uncovered |',
    '| :-: | --- | ---: | ---: | ---: | ---: | --- |',
  ];
}

function fileRow(report: CoverageReport, file: FileReport, withDeltas: boolean): string {
  const chip = withDeltas && file.change === 'new' ? ' 🐣' : '';
  const icon = statusIcon(file.metrics.lines.head);
  return `| ${icon} | ${linkedPath(report, file.path)}${chip} | ${fileCells(file, withDeltas).join(' | ')} | ${linkedRanges(report, file.path, file.uncoveredRanges)} |`;
}

function spoilerTable(
  report: CoverageReport,
  summary: string,
  files: FileReport[],
  withDeltas: boolean,
  cap = 25
): string {
  if (files.length === 0) return '';
  const lines = [
    '<details>',
    `<summary>${summary} (${files.length})</summary>`,
    '',
    ...fileTableHeader(),
  ];
  for (const file of files.slice(0, cap)) lines.push(fileRow(report, file, withDeltas));
  if (files.length > cap) lines.push('', `_…${files.length - cap} more in the HTML report._`);
  lines.push('', '</details>');
  return lines.join('\n');
}

function newFilesSection(report: CoverageReport): string {
  const fresh = (report.files ?? []).filter((f) => f.change === 'new');
  return spoilerTable(report, '🐣 Show new files', fresh, false);
}

function reducedFilesSection(report: CoverageReport): string {
  const reduced = (report.files ?? []).filter((f) =>
    METRIC_KEYS.some((key) => {
      const delta = f.metrics[key].delta;
      return delta !== null && delta < 0;
    })
  );
  return spoilerTable(report, '🔻 Show files with reduced coverage', reduced, true);
}

/**
 * "Changed files" prefers the PR's actual git diff (FileReport.touched).
 * Without that signal it falls back to baseline-relative change — but never
 * when there is no baseline, where every file would be 'new' and the table
 * would just dump the repo.
 */
function changedFilesSection(
  report: CoverageReport,
  withDeltas: boolean,
  rowLimit?: number
): string {
  const files = report.files ?? [];
  const hasTouchInfo = files.some((f) => f.touched !== undefined);
  const changed = hasTouchInfo
    ? files.filter((f) => f.touched)
    : withDeltas
      ? files.filter((f) => f.change !== 'unchanged')
      : [];
  if (changed.length === 0) return '';
  const summary = hasTouchInfo
    ? `✏️ Files changed in this PR (${changed.length} of ${files.length})`
    : `✏️ Changed files (${changed.length} of ${files.length})`;
  const shown = rowLimit !== undefined ? changed.slice(0, rowLimit) : changed;
  const lines = ['<details>', `<summary>${summary}</summary>`, '', ...fileTableHeader()];
  for (const file of shown) lines.push(fileRow(report, file, withDeltas));
  if (shown.length < changed.length) {
    lines.push('', `_…${changed.length - shown.length} more changed files omitted._`);
  }
  lines.push('', '</details>');
  return lines.join('\n');
}

/** never an open all-files dump (reference parity); spoiler only, ≤100 files */
function fullFilesSection(report: CoverageReport, withDeltas: boolean): string {
  const files = report.files ?? [];
  if (files.length === 0 || files.length > 100) return '';
  return spoilerTable(report, '📋 Full coverage table', files, withDeltas, 100);
}

/** non-fatal notices (runner thresholds, odd exit codes) — informational only */
function warningsSection(report: CoverageReport): string {
  const warnings = report.warnings ?? [];
  if (warnings.length === 0) return '';
  return ['> [!WARNING]', ...warnings.map((w) => `> ${w}`)].join('\n>\n');
}

function stalenessNote(report: CoverageReport): string {
  const baseline = report.baseline;
  if (!baseline || baseline.staleness <= 0) return '';
  return `> ⚠️ Baseline is ${plural(baseline.staleness, 'commit')} behind the merge base (\`${baseline.sha.slice(0, 7)}\`).`;
}

// ---------------------------------------------------------------------------
// state-specific sections
// ---------------------------------------------------------------------------

function complianceSection(report: CoverageReport): string {
  const required = requiredByMetric(report);
  const metricsWithRequired = METRIC_KEYS.filter((key) => required[key] !== undefined);
  if (metricsWithRequired.length === 0 || !report.totals) return '';

  const failing = metricsWithRequired.filter(
    (key) => report.totals![key].head < (required[key] as number)
  );
  const lines: string[] = [];
  if (failing.length > 0) {
    lines.push(
      '> [!CAUTION]',
      `> **${failing.length} of ${metricsWithRequired.length}** ${
        failing.length === 1 ? 'metric is' : 'metrics are'
      } below the project threshold. Check run marked \`failure\`.`,
      ''
    );
  }
  lines.push(
    '### Threshold compliance',
    '',
    '| Metric | Required | PR | Gap | Status |',
    '| --- | ---: | ---: | ---: | --- |'
  );
  for (const key of metricsWithRequired) {
    const m = report.totals[key];
    const req = required[key] as number;
    const gap = Math.round((m.head - req) * 100) / 100;
    const status = gap >= 0 ? '✅ pass' : '❌ fail';
    const label = gap >= 0 ? METRIC_LABELS[key] : `**${METRIC_LABELS[key]}**`;
    const pr = gap >= 0 ? fmtPct(m.head) : `**${fmtPct(m.head)}**`;
    lines.push(`| ${label} | ${req}% | ${pr} | ${fmtDelta(gap)} | ${status} |`);
  }
  return lines.join('\n');
}

/** ranks files by how many percentage points of the gap full coverage would close */
function shortestPathSection(report: CoverageReport): string {
  const violations = (report.policy?.violations ?? []).filter(
    (v) => v.scope === 'total' && (v.rule === 'threshold' || v.rule === 'override-threshold')
  );
  if (violations.length === 0 || !report.files || !report.totals) return '';

  type Candidate = { path: string; units: number; metric: MetricKey; closesPp: number };
  const candidates: Candidate[] = [];
  for (const violation of violations) {
    const totalUnits = report.totals[violation.metric].total;
    if (!totalUnits) continue;
    for (const file of report.files) {
      const m = file.metrics[violation.metric];
      if (m.covered === undefined || m.total === undefined) continue;
      const units = m.total - m.covered;
      if (units <= 0) continue;
      candidates.push({
        path: file.path,
        units,
        metric: violation.metric,
        closesPp: Math.round((units / totalUnits) * 10000) / 100,
      });
    }
  }
  if (candidates.length === 0) return '';

  // one row per file: keep its highest-impact metric, cap impact at the gap
  const gapByMetric = new Map(violations.map((v) => [v.metric, v.gap]));
  const bestByFile = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const existing = bestByFile.get(candidate.path);
    if (!existing || candidate.closesPp > existing.closesPp) {
      bestByFile.set(candidate.path, candidate);
    }
  }
  const ranked = [...bestByFile.values()].sort((a, b) => b.closesPp - a.closesPp);

  const lines = [
    '### Shortest path to green — smallest set of files that closes the gap',
    '',
    '| File | Uncovered | Impact |',
    '| --- | --- | --- |',
  ];
  for (const candidate of ranked.slice(0, 5)) {
    const gap = gapByMetric.get(candidate.metric) ?? 0;
    const impact =
      candidate.closesPp >= gap
        ? `closes the full ${gap.toFixed(1)}pp ${candidate.metric} gap`
        : `closes ~${candidate.closesPp.toFixed(1)}pp of the ${gap.toFixed(1)}pp ${candidate.metric} gap`;
    lines.push(
      `| \`${candidate.path}\` | ${plural(candidate.units, `uncovered ${candidate.metric.replace(/s$/, '')}`)} | ${impact} |`
    );
  }
  return lines.join('\n');
}

const EXCERPT_MAX_LINES = 10;
const TESTS_PER_SUITE = 5;

/** run-at-a-glance cards for the failure state: failed / passed / skipped / suites */
function testStatsRow(report: CoverageReport): string {
  const t = report.testFailures;
  if (!t) return '';
  const passed = t.numPassedTests;
  const skipped =
    passed !== undefined ? Math.max(t.numTotalTests - passed - t.numFailedTests, 0) : undefined;
  const suites =
    t.numTotalSuites !== undefined
      ? t.numFailedSuites !== undefined
        ? `**${t.numFailedSuites} of ${t.numTotalSuites}** failed`
        : `**${t.numTotalSuites}**`
      : undefined;

  // red/green numbers (same LaTeX trick as the delta pills)
  const red = (n: number) => `$\\color{red}{\\textbf{${n}}}$`;
  const green = (n: number) => `$\\color{green}{\\textbf{${n}}}$`;
  const cells: [string, string][] = [
    ['❌ Failed', t.numFailedTests > 0 ? red(t.numFailedTests) : `**${t.numFailedTests}**`],
  ];
  if (passed !== undefined) cells.push(['✅ Passed', passed > 0 ? green(passed) : `**${passed}**`]);
  if (skipped !== undefined) cells.push(['⏭️ Skipped', `**${skipped}**`]);
  cells.push(['🧪 Total', `**${t.numTotalTests}**`]);
  if (suites !== undefined) cells.push(['📦 Suites', suites]);

  return [
    `| ${cells.map(([label]) => label).join(' | ')} |`,
    `| ${cells.map(() => ':-:').join(' | ')} |`,
    `| ${cells.map(([, value]) => value).join(' | ')} |`,
  ].join('\n');
}

function failedTestsSection(report: CoverageReport): string {
  const failures = report.testFailures;
  if (!failures || failures.numFailedTests === 0) return '';

  const lines = [`### ❌ Failed tests`, ''];

  const bySuite = new Map<string, typeof failures.failedTests>();
  for (const failure of failures.failedTests) {
    const list = bySuite.get(failure.filePath) ?? [];
    list.push(failure);
    bySuite.set(failure.filePath, list);
  }

  let first = true;
  for (const [filePath, tests] of bySuite) {
    const url = blobUrl(report, filePath);
    const suiteLabel = url
      ? `<a href="${url}"><code>${filePath}</code></a>`
      : `<code>${filePath}</code>`;
    lines.push(
      `<details${first ? ' open' : ''}>`,
      `<summary>🔴 ${suiteLabel} — ${plural(tests.length, 'failed test')}</summary>`,
      ''
    );
    for (const test of tests.slice(0, TESTS_PER_SUITE)) {
      lines.push(`- ❌ **${test.testName}**`);
      if (test.message) {
        // strip ANSI color codes and surrounding blank lines — raw escape
        // sequences in the excerpt read as garbage in the comment
        // eslint-disable-next-line no-control-regex
        const clean = test.message.replace(/\x1b\[[0-9;]*m/g, '').replace(/^\n+|\n+$/g, '');
        const excerpt = clean.split('\n').slice(0, EXCERPT_MAX_LINES).join('\n');
        if (excerpt) {
          lines.push('', '  ```', ...excerpt.split('\n').map((l) => `  ${l}`), '  ```', '');
        }
      }
    }
    if (tests.length > TESTS_PER_SUITE) {
      lines.push(`- _…${tests.length - TESTS_PER_SUITE} more failures in this suite._`);
    }
    lines.push('', '</details>', '');
    first = false;
  }
  return lines.join('\n').trimEnd();
}

/** merge-blocked callout for the failure state */
function testsFailedAlert(report: CoverageReport): string {
  const failures = report.testFailures;
  if (!failures || failures.numFailedTests === 0) return '';
  const of = failures.numTotalTests > 0 ? ` of ${failures.numTotalTests}` : '';
  return [
    '> [!CAUTION]',
    `> **${plural(failures.numFailedTests, 'test')}${of} failed** — the check is marked \`failure\`, so the PR cannot merge until the test run passes.`,
  ].join('\n');
}

type Severity = 'critical' | 'warning';

function regressionSeverity(file: FileReport, violations: PolicyViolation[]): Severity {
  const bigDrop = METRIC_KEYS.some((key) => {
    const delta = file.metrics[key].delta;
    return delta !== null && delta < -5;
  });
  const belowPathThreshold = violations.some(
    (v) => v.scope === file.path && (v.rule === 'override-threshold' || v.rule === 'threshold')
  );
  return bigDrop || belowPathThreshold ? 'critical' : 'warning';
}

function regressionsSection(report: CoverageReport): string {
  const files = report.files ?? [];
  const violations = report.policy?.violations ?? [];
  const regressed = files.filter((f) =>
    METRIC_KEYS.some((key) => {
      const delta = f.metrics[key].delta;
      return delta !== null && delta < 0;
    })
  );
  if (regressed.length === 0) return '';

  // sorted by impact: worst single-metric drop first
  const impact = (f: FileReport) =>
    Math.min(...METRIC_KEYS.map((key) => f.metrics[key].delta ?? 0));
  regressed.sort((a, b) => impact(a) - impact(b));

  const ratchetBlocked = new Set(
    violations.filter((v) => v.rule === 'ratchet-file').map((v) => v.scope)
  );

  const lines = [
    `### 🔻 Coverage regressions — ${plural(regressed.length, 'file')} _(sorted by impact)_`,
    '',
    '_Files where this PR reduced coverage. Ratchet policy treats these as violations even when the project threshold is still met._',
    '',
  ];

  for (const file of regressed.slice(0, 10)) {
    const severity = regressionSeverity(file, violations);
    const badges = [
      severity === 'critical' ? '🔴 critical' : '🟡 warning',
      ...(ratchetBlocked.has(file.path) ? ['blocks ratchet'] : []),
      ...(touchedBadge(file) ? [touchedBadge(file)] : []),
    ];
    const drops = METRIC_KEYS.filter((key) => (file.metrics[key].delta ?? 0) < 0).map(
      (key) => `${key} ${fmtArrow(file.metrics[key])}`
    );
    const uncovered = file.uncoveredRanges?.length
      ? ` · uncovered: ${fmtRanges(file.uncoveredRanges)}`
      : '';
    lines.push(`- **\`${file.path}\`** — ${badges.join(' · ')}`);
    lines.push(`  ${drops.join(' · ')}${uncovered}`);
  }
  if (regressed.length > 10) {
    lines.push(`- _…${regressed.length - 10} more regressed files in the full table._`);
  }
  lines.push(
    '',
    '> [!IMPORTANT]',
    '> 🔴 critical: drop > 5pp or below a path threshold · 🟡 warning: any decrease'
  );
  return lines.join('\n');
}

function errorsSection(report: CoverageReport): string {
  const errors = report.errors ?? [];
  if (errors.length === 0) return '';
  const lines = ['### ⚙️ What went wrong', ''];
  for (const error of errors) {
    lines.push(
      '> [!WARNING]',
      `> **\`${error.input}\`** — ${error.message}`,
      ...(error.hint ? ['>', `> 🛠️ **Fix:** ${error.hint}`] : []),
      ''
    );
  }
  return lines.join('\n').trimEnd();
}

const PROJECT_STATE_BADGES: Partial<Record<ReportState, string>> = {
  passed: '✅ passed',
  'threshold-failed': '❌ gate failed',
  regression: '🔻 regression',
  'no-change': '✅ unchanged',
  'no-baseline': 'ℹ️ no baseline',
};

function monorepoSection(report: CoverageReport): string {
  const projects = report.projects ?? [];
  if (projects.length === 0) return '';
  const lines = [
    '### Projects',
    '',
    '| Project | Status | Lines | Δ |',
    '| --- | --- | ---: | ---: |',
  ];
  for (const project of projects) {
    const m = project.totals.lines;
    lines.push(
      `| ${project.name} | ${PROJECT_STATE_BADGES[project.state] ?? project.state} | ${fmtPct(m.head)} | ${fmtDelta(m.delta)} |`
    );
  }
  lines.push('');
  for (const project of projects) {
    lines.push(projectDetails(report, project), '');
  }
  return lines.join('\n').trimEnd();
}

function projectDetails(report: CoverageReport, project: ProjectReport): string {
  const lines = [
    '<details>',
    `<summary>${project.name} — ${plural(project.files.length, 'file')}</summary>`,
    '',
    ...fileTableHeader(),
  ];
  for (const file of project.files) lines.push(fileRow(report, file, true));
  lines.push('', '</details>');
  return lines.join('\n');
}

const ACTION_URL = 'https://github.com/subhashmahimaluri/vite-pr-coverage-insight';

function footer(report: CoverageReport, opts: RenderMarkdownOptions): string {
  const links: string[] = [];
  if (opts.htmlReportUrl) links.push(`[Interactive report](${opts.htmlReportUrl})`);
  let generated = `Report generated by [coverage-insight](${ACTION_URL})`;
  const sha = report.pr?.headSha;
  if (sha && report.repo) {
    generated += ` from [\`${sha.slice(0, 7)}\`](https://github.com/${report.repo.owner}/${report.repo.repo}/commit/${sha})`;
  }
  return `---\n\n_${[...links, generated].join(' · ')}_`;
}

// ---------------------------------------------------------------------------
// assembly + truncation
// ---------------------------------------------------------------------------

type Section = {
  text: string;
  /** never dropped (verdict, callouts, compliance) */
  protected?: boolean;
  fullTable?: boolean;
  changedFiles?: { files: FileReport[]; withDeltas: boolean };
};

/**
 * PR-true metric CARDS rendered by shields.io straight from the URL — no file
 * has to be committed anywhere, so this works without `contents: write`.
 * One card per metric: name, a big color-coded percentage box, a colored
 * delta badge, and covered/total. Used in images mode when no live per-PR
 * band SVG could be published. Public repos only (the `images` visuals mode
 * already guarantees that).
 */
function shieldsCardsSection(report: CoverageReport): string {
  const totals = report.totals;
  if (!totals) return '';
  // the SVG band's palette — deep GitHub greens, not shields' neon defaults
  const bandHex = (pct: number): string => (pct >= 80 ? '1a7f37' : pct >= 60 ? '9a6700' : 'cf222e');
  const cells = METRIC_KEYS.map((key) => {
    const m = totals[key];
    // ONE badge per card: value + delta together, calm and readable.
    // U+2212 minus (not ASCII '-') so shields doesn't treat it as a separator.
    const delta =
      m.delta === null
        ? ''
        : m.delta === 0
          ? '  ±0.00'
          : `  ${m.delta > 0 ? '▲' : '▼'} ${m.delta > 0 ? '+' : '−'}${Math.abs(m.delta).toFixed(2)}`;
    const message = encodeURIComponent(`${m.head.toFixed(1)}%${delta}`);
    const badge =
      `<img alt="${METRIC_LABELS[key]} ${m.head.toFixed(1)}% (Δ${delta.trim() || ' n/a'})" ` +
      `src="https://img.shields.io/badge/${message}-${bandHex(m.head)}?style=for-the-badge">`;
    const counts =
      typeof m.covered === 'number' && typeof m.total === 'number'
        ? `<br><sub>${m.covered} / ${m.total} covered</sub>`
        : '';
    return [
      '<td align="center">',
      `<sub><b>${METRIC_LABELS[key].toUpperCase()}</b></sub><br>`,
      `${badge}${counts}`,
      '</td>',
    ].join('\n');
  });
  return [
    '<table><tr>',
    ...cells,
    '</tr></table>',
    '',
    '<sub>This PR’s coverage · ▲▼ vs base · grant `contents: write` in the workflow for the full band with 🚦 gate card and trend sparklines</sub>',
  ].join('\n');
}

function metricBandSection(opts: RenderMarkdownOptions): string {
  if (opts.visuals !== 'images' || !opts.badgeImages) return '';
  const lines = [
    '<picture>',
    `  <source media="(prefers-color-scheme: dark)" srcset="${opts.badgeImages.dark}">`,
    `  <img alt="coverage metrics: value, covered/total, delta and trend per metric" src="${opts.badgeImages.light}">`,
    '</picture>',
  ];
  if (opts.bandCaption) lines.push('', `<sub>${opts.bandCaption}</sub>`);
  return lines.join('\n');
}

function sectionsFor(report: CoverageReport, opts: RenderMarkdownOptions): Section[] {
  const files = report.files ?? [];
  const sections: Section[] = [];
  const push = (text: string, flags: Omit<Section, 'text'> = {}) => {
    if (text) sections.push({ text, ...flags });
  };

  // headline graphs — ALWAYS this PR's data: the live per-PR SVG band when
  // the caller published one, otherwise shields.io badge cards built from
  // the report itself. Failure/error states show no graphs at all.
  const bandStates: ReportState[] = ['passed', 'no-change', 'threshold-failed', 'regression'];
  const band = bandStates.includes(report.state)
    ? metricBandSection(opts) || (opts.visuals === 'images' ? shieldsCardsSection(report) : '')
    : '';
  // when the cards are shown they carry covered/total — drop the table column
  const showCounts = band === '';

  push(warningsSection(report), { protected: true });
  push(band, { protected: true });
  push(stalenessNote(report), { protected: true });

  const deltaGroups = (withDeltasFlag: boolean) => {
    push(changedFilesSection(report, withDeltasFlag), {
      changedFiles: { files, withDeltas: withDeltasFlag },
    });
    if (withDeltasFlag) {
      push(newFilesSection(report));
      push(reducedFilesSection(report));
    }
    if (opts.visuals !== 'text') push(trendChartSection(report));
    push(fullFilesSection(report, withDeltasFlag), { fullTable: true });
    push(testRunSection(report));
  };

  // with the metric cards visible, the detailed tables collapse into one
  // spoiler (this PR first, then base); without cards the PR table stays open
  const detailTables = (withDeltasFlag: boolean) =>
    band !== ''
      ? coverageTablesSpoiler(report, withDeltasFlag)
      : totalsSection(report, withDeltasFlag, showCounts);

  switch (report.state) {
    case 'passed':
    case 'no-change':
      push(detailTables(true), { protected: true });
      deltaGroups(true);
      break;

    case 'threshold-failed':
      push(complianceSection(report), { protected: true });
      push(shortestPathSection(report), { protected: true });
      push(detailTables(true));
      deltaGroups(true);
      break;

    case 'regression':
      push(regressionsSection(report), { protected: true });
      push(detailTables(true));
      deltaGroups(true);
      break;

    case 'tests-failed': {
      push(testsFailedAlert(report), { protected: true });
      push(testStatsRow(report), { protected: true });
      push(failedTestsSection(report), { protected: true });
      push(errorsSection(report), { protected: true });
      // only this PR's own numbers — no base-branch band, no trend; with the
      // head input broken (a failed run often writes no coverage) the zeroed
      // totals would be noise, so they are skipped entirely
      const headBroken = (report.errors ?? []).length > 0;
      if (!headBroken) {
        push(
          "> [!NOTE]\n> Coverage below is from this PR's failed run and may be partial — the coverage gate is deferred until tests pass."
        );
        push(totalsSection(report, false), { protected: true });
        push(changedFilesSection(report, false), {
          changedFiles: { files, withDeltas: false },
        });
      }
      break;
    }

    case 'no-baseline':
      push(
        '> [!NOTE]\n> No baseline was found — absolute coverage only. Deltas will appear once the next baseline run records one.',
        { protected: true }
      );
      push(totalsSection(report, false, showCounts), { protected: true });
      deltaGroups(false);
      break;

    case 'invalid-data':
      push(errorsSection(report), { protected: true });
      break;

    case 'monorepo':
      push(monorepoSection(report), { protected: true });
      break;
  }
  return sections;
}

function assemble(marker: string, header: string, parts: string[]): string {
  return [marker, header, ...parts.filter(Boolean)].join('\n\n');
}

export function renderMarkdown(report: CoverageReport, opts: RenderMarkdownOptions = {}): string {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const header = headerBlock(report);

  // state 7 — single-line minimal comment
  if (report.state === 'no-change') {
    const warningBlock = warningsSection(report);
    return [`${COMMENT_MARKER}\n${HEADERS['no-change']}`, warningBlock]
      .filter(Boolean)
      .join('\n\n');
  }

  let sections = sectionsFor(report, opts);
  let output = assemble(COMMENT_MARKER, header, [
    ...sections.map((s) => s.text),
    footer(report, opts),
  ]);
  if (output.length <= maxChars) return output;

  const notice = opts.htmlReportUrl
    ? `… truncated — see the [full HTML report](${opts.htmlReportUrl})`
    : '… truncated — see the full HTML report';

  // step 1 — drop the collapsed full table(s)
  sections = sections.filter((s) => !s.fullTable);
  output = assemble(COMMENT_MARKER, header, [
    ...sections.map((s) => s.text),
    notice,
    footer(report, opts),
  ]);
  if (output.length <= maxChars) return output;

  // step 2 — cap the changed-files table
  sections = sections.map((s) =>
    s.changedFiles
      ? {
          ...s,
          text: changedFilesSection(
            report,
            s.changedFiles.withDeltas,
            CHANGED_ROW_LIMIT_WHEN_TRUNCATING
          ),
        }
      : s
  );
  output = assemble(COMMENT_MARKER, header, [
    ...sections.map((s) => s.text),
    notice,
    footer(report, opts),
  ]);
  if (output.length <= maxChars) return output;

  // step 3 — keep only protected sections
  sections = sections.filter((s) => s.protected);
  return assemble(COMMENT_MARKER, header, [
    ...sections.map((s) => s.text),
    notice,
    footer(report, opts),
  ]);
}
