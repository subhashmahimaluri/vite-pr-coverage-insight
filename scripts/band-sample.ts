/**
 * Render sample metric-band SVGs (with the 🚦 gate card) into docs/gallery so
 * the README has a live hero image.
 *
 *   npx tsx scripts/band-sample.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderMetricBandSvg } from '../packages/history/src/metricBand';
import type { HistoryPoint } from '../packages/history/src/series';

const OUT = join(__dirname, '..', 'docs', 'gallery');
mkdirSync(OUT, { recursive: true });

const trend = [78.2, 79.1, 78.8, 80.4, 81.2, 81.0, 82.5, 83.1, 84.0, 84.6, 85.2, 86.1];
const series: HistoryPoint[] = trend.map((lines, i) => ({
  sha: `sha${i}`,
  timestamp: `2026-05-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
  metrics: {
    statements: lines - 1.2,
    branches: lines - 8.5,
    functions: lines + 2.1,
    lines,
  },
  counts: {
    statements: { covered: Math.round(lines * 12), total: 1240 },
    branches: { covered: Math.round(lines * 4), total: 520 },
    functions: { covered: Math.round(lines * 2), total: 230 },
    lines: { covered: Math.round(lines * 11), total: 1180 },
  },
}));

const gate = { verdict: 'pass' as const, subtitle: 'all thresholds met' };

for (const theme of ['light', 'dark'] as const) {
  writeFileSync(
    join(OUT, `metric-band-${theme}.svg`),
    renderMetricBandSvg(series, theme, { gate })
  );
}
console.log(`band samples written to ${OUT}`);
