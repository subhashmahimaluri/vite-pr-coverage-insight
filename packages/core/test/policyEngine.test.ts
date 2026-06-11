import { describe, expect, it } from 'vitest';
import { configSchema, type Config } from '../src/config/schema';
import { METRIC_KEYS, type CoverageModel, type MetricKey } from '../src/model';
import { evaluatePolicy, type PolicyInput } from '../src/policy/engine';
import type { PolicyViolation, PolicyVerdict } from '../src/policy/types';

type Pcts = number | Partial<Record<MetricKey, number>>;

function metrics(pcts: Pcts): CoverageModel['total'] {
  const get = (key: MetricKey): number => (typeof pcts === 'number' ? pcts : (pcts[key] ?? 100));
  return Object.fromEntries(
    METRIC_KEYS.map((key) => [key, { pct: get(key), total: 100, covered: get(key), skipped: 0 }])
  ) as CoverageModel['total'];
}

function model(total: Pcts, files: Record<string, Pcts> = {}): CoverageModel {
  return {
    total: metrics(total),
    files: Object.entries(files).map(([path, pcts]) => ({ path, metrics: metrics(pcts) })),
  };
}

function cfg(partial: Record<string, unknown>): Config {
  return configSchema.parse(partial);
}

type Case = {
  name: string;
  input: PolicyInput;
  verdict: PolicyVerdict;
  violations: Partial<PolicyViolation>[];
};

