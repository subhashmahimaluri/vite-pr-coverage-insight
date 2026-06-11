import {
  METRIC_KEYS,
  type CoverageReport,
  type FileReport,
  type MetricDelta,
  type MetricKey,
  type ProjectReport,
  type ReportState,
} from '@coverage-insight/core';

/**
 * Stage 4.2 — Markdown renderer v2.
 * A state machine over the stage 4.1 CoverageReport (never raw coverage).
 * Implements all 8 report states plus the cross-state rules:
 *   - one comment updated in place via the D5 marker (first raw line)
 *   - verdict header is the first visible line
 *   - thresholds shown next to actuals when policy provides them
 *   - changed files always before the full table; full table collapsed
 *   - graceful truncation under GitHub's 65536-char comment limit
 */

/** Decision D5 — the exact in-place comment marker, always the first line. */
export const COMMENT_MARKER = '<!-- coverage-insight -->';

export type RenderMarkdownOptions = {
  /** link target for the truncation notice */
  htmlReportUrl?: string;
  /** hard output budget (default 65000, under GitHub's 65536) */
  maxChars?: number;
};

const DEFAULT_MAX_CHARS = 65000;
const TRUNCATED_FILE_ROWS = 50;
const MAX_TESTS_PER_SUITE = 5;
const MAX_LINES_PER_TEST_NAME = 10;
const SHORTEST_PATH_TOP = 5;
const CRITICAL_DROP_PP = 5;

