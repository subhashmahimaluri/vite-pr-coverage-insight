export function formatCoverageMarkdown(
  rows: {
    metric: string;
    base: number;
    pr: number;
    delta: number;
    symbol: string;
  }[],
  reducedFiles?: { file: string; delta: number }[],
  fileCoverage?: {
    file: string;
    statements: number;
    branches: number;
    functions: number;
    lines: number;
    uncoveredLines?: string;
  }[]
) {
  const header = `### 📊 Vite Coverage Report\n\n| Metric     | Base     | PR       | ∆        |\n|------------|----------|----------|----------|`;

  const summaryRows = rows.map(
    ({ metric, base, pr, delta, symbol }) => {
      let coloredSymbol = symbol;
      if (symbol === '⬆️') coloredSymbol = '🟢⬆️';
      else if (symbol === '⬇️') coloredSymbol = '🟠⬇️';
      return `| ${metric} | ${base.toFixed(2)}% | ${pr.toFixed(2)}% | ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}% ${coloredSymbol} |`;
    }
  );

  const reducedSection = reducedFiles?.length
    ? [
        "\n<details><summary>📉 Files with Reduced Coverage</summary>\n",
        "\n| File | Coverage Drop |\n|------|----------------|",
        ...reducedFiles.map(
          ({ file, delta }) => `| \`${file}\` | ${delta.toFixed(2)}% 🟠⬇️ |`
        ),
        "</details>"
      ].join("\n")
    : "";

  const fileLevelSection = fileCoverage?.length
    ? [
        `\n<details><summary>📂 File-wise Coverage Breakdown</summary>\n`,
        `\n| File | % Statements | % Branch | % Functions | % Lines | Uncovered Lines |`,
        `|------|--------------|----------|-------------|---------|------------------|`,
        ...fileCoverage.map(file =>
          `| \`${file.file}\` | ${file.statements.toFixed(2)} | ${file.branches.toFixed(2)} | ${file.functions.toFixed(2)} | ${file.lines.toFixed(2)} | ${file.uncoveredLines ?? '-'} |`
        ),
        `</details>`
      ].join("\n")
    : "";

  return [header, ...summaryRows, reducedSection, fileLevelSection].join("\n");
}
