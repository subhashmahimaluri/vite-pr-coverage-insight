export function formatCoverageMarkdown(rows: {
    metric: string;
    base: number;
    pr: number;
    delta: number;
    symbol: string;
  }[]) {
    const header = `### 📊 Vite Coverage Report\n\n| Metric     | Base     | PR       | ∆        |\n|------------|----------|----------|----------|`;
  
    const lines = rows.map(
      ({ metric, base, pr, delta, symbol }) =>
        `| ${metric} | ${base.toFixed(2)}% | ${pr.toFixed(2)}% | ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}% ${symbol} |`
    );
  
    return [header, ...lines].join('\n');
  }