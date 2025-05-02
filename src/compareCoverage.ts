export type CoverageSummary = {
    total: {
      lines: { pct: number };
      statements: { pct: number };
      functions: { pct: number };
      branches: { pct: number };
    };
  };
  
  export function compareCoverage(base: CoverageSummary, pr: CoverageSummary) {
    const metrics = ['statements', 'branches', 'functions', 'lines'] as const;
  
    return metrics.map((metric) => {
      const basePct = base.total[metric].pct ?? 0;
      const prPct = pr.total[metric].pct ?? 0;
      const delta = parseFloat((prPct - basePct).toFixed(2));
  
      return {
        metric,
        base: basePct,
        pr: prPct,
        delta,
        symbol: delta > 0 ? '⬆' : delta < 0 ? '⬇' : '➖',
      };
    });
  }