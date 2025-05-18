import { FileCoverageResult } from './compareCoverage';
import { TestFailuresResult } from './parseTestFailures';

export function formatCoverageMarkdown(
    rows: {
      metric: string;
      base: number;
      pr: number;
      delta: number;
      symbol: string;
    }[],
    fileCoverage: FileCoverageResult[],
    prInfo?: {
      owner: string;
      repo: string;
      prNumber: number;
    },
    testFailures?: TestFailuresResult | null,
    coverageError?: boolean
  ): string {
    // Format the main summary table
    const header = `### 📊 Vite Coverage Report\n\n| Metric     | Base     | PR       | ∆        |\n|------------|----------|----------|----------|`;
  
    const lines = rows.map(
      ({ metric, base, pr, delta, symbol }) =>
        `| ${metric} | ${base.toFixed(2)}% | ${pr.toFixed(2)}% | ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}% ${symbol} |`
    );

    const mainTable = [header, ...lines].join('\n');
    
    // Format the file coverage breakdown section
    let fileDetailsSection = '';
    
    const allNewFiles = fileCoverage.flatMap(fc => fc.newFiles || []);
    const allModifiedFiles = fileCoverage.flatMap(fc => fc.modifiedFiles || []);

    if (allNewFiles.length > 0 || allModifiedFiles.length > 0) {
      fileDetailsSection = '\n\n---\n\n<details><summary>🗂️ Open File Coverage Breakdown</summary>\n\n---\n\n';
      
      // Newly Added Files section
      if (allNewFiles.length > 0) {
        fileDetailsSection += '#### 🆕 Newly Added Files:\n';
        fileDetailsSection += '| File              | Branches | Funcs | Lines | Uncovered Lines |\n';
        fileDetailsSection += '|--------------------|----------|-------|-------|-----------------|';
        
        allNewFiles.forEach((file: any) => {
          const uncoveredLinesText = file.uncoveredLines?.length > 0
            ? formatUncoveredLines(file.uncoveredLines, file.file, prInfo)
            : '-';
          
          const fileName = file.file.split('/').pop() || file.file;
          const fileLink = prInfo
            ? `https://github.com/${prInfo.owner}/${prInfo.repo}/pull/${prInfo.prNumber}/files`
            : file.file;
            
          fileDetailsSection += `\n| [${fileName}](${fileLink})   | ${file.metrics.branches.toFixed(0)}%     | ${file.metrics.functions.toFixed(0)}%  | ${file.metrics.lines.toFixed(0)}%  | ${uncoveredLinesText} |`;
        });
        
        fileDetailsSection += '\n\n---\n\n';
      }
      
      // Modified Files section
      if (allModifiedFiles.length > 0) {
        fileDetailsSection += '#### ✏️ Modified Files:\n';
        fileDetailsSection += '| File               | Branches | Funcs | Lines | Uncovered Lines |\n';
        fileDetailsSection += '|---------------------|----------|-------|-------|-----------------|';
        
        allModifiedFiles.forEach((file: any) => {
          const uncoveredLinesText = file.uncoveredLines?.length > 0
            ? formatUncoveredLines(file.uncoveredLines, file.file, prInfo)
            : '-';
          
          const fileName = file.file.split('/').pop() || file.file;
          const fileLink = prInfo
            ? `https://github.com/${prInfo.owner}/${prInfo.repo}/pull/${prInfo.prNumber}/files`
            : file.file;
            
          fileDetailsSection += `\n| [${fileName}](${fileLink})    | ${file.metrics.branches.pr.toFixed(0)}%     | ${file.metrics.functions.pr.toFixed(0)}%    | ${file.metrics.lines.pr.toFixed(0)}%    | ${uncoveredLinesText} |`;
        });
      }
      
      fileDetailsSection += '\n\n</details>\n\n---';
    }
    
    // Add test failures section if available
    let testFailuresSection = '';
    if (testFailures && testFailures.numFailedTests > 0) {
      testFailuresSection = `\n\n---\n\n<details><summary>❌ Failed Tests (${testFailures.numFailedTests}/${testFailures.numTotalTests})</summary>\n\n`;
      
      // Create table header
      testFailuresSection += '| Test File | Failed Test Case |\n';
      testFailuresSection += '|-----------|------------------|';
      
      // Format each failure as a table row
      testFailures.failedTests.forEach(failure => {
        const fileName = failure.filePath.split('/').pop() || failure.filePath;
        testFailuresSection += `\n| ${fileName} | ${failure.testName} |`;
      });
      
      testFailuresSection += '\n\n</details>\n\n---';
    }

    let errorNotice = '';
    if (coverageError) {
      errorNotice = '\n\n⚠️ **Warning:** Could not generate full coverage comparison due to missing coverage data';
    }
    
    return `${mainTable}${errorNotice}${fileDetailsSection}${testFailuresSection}`;
  }

// Helper function to format uncovered lines with ranges
function formatUncoveredLines(
  lines: number[],
  file: string,
  prInfo?: {
    owner: string;
    repo: string;
    prNumber: number;
  }
): string {
  if (lines.length === 0) return '-';
  
  // Sort lines numerically
  lines.sort((a, b) => a - b);
  
  // Group consecutive lines into ranges
  const ranges: string[] = [];
  let rangeStart = lines[0];
  let rangeEnd = lines[0];
  
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === rangeEnd + 1) {
      rangeEnd = lines[i];
    } else {
      if (rangeStart === rangeEnd) {
        ranges.push(`${rangeStart}`);
      } else {
        ranges.push(`${rangeStart}-${rangeEnd}`);
      }
      rangeStart = rangeEnd = lines[i];
    }
  }
  
  // Add the last range
  if (rangeStart === rangeEnd) {
    ranges.push(`${rangeStart}`);
  } else {
    ranges.push(`${rangeStart}-${rangeEnd}`);
  }
  
  // Create a clickable link with the ranges
  if (prInfo) {
    return `[${ranges.join(', ')}](https://github.com/${prInfo.owner}/${prInfo.repo}/pull/${prInfo.prNumber}/files)`;
  } else {
    return `[${ranges.join(', ')}](${file})`;
  }
}