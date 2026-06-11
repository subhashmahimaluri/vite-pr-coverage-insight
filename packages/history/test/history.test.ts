import { describe, expect, it } from 'vitest';
import type { CoverageSummary } from '@coverage-insight/core';
import {
  badgeFiles,
  commentImageMarkdown,
  entriesToSeries,
  lastN,
  readHistoryEntries,
  renderDeltaBadgeSvg,
  renderSparklineSvg,
  renderUnicodeSparkline,
  shieldsEndpointJson,
} from '../src/index';

function summary(linesPct: number): CoverageSummary {
  const m = { pct: linesPct, total: 100, covered: linesPct, skipped: 0 };
  return { total: { lines: m, statements: m, functions: m, branches: m } } as CoverageSummary;
}

function entry(sha: string, timestamp: string, pct: number) {
  return { sha, ref: 'refs/heads/main', timestamp, summary: summary(pct) };
}

describe('series', () => {
  it('orders newest-first entries into an oldest-first series', () => {
    const series = entriesToSeries([
      entry('c', '2026-06-11T00:00:00Z', 90),
      entry('b', '2026-06-10T00:00:00Z', 85),
      entry('a', '2026-06-09T00:00:00Z', 80),
    ]);
    expect(series.map((p) => p.sha)).toEqual(['a', 'b', 'c']);
    expect(lastN(series, 'lines', 2)).toEqual([85, 90]);
  });

  it('readHistoryEntries: happy path, corrupt entry skipped, missing index empty', async () => {
    const files = new Map<string, string>([
      ['index.json', JSON.stringify({ entries: [{ sha: 'a' }, { sha: 'bad' }, { sha: 'b' }] })],
      ['baselines/a.json', JSON.stringify(entry('a', 't1', 90))],
      ['baselines/bad.json', '{corrupt'],
      ['baselines/b.json', JSON.stringify(entry('b', 't2', 80))],
    ]);
    const entries = await readHistoryEntries(async (p) => files.get(p) ?? null);
    expect(entries.map((e) => e.sha)).toEqual(['a', 'b']);

    expect(await readHistoryEntries(async () => null)).toEqual([]);
  });
});

describe('sparklines', () => {
  it('unicode sparkline normalizes to series min/max', () => {
    expect(renderUnicodeSparkline([0, 25, 50, 75, 100])).toBe('▁▃▅▆█');
    expect(renderUnicodeSparkline([90, 90, 90])).toBe('▄▄▄'); // flat series
  });

  it('SVG sparkline is deterministic and inline-safe', () => {
    const a = renderSparklineSvg([80, 85, 90]);
    expect(a).toBe(renderSparklineSvg([80, 85, 90]));
    expect(a).toContain('<svg');
    expect(a).toContain('polyline');
    // the only URL is the SVG xmlns namespace identifier, never fetched
    expect(a.replace('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:\/\//);
  });
});

describe('badges', () => {
  it('delta badge encodes direction and value deterministically', () => {
    const up = renderDeltaBadgeSvg('lines', 90.1, 0.4);
    expect(up).toContain('90.1%');
    expect(up).toBe(renderDeltaBadgeSvg('lines', 90.1, 0.4));
    expect(renderDeltaBadgeSvg('lines', 90.1, -0.4)).not.toBe(up);
  });

  it('shields endpoint colors follow the thresholds', () => {
    const cases: [number, string][] = [
      [95, 'brightgreen'],
      [85, 'green'],
      [75, 'yellowgreen'],
      [65, 'yellow'],
      [55, 'orange'],
      [45, 'red'],
    ];
    for (const [pct, color] of cases) {
      expect(JSON.parse(shieldsEndpointJson('lines', pct))).toMatchObject({
        schemaVersion: 1,
        color,
      });
    }
  });
});

describe('publish helpers', () => {
  it('badgeFiles emits 12 files (3 per metric) with delta from the series tail', () => {
    const series = entriesToSeries([
      entry('b', '2026-06-11T00:00:00Z', 90),
      entry('a', '2026-06-10T00:00:00Z', 85),
    ]);
    const files = badgeFiles(series);
    expect(files).toHaveLength(12);
    expect(files.map((f) => f.path)).toContain('badges/sparkline-lines.svg');
    expect(files.map((f) => f.path)).toContain('badges/endpoint-branches.json');
  });

  it('single-point series produces null deltas without crashing', () => {
    const files = badgeFiles(entriesToSeries([entry('a', 't', 85)]));
    expect(files).toHaveLength(12);
  });

  it('commentImageMarkdown points at the raw history-branch URL', () => {
    const md = commentImageMarkdown({
      owner: 'acme',
      repo: 'demo',
      branch: 'coverage-baseline',
      metric: 'lines',
    });
    expect(md).toContain(
      'https://raw.githubusercontent.com/acme/demo/coverage-baseline/badges/sparkline-lines.svg'
    );
  });
});

describe('metric band (composite SVG)', () => {
  it('is deterministic with light/dark variants and delta coloring', async () => {
    const { renderMetricBandSvg, metricBandPath } = await import('../src/metricBand');
    const series = entriesToSeries([
      entry('b', '2026-06-11T00:00:00Z', 90),
      entry('a', '2026-06-10T00:00:00Z', 85),
    ]);
    const light = renderMetricBandSvg(series, 'light');
    expect(light).toBe(renderMetricBandSvg(series, 'light'));
    expect(light).toContain('Statements');
    expect(light).toContain('90.0%');
    expect(light).toContain('▲5.0');
    expect(light).toContain('#1a7f37'); // green for positive delta
    const dark = renderMetricBandSvg(series, 'dark');
    expect(dark).not.toBe(light);
    expect(dark).toContain('#0d1117');
    expect(metricBandPath('dark')).toBe('badges/metric-band-dark.svg');
  });

  it('cards carry covered/total counts when the summary has them', async () => {
    const { renderMetricBandSvg, prMetricBandPath } = await import('../src/metricBand');
    const series = entriesToSeries([entry('a', '2026-06-10T00:00:00Z', 85)]);
    expect(series[0].counts?.lines).toEqual({ covered: 85, total: 100 });
    const svg = renderMetricBandSvg(series, 'light');
    expect(svg).toContain('85/100 covered');
    expect(prMetricBandPath(39, 'light')).toBe('badges/pr-39-metric-band-light.svg');
  });
});
