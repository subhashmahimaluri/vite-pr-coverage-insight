"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareCoverage = compareCoverage;
function compareCoverage(base, pr) {
    const metrics = ['statements', 'branches', 'functions', 'lines'];
    return metrics.map((metric) => {
        const basePct = base.total[metric].pct ?? 0;
        const prPct = pr.total[metric].pct ?? 0;
        const delta = parseFloat((prPct - basePct).toFixed(2));
        return {
            metric,
            base: basePct,
            pr: prPct,
            delta,
            symbol: delta > 0 ? '🟢' : delta < 0 ? '🔴' : '⚪',
        };
    });
}
