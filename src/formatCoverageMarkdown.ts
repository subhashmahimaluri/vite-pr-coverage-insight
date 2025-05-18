import { CoverageSummary, FileCoverageResult, compareCoverage, compareFileCoverage } from './utils/compareCoverage';
import { formatCoverageMarkdown } from './utils/formatMarkdown';
import { TestFailuresResult } from './utils/parseTestFailures';

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
  prInfo?: {
    owner: string;
    repo: string;
    prNumber: number;
  }
): string {
  let summaryRows: any[] = [];
  let fileCoverage: FileCoverageResult[] = [];
  let coverageError = false;

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
        metric,
        base: data.pct,
        pr: 'N/A',
        delta: 'N/A',
        deltaIcon: ''
      }));
    } else {
      // If both are missing, indicate no coverage data
      summaryRows = [{
        metric: 'Coverage Data',
        base: 'N/A',
        pr: 'N/A',
        delta: 'N/A',
        deltaIcon: ''
      }];
    }
  }
  
  // Format the markdown report
  return formatCoverageMarkdown(summaryRows, fileCoverage, prInfo, testFailures, coverageError);
}

// Re-export the utility functions
export {
  formatCoverageMarkdown,
  compareCoverage,
  compareFileCoverage
};