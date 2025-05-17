export function formatCoverageMarkdown(
    rows: {
      metric: string;
      base: number;
      pr: number;
      delta: number;
      symbol: string;
    }[],
    fileChanges: {
      file: string;
      metrics: {
        metric: string;
        base: number;
        pr: number;
        delta: number;
        symbol: string;
      }[];
    }[] = []
  ) {
    const header = `### 📊 Vite Coverage Report\n\n| Metric     | Base     | PR       | Change   |\n|------------|----------|----------|----------|`;
    const toggle = `\n\n<markdown-accessiblity-table><p align="right">▶️ Toggle Coverage Breakdown</p></markdown-accessiblity-table>`;
  
    const lines = rows.map(
      ({ metric, base, pr, delta, symbol }) =>
        `| ${metric} | ${base.toFixed(2)}% | ${pr.toFixed(2)}% | ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}% ${symbol} |`
    );

    let fileDetailsSection = '';
    
    if (fileChanges.length > 0) {
      fileDetailsSection = '\n\n<details>\n<summary>📂 Show file-level coverage details</summary>\n\n';
      
      const improved = fileChanges.filter(f => f.metrics.some(m => m.delta > 0));
      const worsened = fileChanges.filter(f => f.metrics.some(m => m.delta < 0));
      
      if (improved.length > 0) {
        fileDetailsSection += '#### 🚀 Improved Coverage\n\n';
        improved.forEach(file => {
          fileDetailsSection += `**${file.file}**\n\n`;
          fileDetailsSection += '| Metric | Base | PR | ∆ |\n|--------|------|----|----|';
          file.metrics.forEach(({ metric, base, pr, delta, symbol }) => {
            fileDetailsSection += `\n| ${metric} | ${base.toFixed(2)}% | ${pr.toFixed(2)}% | ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}% ${symbol} |`;
          });
          fileDetailsSection += '\n\n';
        });
      }
      
      if (worsened.length > 0) {
        fileDetailsSection += '#### 🔍 Decreased Coverage\n\n';
        worsened.forEach(file => {
          fileDetailsSection += `**${file.file}**\n\n`;
          fileDetailsSection += '| Metric | Base | PR | ∆ |\n|--------|------|----|----|';
          file.metrics.forEach(({ metric, base, pr, delta, symbol }) => {
            fileDetailsSection += `\n| ${metric} | ${base.toFixed(2)}% | ${pr.toFixed(2)}% | ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}% ${symbol} |`;
          });
          fileDetailsSection += '\n\n';
        });
      }
      
      fileDetailsSection += '</details>';
    }

    return [header, ...lines].join('\n') + toggle + fileDetailsSection;
  }