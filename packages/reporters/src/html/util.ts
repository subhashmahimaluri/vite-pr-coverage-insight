import type { CoverageReport, FileReport, MetricDelta } from '@coverage-insight/core';

export type MetricKey = 'statements' | 'branches' | 'functions' | 'lines';

export const METRIC_KEYS: MetricKey[] = ['statements', 'branches', 'functions', 'lines'];

export const METRIC_LABELS: Record<MetricKey, string> = {
  statements: 'Statements',
  branches: 'Branches',
  functions: 'Functions',
  lines: 'Lines',
};

/** Runtime-safe metric lookup (a record may be missing keys in older inputs). */
export function metricOf(
  metrics: Record<MetricKey, MetricDelta> | undefined,
  key: MetricKey
): MetricDelta | undefined {
  if (!metrics) return undefined;
  return (metrics as Partial<Record<MetricKey, MetricDelta>>)[key];
}

export function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '&mdash;';
  return `${value.toFixed(1)}%`;
}

export function fmtDelta(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '&mdash;';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}pp`;
}

export function deltaClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return 'delta-zero';
  return value > 0 ? 'delta-pos' : 'delta-neg';
}

/** Coverage tone: green >= 90, amber >= 70, red < 70, neutral when unknown. */
export function covClass(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return 'cov-none';
  if (pct >= 90) return 'cov-high';
  if (pct >= 70) return 'cov-mid';
  return 'cov-low';
}

export function shortSha(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

/** Top-level directory of a path; files without a slash group under '(root)'. */
export function topLevelDir(path: string): string {
  const idx = path.indexOf('/');
  return idx === -1 ? '(root)' : path.slice(0, idx);
}

/**
 * The lines threshold configured by policy, recovered from violations.
 * Schema v1 only carries thresholds via violations, so this is best-effort:
 * present whenever the gate failed on lines.
 */
export function linesThreshold(report: CoverageReport): number | undefined {
  const violations = report.policy?.violations ?? [];
  const hit = violations.find(
    (v) => v.metric === 'lines' && (v.rule === 'threshold' || v.rule === 'override-threshold')
  );
  return hit?.required;
}

export function filesOf(report: CoverageReport): FileReport[] {
  return report.files ?? [];
}
