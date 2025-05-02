import { compareCoverage, CoverageSummary } from './compareCoverage';

export function formatMarkdown(base: CoverageSummary, pr: CoverageSummary) {
  const rows = compareCoverage(base, pr)
    .map(({ metric, base, pr, delta, symbol }) =>
      `| ${metric} | ${base.toFixed(2)}% | ${pr.toFixed(2)}% | ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}% ${symbol} |`
    )
    .join('\n');

  return `### 📊 Vite Coverage Report

| Metric     | Base     | PR       | Δ        |
|------------|----------|----------|----------|
${rows}

_Reported by **vite-pr-coverage-insight**_
`;
}