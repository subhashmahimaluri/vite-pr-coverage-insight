// src/utils/formatMarkdown.ts
export function formatCoverageMarkdown(rows: {
  metric: string;
  base: number;
  pr: number;
  delta: number;
  symbol: string;
}[], reducedFiles?: { file: string; delta: number }[]) {
  const header = `### 📊 Vite Coverage Report\n\n| Metric     | Base     | PR       | ∆        |\n|------------|----------|----------|----------|`;

  const lines = rows.map(
    ({ metric, base, pr, delta, symbol }) => {
      let coloredSymbol = symbol;
      if (symbol === '⬆️') coloredSymbol = '🟢⬆️';
      else if (symbol === '⬇️') coloredSymbol = '🟠⬇️';
      return `| ${metric} | ${base.toFixed(2)}% | ${pr.toFixed(2)}% | ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}% ${coloredSymbol} |`;
    }
  );

  const fileDetails = reducedFiles?.length
    ? [
        "\n<details><summary>📉 Files with Reduced Coverage</summary>\n",
        "\n| File | Coverage Drop |\n|------|----------------|",
        ...reducedFiles.map(
          ({ file, delta }) => `| \`${file}\` | ${delta.toFixed(2)}% 🟠⬇️ |`
        ),
        "</details>"
      ].join("\n")
    : "";

  return [header, ...lines, fileDetails].join("\n");
}
