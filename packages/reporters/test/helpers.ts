import type {
  BaselineMeta,
  CoverageMetric,
  CoverageModel,
  PolicyResult,
} from '@coverage-insight/core';

export function metric(covered: number, total: number): CoverageMetric {
  return {
    covered,
    total,
    skipped: 0,
    pct: total === 0 ? 100 : Math.round((covered / total) * 10000) / 100,
  };
}

export function model(
  files: { path: string; covered: number; total: number; uncoveredLines?: number[] }[]
): CoverageModel {
  let covered = 0;
  let total = 0;
  for (const f of files) {
    covered += f.covered;
    total += f.total;
  }
  const totals = metric(covered, total);
  return {
    total: { statements: totals, branches: totals, functions: totals, lines: totals },
    files: files.map((f) => {
      const m = metric(f.covered, f.total);
      return {
        path: f.path,
        metrics: { statements: m, branches: m, functions: m, lines: m },
        ...(f.uncoveredLines ? { uncoveredLines: f.uncoveredLines } : {}),
      };
    }),
  };
}

export const passPolicy: PolicyResult = { verdict: 'pass', violations: [] };

export const failPolicy: PolicyResult = {
  verdict: 'fail',
  violations: [
    { rule: 'threshold', metric: 'lines', scope: 'total', required: 90, actual: 80, gap: 10 },
    {
      rule: 'override-threshold',
      metric: 'branches',
      scope: 'src/a.ts',
      required: 95,
      actual: 70,
      gap: 25,
    },
  ],
};

export const baselineMeta: BaselineMeta = {
  sha: 'abcdef1234567890',
  ref: 'refs/heads/main',
  timestamp: '2026-06-11T00:00:00Z',
  source: 'branch',
  staleness: 0,
};

export const GENERATED_AT = '2026-06-11T10:00:00.000Z';
