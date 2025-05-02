export type CoverageMetrics = 'lines' | 'statements' | 'functions' | 'branches';

export type CoverageSummary = {
  total: Record<CoverageMetrics, { pct: number }>;
};

export function compareCoverage(base: CoverageSummary, pr: CoverageSummary) {
  const metrics: CoverageMetrics[] = ['statements', 'branches', 'functions', 'lines'];
  return metrics.map((metric) => {
    const basePct = base.total[metric].pct;
    const prPct = pr.total[metric].pct;
    return {
      metric,
      base: basePct,
      pr: prPct,
      delta: +(prPct - basePct).toFixed(2),
    };
  });
}