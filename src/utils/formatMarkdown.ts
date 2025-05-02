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
  const summaryTableHeader = `### 📊 Vite Coverage Report

| Metric     | Base     | PR       | ∆        |
|------------|----------|----------|----------|`;

  const summaryRows = rows.map(({ metric, base, pr, delta, symbol }) => {
    let coloredSymbol = symbol;
    if (symbol === "⬆️") coloredSymbol = "🟢⬆️";
    else if (symbol === "⬇️") coloredSymbol = "🟠⬇️";
    return `| ${metric} | ${base.toFixed(2)}% | ${pr.toFixed(2)}% | ${
      delta >= 0 ? "+" : ""
    }${delta.toFixed(2)}% ${coloredSymbol} |`;
  });

  const reducedCoverageSection = reducedFiles?.length
    ? [
        "<details>",
        "<summary>📉 Files with Reduced Coverage</summary>",
        "",
        "| File | Coverage Drop |",
        "|------|----------------|",
        ...reducedFiles.map(
          ({ file, delta }) =>
            `| \`${file}\` | ${delta.toFixed(2)}% 🟠⬇️ |`
        ),
        "</details>"
      ].join("\n")
    : "";

  const fileBreakdownSection = fileCoverage?.length
    ? [
        "<details>",
        "<summary>📂 File-wise Coverage Details</summary>",
        "",
        "| File | % Stmts | % Branch | % Funcs | % Lines | Uncovered Lines |",
        "|------|---------|----------|---------|---------|------------------|",
        ...fileCoverage.map(
          ({ file, statements, branches, functions, lines, uncoveredLines }) =>
            `| \`${file}\` | ${statements.toFixed(2)} | ${branches.toFixed(
              2
            )} | ${functions.toFixed(2)} | ${lines.toFixed(2)} | ${
              uncoveredLines || "-"
            } |`
        ),
        "</details>"
      ].join("\n")
    : "";

  return [
    summaryTableHeader,
    ...summaryRows,
    reducedCoverageSection,
    fileBreakdownSection,
  ].join("\n\n");
}
