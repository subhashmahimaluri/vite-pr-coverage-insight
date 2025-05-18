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
    fileCoverage: FileCoverageResult,
    prInfo?: {
      owner: string;
      repo: string;
      prNumber: number;
    },
    testFailures?: TestFailuresResult | null
  ) {
    // Format the main summary table
    const header = `### 📊 Vite Coverage Report\n\n| Metric     | Base     | PR       | ∆        |\n|------------|----------|----------|----------|`;
  
    const lines = rows.map(
      ({ metric, base, pr, delta, symbol }) =>
        `| ${metric} | ${base.toFixed(2)}% | ${pr.toFixed(2)}% | ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}% ${symbol} |`
    );

    const mainTable = [header, ...lines].join('\n');
    
    // Format the file coverage breakdown section
    let fileDetailsSection = '';
    
    if (fileCoverage.newFiles.length > 0 || fileCoverage.modifiedFiles.length > 0) {
      fileDetailsSection = '\n\n---\n\n<details><summary>🗂️ Open File Coverage Breakdown</summary>\n\n---\n\n';
      
      // Newly Added Files section
      if (fileCoverage.newFiles.length > 0) {
        fileDetailsSection += '#### 🆕 Newly Added Files:\n';
        fileDetailsSection += '| File              | Branches | Funcs | Lines | Uncovered Lines |\n';
        fileDetailsSection += '|--------------------|----------|-------|-------|-----------------|';
        
        fileCoverage.newFiles.forEach(file => {
          const uncoveredLinesText = file.uncoveredLines.length > 0
            ? formatUncoveredLines(file.uncoveredLines, file.file, prInfo)
            : '-';
          
          // Extract just the filename from the path
          const fileName = file.file.split('/').pop() || file.file;
          
          // Generate GitHub PR link if PR info is available
          const fileLink = prInfo
            ? `https://github.com/${prInfo.owner}/${prInfo.repo}/pull/${prInfo.prNumber}/files`
            : file.file;
            
          fileDetailsSection += `\n| [${fileName}](${fileLink})   | ${file.metrics.branches.toFixed(0)}%     | ${file.metrics.functions.toFixed(0)}%  | ${file.metrics.lines.toFixed(0)}%  | ${uncoveredLinesText} |`;
        });
        
        fileDetailsSection += '\n\n---\n\n';
      }
      
      // Modified Files section
      if (fileCoverage.modifiedFiles.length > 0) {
        fileDetailsSection += '#### ✏️ Modified Files:\n';
        fileDetailsSection += '| File               | Branches | Funcs | Lines | Uncovered Lines |\n';
        fileDetailsSection += '|---------------------|----------|-------|-------|-----------------|';
        
        fileCoverage.modifiedFiles.forEach(file => {
          const uncoveredLinesText = file.uncoveredLines.length > 0
            ? formatUncoveredLines(file.uncoveredLines, file.file, prInfo)
            : '-';
          
          // Extract just the filename from the path
          const fileName = file.file.split('/').pop() || file.file;
          
          // Generate GitHub PR link if PR info is available
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
      
      // Group failures by file
      const failuresByFile: Record<string, string[]> = {};
      testFailures.failedTests.forEach(failure => {
        if (!failuresByFile[failure.filePath]) {
          failuresByFile[failure.filePath] = [];
        }
        failuresByFile[failure.filePath].push(failure.testName);
      });
      
      // Format each file's failures
      Object.entries(failuresByFile).forEach(([filePath, testNames]) => {
        const fileName = filePath.split('/').pop() || filePath;
        testFailuresSection += `\n### 📄 ${fileName}\n\n`;
        
        testNames.forEach(testName => {
          testFailuresSection += `- ${testName}\n`;
        });
        
        testFailuresSection += '\n';
      });
      
      testFailuresSection += '</details>\n\n---';
    }

    return `${mainTable}${fileDetailsSection}${testFailuresSection}`;
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
      // Continue the current range
      rangeEnd = lines[i];
    } else {
      // End the current range and start a new one
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
    // Use GitHub PR files link without the complex diff hash
    return `[${ranges.join(', ')}](https://github.com/${prInfo.owner}/${prInfo.repo}/pull/${prInfo.prNumber}/files)`;
  } else {
    return `[${ranges.join(', ')}](${file})`;
  }
}