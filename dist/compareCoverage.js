"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareCoverage = compareCoverage;
function compareCoverage(base, pr) {
    const metrics = ['statements', 'branches', 'functions', 'lines'];
    return metrics.map((metric) => {
        const basePct = base.total[metric].pct;
        const prPct = pr.total[metric].pct;
        return {
            metric,
            base: basePct,
            pr: prPct,
            delta: +(prPct - basePct).toFixed(2),
        };
    });
}
