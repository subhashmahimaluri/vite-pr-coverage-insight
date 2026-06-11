import type { CoverageMetric, CoverageSummary } from './types';

export const METRIC_KEYS = ['statements', 'branches', 'functions', 'lines'] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export type FileCoverage = {
  /** repo-relative or absolute path as reported by the tool */
  path: string;
  metrics: Record<MetricKey, CoverageMetric>;
  /** 1-based line numbers with zero hits, when the format provides line detail */
  uncoveredLines?: number[];
};

/**
 * Normalized coverage model — the single internal schema every parser maps
 * into and every consumer (diff, policy, reporters, agents) reads from.
 */
export type CoverageModel = {
  total: Record<MetricKey, CoverageMetric>;
  files: FileCoverage[];
};

/** Converts the istanbul json-summary shape (v1 input format) into the model. */
export function summaryToModel(summary: CoverageSummary): CoverageModel {
  const files: FileCoverage[] = Object.entries(summary)
    .filter(([path]) => path !== 'total')
    .map(([path, metrics]) => {
      const uncovered = metrics.lines.details
        ?.filter((d) => !d.covered)
        .map((d) => d.line)
        .sort((a, b) => a - b);
      return {
        path,
        metrics: {
          statements: stripDetails(metrics.statements),
          branches: stripDetails(metrics.branches),
          functions: stripDetails(metrics.functions),
          lines: stripDetails(metrics.lines),
        },
        ...(uncovered && uncovered.length > 0 ? { uncoveredLines: uncovered } : {}),
      };
    });

  return {
    total: {
      statements: stripDetails(summary.total.statements),
      branches: stripDetails(summary.total.branches),
      functions: stripDetails(summary.total.functions),
      lines: stripDetails(summary.total.lines),
    },
    files,
  };
}

/** Converts a model back to the istanbul json-summary shape consumed by the v1 diff code. */
export function modelToSummary(model: CoverageModel): CoverageSummary {
  const summary = { total: { ...model.total } } as CoverageSummary;
  for (const file of model.files) {
    summary[file.path] = {
      ...file.metrics,
      lines: file.uncoveredLines?.length
        ? {
            ...file.metrics.lines,
            details: file.uncoveredLines.map((line) => ({ line, covered: false })),
          }
        : { ...file.metrics.lines },
    };
  }
  return summary;
}

function stripDetails(metric: CoverageMetric & { details?: unknown }): CoverageMetric {
  return {
    pct: metric.pct,
    total: metric.total,
    covered: metric.covered,
    skipped: metric.skipped,
  };
}