const HEADERS: Record<ReportState, string> = {
  passed: '✅ Coverage gate passed',
  'threshold-failed': '❌ Coverage gate failed',
  'tests-failed': '🛑 Tests failed',
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

const THRESHOLD_RULES = new Set(['threshold', 'override-threshold']);

// ---------------------------------------------------------------------------
// formatting primitives
// ---------------------------------------------------------------------------

function fmtPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

function fmtDelta(delta: number | null): string {
  if (delta === null) return '—';
  const text = delta.toFixed(2);
  return delta > 0 ? `+${text}` : text;
}

function fmtRanges(ranges: { start: number; end: number }[] | undefined): string {
  if (!ranges || ranges.length === 0) return '—';
  const shown = ranges.slice(0, 6);
  const text = shown.map((r) => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`));
  if (ranges.length > shown.length) text.push('…');
  return text.join(', ');
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// shared sections
// ---------------------------------------------------------------------------

/** required pct per metric for the total scope, derived from policy violations. */
function requiredByMetric(report: CoverageReport): Partial<Record<MetricKey, number>> {
  const required: Partial<Record<MetricKey, number>> = {};
  for (const violation of report.policy?.violations ?? []) {
    if (violation.scope === 'total') required[violation.metric] = violation.required;
  }
  return required;
}

function totalsTable(report: CoverageReport, withDeltas: boolean): string {
  const totals = report.totals;
  if (!totals) return '';
  const required = requiredByMetric(report);
  const lines: string[] = ['### Coverage totals', ''];
  if (withDeltas) {
    lines.push('| Metric | Base | Head | Δ |', '| --- | ---: | ---: | ---: |');
  } else {
    lines.push('| Metric | Coverage |', '| --- | ---: |');
  }
  for (const key of METRIC_KEYS) {
    const m: MetricDelta = totals[key];
    const req = required[key];
    const actual = req === undefined ? fmtPct(m.head) : `${fmtPct(m.head)} (required ${req}%)`;
    if (withDeltas) {
      lines.push(
        `| ${METRIC_LABELS[key]} | ${m.base === null ? '—' : fmtPct(m.base)} | ${actual} | ${fmtDelta(m.delta)} |`
      );
    } else {
      lines.push(`| ${METRIC_LABELS[key]} | ${actual} |`);
    }
  }
  return lines.join('\n');
}

function fileRow(file: FileReport, withDeltas: boolean): string {
  const cells = METRIC_KEYS.map((key) => {
    const m = file.metrics[key];
    return withDeltas && m.delta !== null
      ? `${fmtPct(m.head)} (${fmtDelta(m.delta)})`
      : fmtPct(m.head);
  });
  return `| \`${file.path}\` | ${file.change} | ${cells.join(' | ')} | ${fmtRanges(file.uncoveredRanges)} |`;
}

function fileTableHeader(): string[] {
  return [
    '| File | Change | Statements | Branches | Functions | Lines | Uncovered |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- |',
  ];
}

function changedFilesSection(files: FileReport[], withDeltas: boolean, rowLimit?: number): string {
  const changed = files.filter((f) => f.change !== 'unchanged');
  if (changed.length === 0) return '';
  const shown = rowLimit !== undefined ? changed.slice(0, rowLimit) : changed;
  const lines = ['### Changed files', '', ...fileTableHeader()];
  for (const file of shown) lines.push(fileRow(file, withDeltas));
  if (shown.length < changed.length) {
    lines.push('', `_…${changed.length - shown.length} more changed files omitted._`);
  }
  return lines.join('\n');
}

function fullFilesSection(files: FileReport[], withDeltas: boolean): string {
  if (files.length === 0) return '';
  const lines = [
    '<details>',
    `<summary>All files (${files.length})</summary>`,
    '',
    ...fileTableHeader(),
  ];
  for (const file of files) lines.push(fileRow(file, withDeltas));
  lines.push('', '</details>');
  return lines.join('\n');
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
  const violations = (report.policy?.violations ?? []).filter((v) => THRESHOLD_RULES.has(v.rule));
  if (violations.length === 0) return '';
  const lines = [
    '### Compliance',
    '',
    '| Metric | Required | Actual | Gap |',
    '| --- | ---: | ---: | ---: |',
  ];
  for (const v of violations) {
    const metric =
      v.scope === 'total' ? METRIC_LABELS[v.metric] : `${METRIC_LABELS[v.metric]} (\`${v.scope}\`)`;
    lines.push(
      `| ${metric} | ${fmtPct(v.required)} | ${fmtPct(v.actual)} | ${v.gap.toFixed(2)}pp |`
    );
  }
  return lines.join('\n');
}

function shortestPathSection(report: CoverageReport): string {
  const violations = (report.policy?.violations ?? []).filter((v) => THRESHOLD_RULES.has(v.rule));
  if (violations.length === 0) return '';

  type Candidate = {
    path: string;
    metric: MetricKey;
    required: number;
    actual: number;
    gap: number;
  };
  let candidates: Candidate[] = violations
    .filter((v) => v.scope !== 'total')
    .map((v) => ({
      path: v.scope,
      metric: v.metric,
      required: v.required,
      actual: v.actual,
      gap: v.gap,
    }));

  if (candidates.length === 0) {
    // only total-scope violations: rank files by how far they sit below the
    // violated total threshold (largest shortfall = biggest contribution)
    for (const v of violations.filter((x) => x.scope === 'total')) {
      for (const file of report.files ?? []) {
        const actual = file.metrics[v.metric].head;
        const gap = v.required - actual;
        if (gap > 0) {
          candidates.push({ path: file.path, metric: v.metric, required: v.required, actual, gap });
        }
      }
    }
  }
  if (candidates.length === 0) return '';

  candidates = candidates
    .sort((a, b) => b.gap - a.gap || a.path.localeCompare(b.path))
    .slice(0, SHORTEST_PATH_TOP);

  const lines = ['### Shortest path to green', ''];
  candidates.forEach((c, i) => {
    lines.push(
      `${i + 1}. \`${c.path}\` — ${METRIC_LABELS[c.metric].toLowerCase()} ${fmtPct(c.actual)} → ${fmtPct(c.required)} required (gap ${c.gap.toFixed(2)}pp)`
    );
  });
  return lines.join('\n');
}

function failedTestsSection(report: CoverageReport): string {
  const failures = report.testFailures;
  if (!failures || failures.numFailedTests === 0) return '';
  const lines = [
    `**${failures.numFailedTests} of ${failures.numTotalTests} tests failed.**`,
    '',
    '### Failed tests',
  ];
  const bySuite = new Map<string, string[]>();
  for (const test of failures.failedTests) {
    const list = bySuite.get(test.filePath) ?? [];
    list.push(test.testName);
    bySuite.set(test.filePath, list);
  }
  for (const [suite, tests] of bySuite) {
    lines.push('', `**\`${suite}\`**`);
    for (const name of tests.slice(0, MAX_TESTS_PER_SUITE)) {
      const nameLines = name.split('\n');
      const shown = nameLines.slice(0, MAX_LINES_PER_TEST_NAME).join('\n  ');
      lines.push(`- ✗ ${shown}${nameLines.length > MAX_LINES_PER_TEST_NAME ? '\n  …' : ''}`);
    }
    if (tests.length > MAX_TESTS_PER_SUITE) {
      lines.push(`- _…and ${tests.length - MAX_TESTS_PER_SUITE} more in this suite_`);
    }
  }
  return lines.join('\n');
}

function regressionsSection(report: CoverageReport): string {
  const files = report.files ?? [];
  const violatedPaths = new Set(
    (report.policy?.violations ?? []).filter((v) => v.scope !== 'total').map((v) => v.scope)
  );
  const rows: string[] = [];
  for (const file of files) {
    for (const key of METRIC_KEYS) {
      const m = file.metrics[key];
      if (m.delta === null || m.delta >= 0) continue;
      const critical = m.delta < -CRITICAL_DROP_PP || violatedPaths.has(file.path);
      const severity = critical ? '🔴 critical' : '🟡 warning';
      const touched = file.change === 'modified' ? ' (touched)' : '';
      rows.push(
        `| \`${file.path}\`${touched} | ${METRIC_LABELS[key]} | ${m.base === null ? '—' : fmtPct(m.base)} | ${fmtPct(m.head)} | ${fmtDelta(m.delta)} | ${severity} |`
      );
    }
  }
  if (rows.length === 0) return '';
  return [
    '### Regressions',
    '',
    '| File | Metric | Base | Head | Δ | Severity |',
    '| --- | --- | ---: | ---: | ---: | --- |',
    ...rows,
  ].join('\n');
}

function errorsSection(report: CoverageReport): string {
  const errors = report.errors ?? [];
  if (errors.length === 0) {
    return '_No error details were provided in the report._';
  }
  const lines: string[] = ['The coverage report could not be produced from the given inputs:', ''];
  for (const error of errors) {
    lines.push(`- **\`${error.input}\`** — ${error.message}`);
    if (error.hint) lines.push(`  - Fix: ${error.hint}`);
  }
  return lines.join('\n');
}

function projectStateBadge(state: ReportState): string {
  return HEADERS[state];
}

function monorepoSection(report: CoverageReport): string {
  const projects = report.projects ?? [];
  if (projects.length === 0) return '';
  const lines = ['| Project | Verdict | Lines | Δ |', '| --- | --- | ---: | ---: |'];
  for (const project of projects) {
    const m = project.totals.lines;
    lines.push(
      `| \`${project.name}\` | ${projectStateBadge(project.state)} | ${fmtPct(m.head)} | ${fmtDelta(m.delta)} |`
    );
  }
  for (const project of projects) {
    lines.push('', ...projectDetails(project).split('\n'));
  }
  return lines.join('\n');
}

function projectDetails(project: ProjectReport): string {
  const lines = [
    '<details>',
    `<summary>${project.name} — ${plural(project.files.length, 'file')}</summary>`,
    '',
  ];
  const changed = changedFilesSection(project.files, true);
  if (changed) lines.push(changed, '');
  lines.push(...fileTableHeader());
  for (const file of project.files) lines.push(fileRow(file, true));
  lines.push('', '</details>');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// assembly + truncation
// ---------------------------------------------------------------------------

type Section = {
  text: string;
  /** never dropped or shortened (verdict, compliance table, marker) */
  protected?: boolean;
  /** dropped first when over budget */
  fullTable?: boolean;
  /** rebuilt with a row limit when still over budget */
  changedFiles?: { files: FileReport[]; withDeltas: boolean };
};

function sectionsFor(report: CoverageReport, withDeltas: boolean): Section[] {
  const files = report.files ?? [];
  const sections: Section[] = [];
  const push = (text: string, extra: Omit<Section, 'text'> = {}): void => {
    if (text) sections.push({ text, ...extra });
  };

  switch (report.state) {
    case 'passed':
      push(stalenessNote(report));
      push(totalsTable(report, true));
      push(changedFilesSection(files, true), { changedFiles: { files, withDeltas: true } });
      push(fullFilesSection(files, true), { fullTable: true });
      break;
    case 'threshold-failed':
      push(stalenessNote(report));
      push(complianceSection(report), { protected: true });
      push(shortestPathSection(report));
      push(totalsTable(report, true));
      push(changedFilesSection(files, true), { changedFiles: { files, withDeltas: true } });
      push(fullFilesSection(files, true), { fullTable: true });
      break;
    case 'tests-failed':
      push(failedTestsSection(report));
      push('> The coverage gate is deferred until tests pass.');
      push(stalenessNote(report));
      push(
        totalsTable(report, withDeltas).replace(
          '### Coverage totals',
          '### Coverage (partial — tests failed)'
        )
      );
      push(changedFilesSection(files, withDeltas), { changedFiles: { files, withDeltas } });
      push(fullFilesSection(files, withDeltas), { fullTable: true });
      break;
    case 'regression':
      push(stalenessNote(report));
      push(regressionsSection(report), { protected: true });
      push(totalsTable(report, true));
      push(changedFilesSection(files, true), { changedFiles: { files, withDeltas: true } });
      push(fullFilesSection(files, true), { fullTable: true });
      break;
    case 'no-baseline':
      push(
        '_No baseline was found — absolute coverage only. Deltas will appear once the next baseline run records one._'
      );
      push(totalsTable(report, false));
      push(changedFilesSection(files, false), { changedFiles: { files, withDeltas: false } });
      push(fullFilesSection(files, false), { fullTable: true });
      break;
    case 'invalid-data':
      push(errorsSection(report), { protected: true });
      break;
    case 'monorepo':
      push(stalenessNote(report));
      push(monorepoSection(report), { fullTable: true });
      break;
    case 'no-change':
      break;
  }
  return sections;
}

function assemble(marker: string, header: string, bodies: string[]): string {
  return [marker, header, ...bodies.filter((b) => b.length > 0)].join('\n\n');
}

/**
 * Renders the PR comment for a CoverageReport. Pure function of the report
 * and options (D7) — the same report always renders the same markdown.
 */
export function renderMarkdown(report: CoverageReport, opts: RenderMarkdownOptions = {}): string {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const header = HEADERS[report.state];

  // state 7 — single-line minimal comment
  if (report.state === 'no-change') {
    return `${COMMENT_MARKER}\n${header}`;
  }

  const withDeltas = report.baseline !== null || (report.totals?.lines.base ?? null) !== null;
  let sections = sectionsFor(report, withDeltas);
  let output = assemble(
    COMMENT_MARKER,
    header,
    sections.map((s) => s.text)
  );
  if (output.length <= maxChars) return output;

  const notice = opts.htmlReportUrl
    ? `… truncated — see the [full HTML report](${opts.htmlReportUrl})`
    : '… truncated — see the full HTML report';

  // step 1 — drop the collapsed full table(s)
  sections = sections.filter((s) => !s.fullTable);
  output = assemble(COMMENT_MARKER, header, [...sections.map((s) => s.text), notice]);
  if (output.length <= maxChars) return output;

  // step 2 — cap file rows beyond the first 50
  sections = sections.map((s) =>
    s.changedFiles
      ? {
          ...s,
          text: changedFilesSection(
            s.changedFiles.files,
            s.changedFiles.withDeltas,
            TRUNCATED_FILE_ROWS
          ),
        }
      : s
  );
  output = assemble(COMMENT_MARKER, header, [...sections.map((s) => s.text), notice]);
  if (output.length <= maxChars) return output;

  // step 3 — drop unprotected sections from the end until the budget fits.
  // The verdict line and protected sections (compliance table) always survive.
  for (let i = sections.length - 1; i >= 0 && output.length > maxChars; i--) {
    if (sections[i]?.protected) continue;
    sections.splice(i, 1);
    output = assemble(COMMENT_MARKER, header, [...sections.map((s) => s.text), notice]);
  }
  return output;
}
