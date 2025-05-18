import { FileCoverageResult } from './compareCoverage';

export function formatCoverageMarkdown(
    rows: {
      metric: string;
      base: number;
      pr: number;
      delta: number;
      symbol: string;
    }[],
    fileCoverage: FileCoverageResult
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
            ? formatUncoveredLines(file.uncoveredLines, file.file)
            : '-';
          
          // Extract just the filename from the path
          const fileName = file.file.split('/').pop() || file.file;
          
          fileDetailsSection += `\n| [${fileName}](link)   | ${file.metrics.branches.toFixed(0)}%     | ${file.metrics.functions.toFixed(0)}%  | ${file.metrics.lines.toFixed(0)}%  | ${uncoveredLinesText} |`;
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
            ? formatUncoveredLines(file.uncoveredLines, file.file)
            : '-';
          
          // Extract just the filename from the path
          const fileName = file.file.split('/').pop() || file.file;
          
          fileDetailsSection += `\n| [${fileName}](link)    | ${file.metrics.branches.pr.toFixed(0)}%     | ${file.metrics.functions.pr.toFixed(0)}%    | ${file.metrics.lines.pr.toFixed(0)}%    | ${uncoveredLinesText} |`;
        });
      }
      
      fileDetailsSection += '\n\n</details>\n\n---';
    }

    return `${mainTable}${fileDetailsSection}\n\n_Reported by **vite-pr-coverage-insight**_`;
  }

// Helper function to format uncovered lines with ranges
function formatUncoveredLines(lines: number[], file: string): string {
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
  return `[${ranges.join(', ')}](link)`;
}