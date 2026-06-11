import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, coverageReportSchema } from '@coverage-insight/core';
import {
  aggregateVerdict,
  buildProjectReports,
  buildReport,
  renderMarkdown,
  sliceModelByPathPrefix,
} from '../src/index';
import { GENERATED_AT, model } from './helpers';

// the 2-package fixture monorepo: pkg-a healthy, pkg-b under-covered
const repoHead = model([
  { path: 'packages/a/src/x.ts', covered: 95, total: 100 },
  { path: 'packages/b/src/y.ts', covered: 50, total: 100 },
]);
const repoBase = model([
  { path: 'packages/a/src/x.ts', covered: 90, total: 100 },
  { path: 'packages/b/src/y.ts', covered: 50, total: 100 },
]);

const projects = [
  {
    name: 'pkg-a',
    path: 'packages/a',
    head: sliceModelByPathPrefix(repoHead, 'packages/a'),
    thresholds: { lines: 90 },
  },
  {
    name: 'pkg-b',
    path: 'packages/b',
    head: sliceModelByPathPrefix(repoHead, 'packages/b'),
    thresholds: { lines: 80 },
  },
];

describe('monorepo projects (Stage 6.3)', () => {
  it('slices the repo model by path prefix and recomputes totals', () => {
    const slice = sliceModelByPathPrefix(repoHead, 'packages/a');
    expect(slice.files).toHaveLength(1);
    expect(slice.total.lines.pct).toBe(95);
  });

  it('gates projects independently with per-project thresholds', () => {
    const reports = buildProjectReports(projects, DEFAULT_CONFIG, repoBase);

    const a = reports.find((p) => p.name === 'pkg-a')!;
    const b = reports.find((p) => p.name === 'pkg-b')!;
    expect(a.policy.verdict).toBe('pass');
    expect(b.policy.verdict).toBe('fail'); // 50% < 80% threshold
    expect(b.policy.violations[0]).toMatchObject({ metric: 'lines', required: 80, actual: 50 });
  });

  it('aggregates to the worst verdict', () => {
    const reports = buildProjectReports(projects, DEFAULT_CONFIG, repoBase);
    expect(aggregateVerdict(reports)).toBe('fail');
  });

  it('produces one schema-valid state-8 report with two verdict rows', () => {
    const projectReports = buildProjectReports(projects, DEFAULT_CONFIG, repoBase);
    const report = buildReport({
      head: repoHead,
      base: repoBase,
      projects: projectReports,
      generatedAt: GENERATED_AT,
    });

    expect(report.state).toBe('monorepo');
    expect(() => coverageReportSchema.parse(report)).not.toThrow();

    const md = renderMarkdown(report);
    expect(md).toContain('pkg-a');
    expect(md).toContain('pkg-b');
  });
});