const cases: Case[] = [
  {
    name: 'pass: no thresholds, no ratchet',
    input: { head: model(50, { 'src/a.ts': 50 }), config: cfg({}) },
    verdict: 'pass',
    violations: [],
  },
  {
    name: 'pass: global threshold met by total',
    input: { head: model(85), config: cfg({ thresholds: { lines: 80 } }) },
    verdict: 'pass',
    violations: [],
  },
  {
    name: 'fail: global threshold missed by total',
    input: { head: model(75), config: cfg({ thresholds: { lines: 80 } }) },
    verdict: 'fail',
    violations: [
      { rule: 'threshold', metric: 'lines', scope: 'total', required: 80, actual: 75, gap: 5 },
    ],
  },
  {
    name: 'fail: multiple global metrics missed, gap rounded to 2 decimals',
    input: {
      head: model({ lines: 77.333, branches: 60, functions: 90, statements: 90 }),
      config: cfg({ thresholds: { lines: 80, branches: 70, functions: 90 } }),
    },
    verdict: 'fail',
    violations: [
      { rule: 'threshold', metric: 'branches', scope: 'total', required: 70, actual: 60, gap: 10 },
      {
        rule: 'threshold',
        metric: 'lines',
        scope: 'total',
        required: 80,
        actual: 77.333,
        gap: 2.67,
      },
    ],
  },
  {
    name: 'pass: file meets its override threshold',
    input: {
      head: model(100, { 'src/utils/a.ts': 95 }),
      config: cfg({ overrides: [{ path: 'src/utils/**', thresholds: { lines: 90 } }] }),
    },
    verdict: 'pass',
    violations: [],
  },
  {
    name: 'fail: file misses its override threshold (scope = file path)',
    input: {
      head: model(100, { 'src/utils/a.ts': 80, 'src/other.ts': 10 }),
      config: cfg({ overrides: [{ path: 'src/utils/**', thresholds: { lines: 90 } }] }),
    },
    verdict: 'fail',
    violations: [
      {
        rule: 'override-threshold',
        metric: 'lines',
        scope: 'src/utils/a.ts',
        required: 90,
        actual: 80,
        gap: 10,
      },
    ],
  },
  {
    name: 'override specificity: longest literal prefix wins per file',
    input: {
      head: model(100, { 'src/utils/a.ts': 80, 'src/other.ts': 80 }),
      config: cfg({
        overrides: [
          { path: 'src/utils/**', thresholds: { lines: 90 } },
          { path: 'src/**', thresholds: { lines: 50 } },
        ],
      }),
    },
    verdict: 'fail',
    // src/utils/a.ts checked against the more specific 90 (fails);
    // src/other.ts checked against 50 only (passes).
    violations: [
      { rule: 'override-threshold', scope: 'src/utils/a.ts', metric: 'lines', required: 90 },
    ],
  },
  {
    name: 'override specificity tie: later array position wins',
    input: {
      head: model(100, { 'src/utils/a.ts': 80 }),
      config: cfg({
        overrides: [
          { path: 'src/utils/**', thresholds: { lines: 95 } },
          { path: 'src/utils/**', thresholds: { lines: 90 } },
        ],
      }),
    },
    verdict: 'fail',
    violations: [{ rule: 'override-threshold', scope: 'src/utils/a.ts', required: 90, gap: 10 }],
  },
  {
    name: 'fail: ratchet total decrease beyond tolerance',
    input: {
      head: model(89),
      base: model(90),
      config: cfg({ ratchet: true }),
    },
    verdict: 'fail',
    violations: METRIC_KEYS.map((metric) => ({
      rule: 'ratchet-total' as const,
      metric,
      scope: 'total',
      required: 90,
      actual: 89,
      gap: 1,
    })),
  },
  {
    name: 'fail: ratchet per-file decrease beyond tolerance',
    input: {
      head: model(90, { 'src/a.ts': { lines: 70 } }),
      base: model(90, { 'src/a.ts': { lines: 75 } }),
      config: cfg({ ratchet: true }),
    },
    verdict: 'fail',
    violations: [
      {
        rule: 'ratchet-file',
        metric: 'lines',
        scope: 'src/a.ts',
        required: 75,
        actual: 70,
        gap: 5,
      },
    ],
  },
  {
    name: 'warn: decrease exactly at tolerance does NOT fail',
    input: {
      head: model({ lines: 89.9, branches: 100, functions: 100, statements: 100 }),
      base: model({ lines: 90, branches: 100, functions: 100, statements: 100 }),
      config: cfg({ ratchet: true, ratchetTolerance: 0.1 }),
    },
    verdict: 'warn',
    violations: [],
  },
  {
    name: 'warn: per-file decrease within tolerance',
    input: {
      head: model(100, { 'src/a.ts': { lines: 94.95 } }),
      base: model(100, { 'src/a.ts': { lines: 95 } }),
      config: cfg({ ratchet: true, ratchetTolerance: 0.1 }),
    },
    verdict: 'warn',
    violations: [],
  },
  {
    name: 'fail: decrease just past tolerance',
    input: {
      head: model(100, { 'src/a.ts': { lines: 94.89 } }),
      base: model(100, { 'src/a.ts': { lines: 95 } }),
      config: cfg({ ratchet: true, ratchetTolerance: 0.1 }),
    },
    verdict: 'fail',
    violations: [
      {
        rule: 'ratchet-file',
        scope: 'src/a.ts',
        metric: 'lines',
        required: 95,
        actual: 94.89,
        gap: 0.11,
      },
    ],
  },
  {
    name: 'warn: ratchet enabled but base is missing',
    input: { head: model(100), config: cfg({ ratchet: true }) },
    verdict: 'warn',
    violations: [],
  },
  {
    name: 'warn: ratchet enabled but base is null',
    input: { head: model(100), base: null, config: cfg({ ratchet: true }) },
    verdict: 'warn',
    violations: [],
  },
  {
    name: 'pass: ratchet off ignores decreases vs base',
    input: { head: model(50), base: model(90), config: cfg({}) },
    verdict: 'pass',
    violations: [],
  },
  {
    name: 'pass: ratchet skips files only present in head (new files)',
    input: {
      head: model(90, { 'src/new.ts': 10 }),
      base: model(90),
      config: cfg({ ratchet: true }),
    },
    verdict: 'pass',
    violations: [],
  },
  {
    name: 'pass: ratchet with improvement',
    input: {
      head: model(92, { 'src/a.ts': 95 }),
      base: model(90, { 'src/a.ts': 90 }),
      config: cfg({ ratchet: true }),
    },
    verdict: 'pass',
    violations: [],
  },
  {
    name: 'fail: threshold violation combined with clean ratchet',
    input: {
      head: model({ lines: 75, branches: 100, functions: 100, statements: 100 }),
      base: model({ lines: 75, branches: 100, functions: 100, statements: 100 }),
      config: cfg({ thresholds: { lines: 80 }, ratchet: true }),
    },
    verdict: 'fail',
    violations: [{ rule: 'threshold', metric: 'lines', scope: 'total', required: 80, gap: 5 }],
  },
  {
    name: 'fail: global threshold + override + ratchet all violated',
    input: {
      head: model(
        { lines: 70, branches: 100, functions: 100, statements: 100 },
        { 'src/utils/a.ts': { lines: 60 } }
      ),
      base: model(
        { lines: 80, branches: 100, functions: 100, statements: 100 },
        { 'src/utils/a.ts': { lines: 80 } }
      ),
      config: cfg({
        thresholds: { lines: 80 },
        overrides: [{ path: 'src/utils/**', thresholds: { lines: 90 } }],
        ratchet: true,
      }),
    },
    verdict: 'fail',
    violations: [
      { rule: 'threshold', metric: 'lines', scope: 'total', required: 80, actual: 70, gap: 10 },
      {
        rule: 'override-threshold',
        metric: 'lines',
        scope: 'src/utils/a.ts',
        required: 90,
        gap: 30,
      },
      { rule: 'ratchet-total', metric: 'lines', scope: 'total', required: 80, actual: 70, gap: 10 },
      {
        rule: 'ratchet-file',
        metric: 'lines',
        scope: 'src/utils/a.ts',
        required: 80,
        actual: 60,
        gap: 20,
      },
    ],
  },
];

describe('evaluatePolicy (table-driven)', () => {
  it.each(cases)('$name', ({ input, verdict, violations }) => {
    const result = evaluatePolicy(input);
    expect(result.verdict).toBe(verdict);
    expect(result.violations).toHaveLength(violations.length);
    for (const expected of violations) {
      expect(result.violations).toEqual(
        expect.arrayContaining([expect.objectContaining(expected)])
      );
    }
  });

  it('gaps are always positive and rounded to 2 decimals', () => {
    const result = evaluatePolicy({
      head: model({ lines: 77.333, branches: 100, functions: 100, statements: 100 }),
      config: cfg({ thresholds: { lines: 80.005 } }),
    });
    expect(result.verdict).toBe('fail');
    for (const violation of result.violations) {
      expect(violation.gap).toBeGreaterThan(0);
      expect(violation.gap).toBe(Math.round(violation.gap * 100) / 100);
    }
  });
});
