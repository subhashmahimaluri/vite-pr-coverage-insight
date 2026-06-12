import { describe, expect, it } from 'vitest';
import { prMetricBandPath, renderMetricBandSvg } from '../src/metricBand';
import type { HistoryPoint } from '../src/series';

const point = (lines: number, sha = 'abc'): HistoryPoint => ({
  sha,
  metrics: { statements: lines, branches: lines, functions: lines, lines },
});

describe('metric band gate card', () => {
  const series = [point(80, 'a'), point(82, 'b'), point(85, 'c')];

  it('renders a leading PASS/FAIL card when gate info is provided (5 cards)', () => {
    const failed = renderMetricBandSvg(series, 'light', {
      gate: { verdict: 'fail', subtitle: '2 violations' },
    });
    expect(failed.match(/<rect[^>]*rx="8"/g)).toHaveLength(5);
    expect(failed).toContain('🚦 Coverage gate');
    expect(failed).toContain('>FAIL<');
    expect(failed).toContain('2 violations');

    const passed = renderMetricBandSvg(series, 'dark', {
      gate: { verdict: 'pass', subtitle: 'all thresholds met' },
    });
    expect(passed).toContain('>PASS<');
    expect(passed).toContain('all thresholds met');
  });

  it('stays at 4 cards without gate info (backwards compatible)', () => {
    const svg = renderMetricBandSvg(series, 'light');
    expect(svg.match(/<rect[^>]*rx="8"/g)).toHaveLength(4);
    expect(svg).not.toContain('Coverage gate');
  });

  it('is deterministic', () => {
    const opts = { gate: { verdict: 'warn' as const, subtitle: 'decreased within tolerance' } };
    expect(renderMetricBandSvg(series, 'light', opts)).toBe(
      renderMetricBandSvg(series, 'light', opts)
    );
  });
});

describe('prMetricBandPath', () => {
  it('uses a unique per-run filename when uniq is given (cache-proof)', () => {
    expect(prMetricBandPath(44, 'light')).toBe('badges/pr-44-metric-band-light.svg');
    expect(prMetricBandPath(44, 'light', 'feedbee-123')).toBe('badges/pr-44/feedbee-123-light.svg');
  });
});
