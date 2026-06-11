import { describe, expect, it } from 'vitest';
import { lcovParser } from '../src/parsers';

const FILE_COUNT = 2000;
const LINES_PER_FILE = 50;

/**
 * Generates a synthetic lcov tracefile: 2000 files x 50 DA lines (plus
 * summary records) — well over 100k physical lines. Every 10th source line
 * is uncovered, so per file 45/50 lines are hit.
 */
function generateLcov(): string {
  const parts: string[] = [];
  for (let f = 0; f < FILE_COUNT; f += 1) {
    parts.push(`SF:src/generated/file-${f}.ts`);
    parts.push('FNF:4');
    parts.push('FNH:3');
    parts.push('BRF:10');
    parts.push('BRH:7');
    for (let line = 1; line <= LINES_PER_FILE; line += 1) {
      parts.push(`DA:${line},${line % 10 === 0 ? 0 : 1}`);
    }
    parts.push(`LF:${LINES_PER_FILE}`);
    parts.push(`LH:${LINES_PER_FILE - LINES_PER_FILE / 10}`);
    parts.push('end_of_record');
  }
  return parts.join('\n') + '\n';
}

describe('lcov streaming parser benchmark', () => {
  it('parses a 100k-line lcov file in under 2 seconds with exact totals', () => {
    const content = generateLcov();
    expect(content.split('\n').length).toBeGreaterThan(100_000);

    const start = performance.now();
    const model = lcovParser.parse(content);
    const elapsed = performance.now() - start;

    // Target <2s locally; the bound leaves generous CI margin (typically <100ms).
    expect(elapsed).toBeLessThan(2000);

    expect(model.files).toHaveLength(FILE_COUNT);
    expect(model.total.lines).toEqual({
      total: FILE_COUNT * LINES_PER_FILE, // 100,000
      covered: FILE_COUNT * (LINES_PER_FILE - LINES_PER_FILE / 10), // 90,000
      skipped: 0,
      pct: 90,
    });
    expect(model.total.statements).toEqual(model.total.lines);
    expect(model.total.functions).toEqual({
      total: FILE_COUNT * 4,
      covered: FILE_COUNT * 3,
      skipped: 0,
      pct: 75,
    });
    expect(model.total.branches).toEqual({
      total: FILE_COUNT * 10,
      covered: FILE_COUNT * 7,
      skipped: 0,
      pct: 70,
    });

    // spot-check uncovered-line extraction survived the fast path
    expect(model.files[0].uncoveredLines).toEqual([10, 20, 30, 40, 50]);
  });
});
