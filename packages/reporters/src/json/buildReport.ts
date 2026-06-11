import {
  coverageReportSchema,
  METRIC_KEYS,
  REPORT_SCHEMA_VERSION,
  type BaselineMeta,
  type CoverageModel,
  type CoverageReport,
  type FileCoverage,
  type FileReport,
  type MetricDelta,
  type MetricKey,
  type PolicyResult,
  type ProjectReport,
  type ReportState,
  type TestFailuresResult,
} from '@coverage-insight/core';

/**
 * Stage 4.1 — JSON reporter (decision D6).
 * Builds the versioned coverage-report.json from the normalized coverage
 * model plus the policy/test/baseline context. The output is the single
 * integration surface for the markdown renderer, the HTML report, agents,
 * and skills — none of them ever read raw coverage files.
 */

export type InputError = {
  /** which input (base / head / test-failures / config) */
  input: string;
  /** what was wrong */
  message: string;
  /** how to fix it */
  hint?: string;
};

export type HistoryPoint = { sha: string; timestamp?: string; lines: number };

export type BuildReportInput = {
  head: CoverageModel;
  base?: CoverageModel | null;
  policy?: PolicyResult;
  testFailures?: TestFailuresResult | null;
  baseline?: BaselineMeta | null;
  repo?: { owner: string; repo: string };
  pr?: { number: number; headSha?: string };
  /** ISO timestamp supplied by the caller (D7 — determinism stays testable) */
  generatedAt: string;
  /** state 8 only — per-project reports for monorepos */
  projects?: ProjectReport[];
  /** state 6 only — input errors */
  errors?: InputError[];
  /** history series for sparklines, newest last */
  history?: HistoryPoint[];
  /** repo-relative paths changed in the PR's git diff — marks FileReport.touched */
  touchedFiles?: string[];
  /** policy context for the header line, e.g. {description: 'min 90% · ratchet', source: 'coverage-insight.config.json'} */
  policyMeta?: {
    description: string;
    source?: string;
    thresholds?: Partial<Record<MetricKey, number>>;
  };
};

/** Rounds to 2 decimals (D7: same input ⇒ same output, no float drift). */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Collapses sorted 1-based line numbers into inclusive {start, end} ranges. */
export function collapseUncoveredRanges(lines: number[]): { start: number; end: number }[] {
  const sorted = [...lines].sort((a, b) => a - b);
  const ranges: { start: number; end: number }[] = [];
  for (const line of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && line === last.end + 1) {
      last.end = line;
    } else if (last && line <= last.end) {
      // duplicate line number — already covered by the open range
    } else {
      ranges.push({ start: line, end: line });
    }
  }
  return ranges;
}

function metricDelta(
  headMetric: { pct: number; covered: number; total: number },
  basePct: number | null
): MetricDelta {
  const head = round2(headMetric.pct);
  const counts = { covered: headMetric.covered, total: headMetric.total };
  if (basePct === null) return { base: null, head, delta: null, ...counts };
  const base = round2(basePct);
  return { base, head, delta: round2(head - base), ...counts };
}

function buildTotals(
  head: CoverageModel,
  base: CoverageModel | null
): Record<MetricKey, MetricDelta> {
  const totals = {} as Record<MetricKey, MetricDelta>;
  for (const key of METRIC_KEYS) {
    totals[key] = metricDelta(head.total[key], base ? base.total[key].pct : null);
  }
  return totals;
}

function classifyChange(
  headFile: FileCoverage,
  baseFile: FileCoverage | undefined,
  hasBase: boolean
): FileReport['change'] {
  if (!hasBase || !baseFile) return 'new';
  const modified = METRIC_KEYS.some(
    (key) => round2(headFile.metrics[key].pct) !== round2(baseFile.metrics[key].pct)
  );
  return modified ? 'modified' : 'unchanged';
}

