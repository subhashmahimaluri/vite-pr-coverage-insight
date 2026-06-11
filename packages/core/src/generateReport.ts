import { CoverageSummary, FileCoverageResult, PrInfo, TestFailuresResult } from './types';
import { compareCoverage, compareFileCoverage } from './compareCoverage';
import { formatCoverageMarkdown } from './formatMarkdown';

/**
 * Generates a markdown report comparing coverage between base and PR branches
 *
 * @param base The base branch coverage data
 * @param pr The PR branch coverage data
 * @param testFailures Optional test failures data
 * @param prInfo Optional PR information
 * @returns Formatted markdown string with summary table and file breakdown
 */
export function generateCoverageReport(
  base: CoverageSummary | null,
  pr: CoverageSummary | null,
  testFailures?: TestFailuresResult | null,
  prInfo?: PrInfo,
  coverageError?: boolean
): string {
  let summaryRows: ReturnType<typeof compareCoverage> = [];
  let fileCoverage: FileCoverageResult[] = [];
  coverageError = coverageError || false;

  if (base && pr) {
    // Compare overall metrics
    summaryRows = compareCoverage(base, pr);

    // Compare file-level metrics (wrap single result in array)
    fileCoverage = [compareFileCoverage(base, pr)];
  } else {
    coverageError = true;
    // If PR coverage is missing, show base coverage if available
    if (base) {
      summaryRows = Object.entries(base.total).map(([metric, data]) => ({
        metric: metric as ReturnType<typeof compareCoverage>[number]['metric'],
        base: data.pct,
        pr: 0,
        delta: 0,
        symbol: '➖',
      }));
    }
    // If both are missing, an empty table plus the error notice is rendered
  }

  // Format the markdown report
  return formatCoverageMarkdown(summaryRows, fileCoverage, prInfo, testFailures, coverageError);
}
