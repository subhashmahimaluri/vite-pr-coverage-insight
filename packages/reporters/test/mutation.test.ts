import { describe, expect, it } from 'vitest';
import { parseMutationReport } from '@coverage-insight/core';
import { buildReport, renderFixPlan, renderMarkdown } from '@coverage-insight/reporters';
import { renderMetricBandSvg } from '../../history/src/metricBand';
import { model, passPolicy } from './helpers';

const STRYKER_REPORT = JSON.stringify({
  schemaVersion: '2',
  thresholds: { high: 80, low: 60 },
  files: {
    '/repo/src/changed.ts': {
      language: 'typescript',
      mutants: [
        {
          id: '1',
          mutatorName: 'EqualityOperator',
          status: 'Killed',
          location: { start: { line: 4, column: 1 }, end: { line: 4, column: 9 } },
        },
        {
          id: '2',
          mutatorName: 'ConditionalExpression',
          status: 'Survived',
          replacement: 'true',
          location: { start: { line: 9, column: 1 }, end: { line: 9, column: 12 } },
        },
        {
          id: '3',
          mutatorName: 'ArithmeticOperator',
          status: 'NoCoverage',
          replacement: 'a - b',
          location: { start: { line: 14, column: 1 }, end: { line: 14, column: 6 } },
        },
      ],
    },
    '/repo/src/legacy.ts': {
      language: 'typescript',
      mutants: [
        {
          id: '4',
          mutatorName: 'BooleanLiteral',
          status: 'Survived',
          location: { start: { line: 2, column: 1 }, end: { line: 2, column: 5 } },
        },
        {
          id: '5',
          mutatorName: 'StringLiteral',
          status: 'Timeout',
          location: { start: { line: 6, column: 1 }, end: { line: 6, column: 5 } },
        },
        {
          id: '6',
          mutatorName: 'BlockStatement',
          status: 'CompileError',
          location: { start: { line: 8, column: 1 }, end: { line: 8, column: 5 } },
        },
      ],
    },
  },
});

function reportWithMutation(baselineScore: number | null = 38.2) {
  return buildReport({
    head: model([
      { path: 'src/changed.ts', covered: 8, total: 10 },
      { path: 'src/legacy.ts', covered: 5, total: 10 },
    ]),
    base: model([{ path: 'src/legacy.ts', covered: 5, total: 10 }]),
    policy: passPolicy,
    policyMeta: { description: 'min lines 80%' },
    generatedAt: '2026-06-12T00:00:00.000Z',
    pr: { number: 44 },
    touchedFiles: ['src/changed.ts'],
    mutation: { summary: parseMutationReport(STRYKER_REPORT, '/repo'), baselineScore },
  });
}

describe('parseMutationReport', () => {
  it('computes the Stryker score: detected / valid, excluding errors', () => {
    const summary = parseMutationReport(STRYKER_REPORT, '/repo');
    // valid = killed 1 + timeout 1 + survived 2 + noCoverage 1 = 5; detected = 2
    expect(summary.total).toBe(5);
    expect(summary.detected).toBe(2);
    expect(summary.survived).toBe(2);
    expect(summary.noCoverage).toBe(1);
    expect(summary.score).toBe(40);
  });

  it('relativizes file keys and groups survivors per file', () => {
    const summary = parseMutationReport(STRYKER_REPORT, '/repo');
    expect(Object.keys(summary.survivedByFile).sort()).toEqual(['src/changed.ts', 'src/legacy.ts']);
    expect(summary.survivedByFile['src/changed.ts']).toHaveLength(2);
    expect(summary.survivedByFile['src/changed.ts'][0]).toMatchObject({
      line: 9,
      mutator: 'ConditionalExpression',
      replacement: 'true',
    });
  });

  it('degrades to empty on arbitrary shapes, throws cleanly on non-JSON', () => {
    expect(parseMutationReport('null').score).toBeNull();
    expect(parseMutationReport('{"files": 5}').total).toBe(0);
    expect(() => parseMutationReport('{nope')).toThrow(/not valid JSON/);
  });
});

describe('report + comment + fix plan integration', () => {
  it('builds report.mutation with delta and CHANGED-file survivors only', () => {
    const report = reportWithMutation();
    expect(report.mutation).toMatchObject({ score: 40, delta: 1.8 });
    // src/legacy.ts survivor is pre-existing — not in changedFileSurvivors
    expect(report.mutation!.changedFileSurvivors).toHaveLength(2);
    expect(report.mutation!.changedFileSurvivors.every((m) => m.file === 'src/changed.ts')).toBe(
      true
    );
  });

  it('renders the surviving-mutants spoiler in the comment', () => {
    const md = renderMarkdown(reportWithMutation());
    expect(md).toContain('🧬 Surviving mutants in changed files (2) — bugs the tests missed');
    expect(md).toContain('`ConditionalExpression`');
    expect(md).toContain('`true`');
  });

  it('adds the 🧬 card to the shields fallback with killed counts', () => {
    const md = renderMarkdown(reportWithMutation(), { visuals: 'images' });
    expect(md).toContain('<h3>🧬 MUTATION</h3>');
    expect(md).toContain(encodeURIComponent('40.0%'));
    expect(md).toContain('2 / 5 mutants killed');
  });

  it('adds kill prompts to the fix plan', () => {
    const plan = renderFixPlan(reportWithMutation());
    expect(plan).toContain('## 🧬 Surviving mutants in changed files (2) — kill these');
    expect(plan).toContain('Write a test that kills this surviving mutant in `src/changed.ts`');
    expect(plan).toContain('the ConditionalExpression mutator changed the code into `true`');
  });
});

describe('metric band 🧬 card', () => {
  const series = [
    { sha: 'a', metrics: { statements: 80, branches: 80, functions: 80, lines: 80 } },
  ];

  it('renders a trailing mutation card with score, delta and survivors line', () => {
    const svg = renderMetricBandSvg(series, 'light', {
      gate: { verdict: 'pass', subtitle: 'all thresholds met' },
      mutation: { score: 72.4, delta: 1.2, changedSurvivors: 2 },
    });
    expect(svg.match(/<rect[^>]*rx="8"/g)).toHaveLength(6); // gate + 4 metrics + mutation
    expect(svg).toContain('🧬 Mutation');
    expect(svg).toContain('72.4%');
    expect(svg).toContain('▲1.2');
    expect(svg).toContain('2 surviving in changed files');
  });

  it('stays at 4 cards without options (backwards compatible)', () => {
    expect(renderMetricBandSvg(series, 'light').match(/<rect[^>]*rx="8"/g)).toHaveLength(4);
  });
});
