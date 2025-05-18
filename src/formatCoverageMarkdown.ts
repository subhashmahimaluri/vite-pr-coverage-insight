import { CoverageSummary, FileCoverageResult, compareCoverage, compareFileCoverage } from './utils/compareCoverage';
import { formatCoverageMarkdown } from './utils/formatMarkdown';

/**
 * Generates a markdown report comparing coverage between base and PR branches
 * 
 * @param base The base branch coverage data
 * @param pr The PR branch coverage data
 * @returns Formatted markdown string with summary table and file breakdown
 */
export function generateCoverageReport(
  base: CoverageSummary,
  pr: CoverageSummary,
  prInfo?: {
    owner: string;
    repo: string;
    prNumber: number;
  }
): string {
  // Compare overall metrics
  const summaryRows = compareCoverage(base, pr);
  
  // Compare file-level metrics
  const fileCoverage = compareFileCoverage(base, pr);
  
  // Format the markdown report
  return formatCoverageMarkdown(summaryRows, fileCoverage, prInfo);
}

// Re-export the utility functions
export {
  formatCoverageMarkdown,
  compareCoverage,
  compareFileCoverage
};