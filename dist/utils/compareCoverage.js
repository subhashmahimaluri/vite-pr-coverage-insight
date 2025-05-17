"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareFileCoverage = compareFileCoverage;
exports.compareCoverage = compareCoverage;
function compareFileCoverage(base, pr) {
    const metrics = ['statements', 'branches', 'functions', 'lines'];
    const fileChanges = [];
    // Get all unique file paths from both base and PR
    const allFiles = new Set();
    Object.keys(base).forEach(key => key !== 'total' && allFiles.add(key));
    Object.keys(pr).forEach(key => key !== 'total' && allFiles.add(key));
    // Compare each file's coverage
    allFiles.forEach(file => {
        const fileMetrics = metrics.map(metric => {
            const basePct = base[file]?.[metric]?.pct ?? 0;
            const prPct = pr[file]?.[metric]?.pct ?? 0;
            const delta = Number((prPct - basePct).toFixed(2));
            return {
                metric,
                base: basePct,
                pr: prPct,
                delta,
                symbol: delta > 0 ? '🟢' : delta < 0 ? '🔴' : '⚪',
            };
        });
        if (fileMetrics.some(m => m.delta !== 0)) {
            fileChanges.push({ file, metrics: fileMetrics });
        }
    });
    return fileChanges;
}
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
