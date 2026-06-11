import { describe, expect, it } from 'vitest';
import { compareCoverage, compareFileCoverage } from '../src';
import { loadFixturePair } from './helpers';

describe('compareCoverage (totals)', () => {
  it('reports positive deltas with ⬆️ for an improvement', () => {
    const { base, head } = loadFixturePair('improvement');
    const rows = compareCoverage(base, head);

    expect(rows.map((r) => r.metric)).toEqual(['statements', 'branches', 'functions', 'lines']);
    for (const row of rows) {
      expect(row.delta).toBeGreaterThan(0);
      expect(row.symbol).toBe('⬆️');
    }
    expect(rows.find((r) => r.metric === 'lines')).toEqual({
      metric: 'lines',
      base: 75,
      pr: 90,
      delta: 15,
      symbol: '⬆️',
    });
  });

  it('reports negative deltas with ⬇️ for a regression', () => {
    const { base, head } = loadFixturePair('regression');
    const rows = compareCoverage(base, head);

    for (const row of rows) {
      expect(row.delta).toBeLessThan(0);
      expect(row.symbol).toBe('⬇️');
    }
  });

  it('reports zero deltas with ➖ when coverage is identical', () => {
    const { base, head } = loadFixturePair('identical');
    const rows = compareCoverage(base, head);

    for (const row of rows) {
      expect(row.delta).toBe(0);
      expect(row.symbol).toBe('➖');
    }
  });

  it('treats a missing pct as 0', () => {
    const { base, head } = loadFixturePair('identical');
    const brokenBase = structuredClone(base);
    const brokenHead = structuredClone(head);
    delete (brokenBase.total.lines as { pct?: number }).pct;
    delete (brokenHead.total.lines as { pct?: number }).pct;

    const lines = compareCoverage(brokenBase, brokenHead).find((r) => r.metric === 'lines')!;
    expect(lines).toEqual({ metric: 'lines', base: 0, pr: 0, delta: 0, symbol: '➖' });
  });

  it('rounds deltas to two decimal places', () => {
    const { base, head } = loadFixturePair('regression');
    const rows = compareCoverage(base, head);

    const lines = rows.find((r) => r.metric === 'lines')!;
    expect(lines.delta).toBe(-13.81); // 76.19 - 90
  });
});

describe('compareFileCoverage (per file)', () => {
  it('lists a fully covered new file under newFiles', () => {
    const { base, head } = loadFixturePair('new-file');
    const result = compareFileCoverage(base, head);

    expect(result.newFiles).toHaveLength(1);
    expect(result.newFiles[0]).toEqual({
      file: '/app/src/date.ts',
      metrics: { branches: 100, functions: 100, lines: 100, statements: 100 },
      uncoveredLines: [],
    });
    expect(result.modifiedFiles).toHaveLength(0);
  });

  it('omits new files without full coverage (current behavior)', () => {
    const { base, head } = loadFixturePair('new-file');
    head['/app/src/date.ts'].branches.pct = 80;
    const result = compareFileCoverage(base, head);

    expect(result.newFiles).toHaveLength(0);
  });

  it('lists changed files with per-metric base/pr/delta/symbol', () => {
    const { base, head } = loadFixturePair('regression');
    const result = compareFileCoverage(base, head);

    const math = result.modifiedFiles.find((f) => f.file === '/app/src/math.ts')!;
    expect(math.metrics.lines).toEqual({
      base: 90,
      pr: 72.73,
      delta: -17.27,
      symbol: '⬇️',
    });
    expect(math.uncoveredLines).toEqual([5, 6, 20, 21, 22, 57]);
  });

  it('skips files whose coverage did not change', () => {
    const { base, head } = loadFixturePair('identical');
    const result = compareFileCoverage(base, head);

    expect(result.newFiles).toHaveLength(0);
    expect(result.modifiedFiles).toHaveLength(0);
  });

  it('ignores files deleted in the PR', () => {
    const { base, head } = loadFixturePair('deleted-file');
    const result = compareFileCoverage(base, head);

    const files = [...result.newFiles, ...result.modifiedFiles].map((f) => f.file);
    expect(files).not.toContain('/app/src/legacy.ts');
  });

  it('collects uncovered lines from line details', () => {
    const { base, head } = loadFixturePair('improvement');
    const result = compareFileCoverage(base, head);

    const math = result.modifiedFiles.find((f) => f.file === '/app/src/math.ts')!;
    expect(math.uncoveredLines).toEqual([12, 13, 14, 42]);
  });
});
