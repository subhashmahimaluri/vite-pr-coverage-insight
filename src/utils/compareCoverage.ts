// src/utils/compareCoverage.ts
export type CoverageSummary = {
  total: {
    lines: { pct: number };
    statements: { pct: number };
    functions: { pct: number };
    branches: { pct: number };
  };
  [key: string]: {
    lines: { pct: number };
    statements: { pct: number };
    functions: { pct: number };
    branches: { pct: number };
  };
};

export function compareFileCoverage(base: CoverageSummary, pr: CoverageSummary) {
  const metrics = ['statements', 'branches', 'functions', 'lines'] as const;
  const fileChanges: {
    file: string;
    metrics: {
      metric: string;
      base: number;
      pr: number;
      delta: number;
      symbol: string;
    }[];
  }[] = [];

  // Get all unique file paths from both base and PR
  const allFiles = new Set<string>();
  Object.keys(base).forEach(key => key !== 'total' && allFiles.add(key));
  Object.keys(pr).forEach(key => key !== 'total' && allFiles.add(key));

  // Compare each file's coverage
  allFiles.forEach(file => {
    const fileMetrics = metrics.map(metric => {
      const basePct = base[file]?.[metric]?.pct ?? 0;
      const prPct = pr[file]?.[metric]?.pct ?? 0;
      const delta = Number((prPct - basePct).toFixed(2));

      return {
        metric,
        base: basePct,
        pr: prPct,
        delta,
        symbol: delta > 0 ? '🟢' : delta < 0 ? '🔴' : '⚪',
      };
    });

    if (fileMetrics.some(m => m.delta !== 0)) {
      fileChanges.push({ file, metrics: fileMetrics });
    }
  });

  return fileChanges;
}

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
      symbol: delta > 0 ? '🟢' : delta < 0 ? '🔴' : '⚪',
    };
  });
}