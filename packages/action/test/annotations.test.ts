import { describe, expect, it } from 'vitest';
import type { CoverageReport, TestFailuresResult } from '@coverage-insight/core';
import {
  ANNOTATIONS_PER_REQUEST,
  MAX_ANNOTATIONS,
  buildCoverageAnnotations,
  buildFailedTestAnnotations,
  chunkAnnotations,
  collectAnnotations,
} from '../src/annotations';

function reportWith(
  files: { path: string; touched?: boolean; ranges?: { start: number; end: number }[] }[]
): CoverageReport {
  return {
    schemaVersion: 1,
    generatedAt: 't',
    state: 'passed',
    files: files.map((f) => ({
      path: f.path,
      change: 'modified' as const,
      ...(f.touched !== undefined ? { touched: f.touched } : {}),
      metrics: { lines: { base: 80, head: 70, delta: -10 } },
      ...(f.ranges ? { uncoveredRanges: f.ranges } : {}),
    })),
  } as unknown as CoverageReport;
}

const failures: TestFailuresResult = {
  numFailedTests: 2,
  numTotalTests: 10,
  failedTests: [
    {
      testName: 'boom',
      filePath: '/home/runner/work/demo/demo/src/a.test.ts',
      message: 'AssertionError: nope',
    },
    { testName: 'bang', filePath: 'src/b.test.ts' },
  ],
};

describe('buildCoverageAnnotations', () => {
  it('annotates uncovered ranges only in touched files', () => {
    const annotations = buildCoverageAnnotations(
      reportWith([
        { path: 'src/a.ts', touched: true, ranges: [{ start: 88, end: 104 }] },
        { path: 'src/b.ts', touched: false, ranges: [{ start: 1, end: 2 }] },
        { path: 'src/c.ts', touched: true }, // fully covered
      ])
    );
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({
      path: 'src/a.ts',
      start_line: 88,
      end_line: 104,
      annotation_level: 'warning',
    });
    expect(annotations[0].message).toContain('88–104');
  });

  it('single-line ranges get the singular message', () => {
    const [a] = buildCoverageAnnotations(
      reportWith([{ path: 'src/a.ts', touched: true, ranges: [{ start: 5, end: 5 }] }])
    );
    expect(a.message).toBe('This line is not covered by tests.');
  });
});

describe('buildFailedTestAnnotations', () => {
  it('maps failures to failure-level annotations with relativized paths', () => {
    const annotations = buildFailedTestAnnotations(failures, '/home/runner/work/demo/demo');
    expect(annotations).toHaveLength(2);
    expect(annotations[0]).toMatchObject({
      path: 'src/a.test.ts',
      annotation_level: 'failure',
      start_line: 1,
    });
    expect(annotations[0].message).toContain('AssertionError: nope');
    expect(annotations[1].message).toBe('bang');
  });

  it('returns nothing when tests passed', () => {
    expect(
      buildFailedTestAnnotations({ numFailedTests: 0, numTotalTests: 5, failedTests: [] }, '/w')
    ).toEqual([]);
  });
});

describe('collectAnnotations', () => {
  const report = reportWith([{ path: 'src/a.ts', touched: true, ranges: [{ start: 1, end: 1 }] }]);

  it('mode filters work', () => {
    const base = { report, testFailures: failures, workspace: '/w' };
    expect(collectAnnotations({ mode: 'none', ...base })).toHaveLength(0);
    expect(collectAnnotations({ mode: 'coverage', ...base })).toHaveLength(1);
    expect(collectAnnotations({ mode: 'failed-tests', ...base })).toHaveLength(2);
    expect(collectAnnotations({ mode: 'all', ...base })).toHaveLength(3);
  });

  it('failures rank before coverage and the total is capped at 200', () => {
    const big = reportWith(
      Array.from({ length: 300 }, (_, i) => ({
        path: `src/f${i}.ts`,
        touched: true,
        ranges: [{ start: 1, end: 1 }],
      }))
    );
    const annotations = collectAnnotations({
      mode: 'all',
      report: big,
      testFailures: failures,
      workspace: '/w',
    });
    expect(annotations).toHaveLength(MAX_ANNOTATIONS);
    expect(annotations[0].annotation_level).toBe('failure');
  });
});

describe('chunkAnnotations', () => {
  it('chunks by the 50-per-request API limit', () => {
    const annotations = collectAnnotations({
      mode: 'coverage',
      report: reportWith(
        Array.from({ length: 120 }, (_, i) => ({
          path: `src/f${i}.ts`,
          touched: true,
          ranges: [{ start: 1, end: 1 }],
        }))
      ),
      testFailures: null,
      workspace: '/w',
    });
    const chunks = chunkAnnotations(annotations);
    expect(chunks.map((c) => c.length)).toEqual([
      ANNOTATIONS_PER_REQUEST,
      ANNOTATIONS_PER_REQUEST,
      20,
    ]);
  });
});