function buildFiles(
  head: CoverageModel,
  base: CoverageModel | null,
  touchedFiles?: string[]
): FileReport[] {
  const baseByPath = new Map<string, FileCoverage>();
  for (const file of base?.files ?? []) baseByPath.set(file.path, file);
  const touched = touchedFiles ? new Set(touchedFiles) : null;

  return head.files.map((file) => {
    const baseFile = baseByPath.get(file.path);
    const metrics = {} as Record<MetricKey, MetricDelta>;
    for (const key of METRIC_KEYS) {
      metrics[key] = metricDelta(file.metrics[key], baseFile ? baseFile.metrics[key].pct : null);
    }
    const uncoveredRanges = file.uncoveredLines?.length
      ? collapseUncoveredRanges(file.uncoveredLines)
      : undefined;
    return {
      path: file.path,
      change: classifyChange(file, baseFile, base !== null),
      ...(touched ? { touched: touched.has(file.path) } : {}),
      metrics,
      ...(uncoveredRanges ? { uncoveredRanges } : {}),
    };
  });
}

const THRESHOLD_RULES = new Set(['threshold', 'override-threshold']);
const RATCHET_RULES = new Set(['ratchet-total', 'ratchet-file']);

/**
 * State classification — documented priority order (highest wins):
 *   1. tests-failed     testFailures.numFailedTests > 0 — failed tests are the
 *                       headline even when inputs are also broken (a failing
 *                       run often produces no coverage file at all)
 *   2. invalid-data     errors nonempty
 *   3. monorepo         projects nonempty
 *   4. no-baseline      no base model
 *   5. threshold-failed policy.verdict === 'fail' with a threshold/override violation
 *   6. regression       any file metric delta < 0, or any ratchet violation
 *   7. no-change        every total delta is 0
 *   8. passed           everything else
 */
function classifyState(
  input: BuildReportInput,
  base: CoverageModel | null,
  totals: Record<MetricKey, MetricDelta>,
  files: FileReport[]
): ReportState {
  if (input.testFailures && input.testFailures.numFailedTests > 0) return 'tests-failed';
  if (input.errors && input.errors.length > 0) return 'invalid-data';
  if (input.projects && input.projects.length > 0) return 'monorepo';
  if (!base) return 'no-baseline';

  const violations = input.policy?.violations ?? [];
  if (
    input.policy?.verdict === 'fail' &&
    violations.some((violation) => THRESHOLD_RULES.has(violation.rule))
  ) {
    return 'threshold-failed';
  }

  const hasFileRegression = files.some((file) =>
    METRIC_KEYS.some((key) => {
      const delta = file.metrics[key].delta;
      return delta !== null && delta < 0;
    })
  );
  const hasRatchetViolation = violations.some((violation) => RATCHET_RULES.has(violation.rule));
  if (hasFileRegression || hasRatchetViolation) return 'regression';

  const allZero = METRIC_KEYS.every((key) => totals[key].delta === 0);
  if (allZero) return 'no-change';

  return 'passed';
}

/**
 * Builds a schemaVersion-1 CoverageReport. The result is parsed against
 * coverageReportSchema before it is returned — an invalid shape throws.
 */
export function buildReport(input: BuildReportInput): CoverageReport {
  const base = input.base ?? null;
  const totals = buildTotals(input.head, base);
  const files = buildFiles(input.head, base, input.touchedFiles);
  const state = classifyState(input, base, totals, files);

  const report: CoverageReport = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    state,
    ...(input.repo ? { repo: input.repo } : {}),
    ...(input.pr ? { pr: input.pr } : {}),
    totals,
    files,
    ...(input.policy ? { policy: input.policy } : {}),
    ...(input.policyMeta ? { policyMeta: input.policyMeta } : {}),
    ...(input.testFailures !== undefined ? { testFailures: input.testFailures } : {}),
    ...(input.baseline !== undefined ? { baseline: input.baseline } : {}),
    ...(input.projects ? { projects: input.projects } : {}),
    ...(input.errors ? { errors: input.errors } : {}),
    ...(input.history ? { history: input.history } : {}),
  };

  return coverageReportSchema.parse(report);
}
