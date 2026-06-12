import { describe, expect, it } from 'vitest';
import { buildReport, renderFixPlan, renderTestPromptsSection } from '@coverage-insight/reporters';
import { model, passPolicy } from './helpers';

function report(touched: string[] = ['src/changed.ts']) {
  return buildReport({
    head: model([
      { path: 'src/changed.ts', covered: 4, total: 10, uncoveredLines: [5, 6, 7, 20] },
      { path: 'src/full.ts', covered: 10, total: 10 },
      { path: 'src/legacy.ts', covered: 1, total: 10 },
    ]),
    base: model([
      { path: 'src/full.ts', covered: 10, total: 10 },
      { path: 'src/legacy.ts', covered: 1, total: 10 },
    ]),
    policy: passPolicy,
    policyMeta: { description: 'min lines 90%' },
    generatedAt: '2026-06-12T00:00:00.000Z',
    pr: { number: 7 },
    touchedFiles: touched,
  });
}

describe('renderFixPlan', () => {
  it('puts changed files with gaps first, repo-wide debt second', () => {
    const plan = renderFixPlan(report());
    expect(plan).toContain('## 🎯 Changed in this PR with coverage gaps (1) — cover these first');
    expect(plan).toContain('`src/changed.ts`');
    expect(plan).toContain('## 🧹 Lowest-covered files repo-wide (1) — suggested cleanups');
    expect(plan).toContain('`src/legacy.ts`');
    expect(plan.indexOf('src/changed.ts')).toBeLessThan(plan.indexOf('src/legacy.ts'));
    // fully covered files never appear
    expect(plan).not.toContain('src/full.ts');
  });

  it('emits a paste-ready test prompt with uncovered lines', () => {
    const plan = renderFixPlan(report());
    expect(plan).toContain('Write tests for `src/changed.ts`.');
    expect(plan).toContain('Uncovered lines: 5–7, 20.');
    expect(plan).toContain('do not test');
    expect(plan).toContain('Batch prompt for your AI assistant');
  });

  it('celebrates fully covered changes', () => {
    const plan = renderFixPlan(report(['src/full.ts']));
    expect(plan).toContain('_Nothing — every file this PR touches is fully covered._');
  });
});

describe('renderTestPromptsSection', () => {
  it('renders a collapsed cover-with-AI block for the comment', () => {
    const section = renderTestPromptsSection(report());
    expect(section).toContain('🤖 Cover with AI — copy a prompt per changed file (1)');
    expect(section).toContain('Write tests for `src/changed.ts`.');
    expect(section).toContain('<details>');
  });

  it('is empty when nothing needs covering', () => {
    expect(renderTestPromptsSection(report(['src/full.ts']))).toBe('');
  });
});
