// src/utils/compareCoverage.ts
export type CoverageSummary = {
  total: {
    lines: { pct: number; total: number; covered: number; skipped: number };
    statements: { pct: number; total: number; covered: number; skipped: number };
    functions: { pct: number; total: number; covered: number; skipped: number };
    branches: { pct: number; total: number; covered: number; skipped: number };
  };
  [key: string]: {
    lines: { pct: number; total: number; covered: number; skipped: number; details?: { line: number; covered: boolean }[] };
    statements: { pct: number; total: number; covered: number; skipped: number };
    functions: { pct: number; total: number; covered: number; skipped: number };
    branches: { pct: number; total: number; covered: number; skipped: number };
  };
};

export type FileCoverageResult = {
  newFiles: {
    file: string;
    metrics: {
      branches: number;
      functions: number;
      lines: number;
      statements: number;
    };
    uncoveredLines: number[];
  }[];
  modifiedFiles: {
    file: string;
    metrics: {
      branches: { base: number; pr: number; delta: number; symbol: string };
      functions: { base: number; pr: number; delta: number; symbol: string };
      lines: { base: number; pr: number; delta: number; symbol: string };
      statements: { base: number; pr: number; delta: number; symbol: string };
    };
    uncoveredLines: number[];
  }[];
};

export function compareFileCoverage(base: CoverageSummary, pr: CoverageSummary): FileCoverageResult {
  const metrics = ['statements', 'branches', 'functions', 'lines'] as const;
  const result: FileCoverageResult = {
    newFiles: [],
    modifiedFiles: []
  };

  // Get all unique file paths from both base and PR
  const allFiles = new Set<string>();
  Object.keys(base).forEach(key => key !== 'total' && allFiles.add(key));
  Object.keys(pr).forEach(key => key !== 'total' && allFiles.add(key));

  // Process each file
  allFiles.forEach(file => {
    // Skip the 'total' entry
    if (file === 'total') return;

    // Check if this is a new file (exists in PR but not in base)
    const isNewFile = pr[file] && !base[file];
    
    // Get uncovered lines
    const uncoveredLines: number[] = [];
    if (pr[file]?.lines?.details) {
      pr[file].lines.details.forEach(detail => {
        if (!detail.covered) {
          uncoveredLines.push(detail.line);
        }
      });
    }

    if (isNewFile) {
      // Check if the new file has 100% coverage
      const hasFullCoverage = metrics.every(metric => pr[file][metric].pct === 100);
      
      if (hasFullCoverage) {
        result.newFiles.push({
          file,
          metrics: {
            branches: pr[file].branches.pct,
            functions: pr[file].functions.pct,
            lines: pr[file].lines.pct,
            statements: pr[file].statements.pct
          },
          uncoveredLines
        });
      }
    } else if (base[file] && pr[file]) {
      // This is a modified file
      const fileMetrics = {
        branches: {
          base: base[file].branches.pct,
          pr: pr[file].branches.pct,
          delta: Number((pr[file].branches.pct - base[file].branches.pct).toFixed(2)),
          symbol: pr[file].branches.pct > base[file].branches.pct ? '⬆️' :
                 pr[file].branches.pct < base[file].branches.pct ? '⬇️' : '➖'
        },
        functions: {
          base: base[file].functions.pct,
          pr: pr[file].functions.pct,
          delta: Number((pr[file].functions.pct - base[file].functions.pct).toFixed(2)),
          symbol: pr[file].functions.pct > base[file].functions.pct ? '⬆️' :
                 pr[file].functions.pct < base[file].functions.pct ? '⬇️' : '➖'
        },
        lines: {
          base: base[file].lines.pct,
          pr: pr[file].lines.pct,
          delta: Number((pr[file].lines.pct - base[file].lines.pct).toFixed(2)),
          symbol: pr[file].lines.pct > base[file].lines.pct ? '⬆️' :
                 pr[file].lines.pct < base[file].lines.pct ? '⬇️' : '➖'
        },
        statements: {
          base: base[file].statements.pct,
          pr: pr[file].statements.pct,
          delta: Number((pr[file].statements.pct - base[file].statements.pct).toFixed(2)),
          symbol: pr[file].statements.pct > base[file].statements.pct ? '⬆️' :
                 pr[file].statements.pct < base[file].statements.pct ? '⬇️' : '➖'
        }
      };

      // Check if there are any changes in coverage
      const hasChanges = Object.values(fileMetrics).some(m => m.delta !== 0);
      
      if (hasChanges) {
        result.modifiedFiles.push({
          file,
          metrics: fileMetrics,
          uncoveredLines
        });
      }
    }
  });

  return result;
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
      symbol: delta > 0 ? '⬆️' : delta < 0 ? '⬇️' : '➖',
    };
  });
}