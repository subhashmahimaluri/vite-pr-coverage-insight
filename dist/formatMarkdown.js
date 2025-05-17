"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatMarkdown = formatMarkdown;
const compareCoverage_1 = require("./compareCoverage");
function formatMarkdown(base, pr) {
    const rows = (0, compareCoverage_1.compareCoverage)(base, pr)
        .map(({ metric, base, pr, delta, symbol }) => `| ${metric} | ${base.toFixed(2)}% | ${pr.toFixed(2)}% | ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}% ${symbol} |`)
        .join('\n');
    return `### 📊 Vite Coverage Report

| Metric     | Base     | PR       | Δ        |
|------------|----------|----------|----------|
${rows}

_Reported by **vite-pr-coverage-insight**_
`;
}
