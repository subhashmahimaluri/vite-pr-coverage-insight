import { compareCoverage, CoverageSummary } from './compareCoverage';

export function formatMarkdown(base: CoverageSummary, pr: CoverageSummary) {
  const rows = compareCoverage(base, pr)
    .map(({ metric, base, pr, delta }) => {
      const symbol = delta > 0 ? '✅' : delta < 0 ? '❌' : '➖';
      return `| ${metric} | ${base}% | ${pr}% | ${delta}% ${symbol} |`;
    })
    .join('\n');

  return `## 📊 Vite Coverage Report

| Metric     | Base   | PR     | Δ       |
|------------|--------|--------|---------|
${rows}

---
_Reported by vite-pr-coverage-insight_
`;
}