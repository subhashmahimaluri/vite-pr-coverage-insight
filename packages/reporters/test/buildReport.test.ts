import { describe, expect, it } from 'vitest';
import { coverageReportSchema } from '@coverage-insight/core';
import { buildReport, collapseUncoveredRanges } from '../src/index';
import { GENERATED_AT, baselineMeta, failPolicy, model, passPolicy } from './helpers';

const headBetter = model([{ path: 'src/a.ts', covered: 9, total: 10 }]);
const headWorse = model([{ path: 'src/a.ts', covered: 7, total: 10 }]);
const base = model([{ path: 'src/a.ts', covered: 8, total: 10 }]);

function build(overrides: Partial<Parameters<typeof buildReport>[0]> = {}) {
  return buildReport({
    head: headBetter,
    base,
    policy: passPolicy,
    baseline: baselineMeta,
    generatedAt: GENERATED_AT,
    ...overrides,
  });
}

describe('buildReport state classification (priority order)', () => {
  it('state 1: passed', () => {
    expect(build().state).toBe('passed');
  });

  it('state 2: threshold-failed when policy fails on a threshold rule', () => {
    expect(build({ policy: failPolicy }).state).toBe('threshold-failed');
  });

  it('state 3: tests-failed beats threshold-failed', () => {
    const report = build({
      policy: failPolicy,
      testFailures: { numFailedTests: 1, numTotalTests: 5, failedTests: [] },
    });
    expect(report.state).toBe('tests-failed');
  });

  it('state 4: regression when a file metric decreased', () => {
    expect(build({ head: headWorse }).state).toBe('regression');
  });

  it('state 5: no-baseline when base is missing', () => {
    expect(build({ base: null, baseline: null }).state).toBe('no-baseline');
  });

  it('state 6: invalid-data wins over everything', () => {
    const report = build({
      errors: [{ input: 'head', message: 'corrupt JSON', hint: 'check the path' }],
      testFailures: { numFailedTests: 1, numTotalTests: 5, failedTests: [] },
    });
    expect(report.state).toBe('invalid-data');
  });

  it('state 7: no-change when every delta is zero', () => {
    expect(build({ head: base }).state).toBe('no-change');
  });

  it('state 8: monorepo when projects are present', () => {
    const project = {
      name: 'pkg-a',
      state: 'passed' as const,
      totals: build().totals!,
      files: [],
      policy: passPolicy,
    };
    expect(build({ projects: [project] }).state).toBe('monorepo');
  });
});

describe('buildReport output', () => {
  it('every state validates against the schema', () => {
    const reports = [
      build(),
      build({ policy: failPolicy }),
      build({ testFailures: { numFailedTests: 1, numTotalTests: 5, failedTests: [] } }),
      build({ head: headWorse }),
      build({ base: null, baseline: null }),
      build({ errors: [{ input: 'base', message: 'missing' }] }),
      build({ head: base }),
    ];
    for (const report of reports) {
      expect(() => coverageReportSchema.parse(report)).not.toThrow();
    }
  });

  it('computes deltas and change classification', () => {
    const report = build({
      head: model([
        { path: 'src/a.ts', covered: 9, total: 10 },
        { path: 'src/new.ts', covered: 5, total: 5 },
      ]),
    });
    const a = report.files!.find((f) => f.path === 'src/a.ts')!;
    expect(a.change).toBe('modified');
    expect(a.metrics.lines).toEqual({ base: 80, head: 90, delta: 10 });
    const fresh = report.files!.find((f) => f.path === 'src/new.ts')!;
    expect(fresh.change).toBe('new');
    expect(fresh.metrics.lines.base).toBeNull();
  });

  it('collapses uncovered lines into ranges', () => {
    expect(collapseUncoveredRanges([7, 1, 2, 3, 9, 9])).toEqual([
      { start: 1, end: 3 },
      { start: 7, end: 7 },
      { start: 9, end: 9 },
    ]);
  });

  it('is deterministic for identical input', () => {
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});
