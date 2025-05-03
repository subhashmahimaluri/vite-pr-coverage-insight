export function formatCoverageMarkdown(
    rows: {
      metric: string;
      base: number;
      pr: number;
      delta: number;
      symbol: string;
    }[],
    reducedFiles: { file: string; delta: number }[] = [] // ✅ second argument with default
  ) {
    const header = `### 📊 Vite Coverage Report\n\n| Metric     | Base     | PR       | ∆        |\n|------------|----------|----------|----------|`;
  
    const lines = rows.map(
      ({ metric, base, pr, delta, symbol }) =>
        `| ${metric} | ${base.toFixed(2)}% | ${pr.toFixed(2)}% | ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}% ${symbol} |`
    );

    let reducedFilesMarkdown = '';
    if (reducedFiles.length > 0) {
      reducedFilesMarkdown = `
<details>
<summary>COMPONENT DETAILS</summary>

| File | ∆ |
|------|---|
${reducedFiles.map(({ file, delta }) => `| ${file} | ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}% |`).join('\n')}

</details>
`;
    }
  
    return [header, ...lines, reducedFilesMarkdown].join('\n');
  }