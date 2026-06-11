import { describe, expect, it } from 'vitest';
import { COMMENT_MARKER, buildReport, renderMarkdown } from '../src/index';
import { GENERATED_AT, baselineMeta, failPolicy, model, passPolicy } from './helpers';

const base = model([{ path: 'src/a.ts', covered: 8, total: 10 }]);

function report(overrides: Partial<Parameters<typeof buildReport>[0]> = {}) {
  return buildReport({
    head: model([{ path: 'src/a.ts', covered: 9, total: 10, uncoveredLines: [4] }]),
    base,
    policy: passPolicy,
    baseline: baselineMeta,
    repo: { owner: 'acme', repo: 'demo' },
    pr: { number: 42 },
    generatedAt: GENERATED_AT,
    ...overrides,
  });
}

describe('renderMarkdown states', () => {
  it('passed: verdict first line after the D5 marker', () => {
    const md = renderMarkdown(report());
    const lines = md.split('\n');
    expect(lines[0]).toBe(COMMENT_MARKER);
    const firstContent = lines.find((l, i) => i > 0 && l.trim() !== '')!;
    expect(firstContent).toContain('✅ Coverage gate passed');
    expect(md).toMatchSnapshot();
  });

  it('threshold-failed: compliance table and shortest path to green', () => {
    const md = renderMarkdown(report({ policy: failPolicy }));
    expect(md).toContain('❌ Coverage gate failed');
    expect(md).toContain('Shortest path to green');
    expect(md).toContain('90'); // required threshold shown next to actual
    expect(md).toMatchSnapshot();
  });

  it('tests-failed: failures first, coverage marked partial', () => {
    const md = renderMarkdown(
      report({
        testFailures: {
          numFailedTests: 1,
          numTotalTests: 5,
          failedTests: [{ testName: 'boom', filePath: 'src/a.test.ts' }],
        },
      })
    );
    expect(md).toContain('🛑 Tests failed');
    expect(md.indexOf('boom')).toBeLessThan(md.indexOf('partial'));
    expect(md).toMatchSnapshot();
  });

  it('regression: severity badges', () => {
    const md = renderMarkdown(
      report({ head: model([{ path: 'src/a.ts', covered: 2, total: 10 }]) })
    );
    expect(md).toContain('🔻 Coverage regression');
    expect(md).toContain('🔴'); // 60pp drop is critical
    expect(md).toMatchSnapshot();
  });

  it('no-baseline: absolute numbers only', () => {
    const md = renderMarkdown(report({ base: null, baseline: null }));
    expect(md).toContain('ℹ️ Baseline recorded');
    expect(md).not.toContain('∆');
    expect(md).toMatchSnapshot();
  });

  it('no-baseline without diff info: no all-new dump, full table stays collapsed', () => {
    const md = renderMarkdown(
      report({
        head: model([
          { path: 'src/a.ts', covered: 9, total: 10 },
          { path: 'src/b.ts', covered: 5, total: 10 },
        ]),
        base: null,
        baseline: null,
      })
    );
    expect(md).not.toContain('### Changed files');
    expect(md).not.toContain('Files changed in this PR');
    expect(md).toContain('<summary>Full coverage table — 2 files</summary>');
  });

  it('changed-files table follows the PR diff when touched info exists', () => {
    const md = renderMarkdown(
      report({
        head: model([
          { path: 'src/a.ts', covered: 9, total: 10 },
          { path: 'src/untouched.ts', covered: 5, total: 10 },
        ]),
        base: null,
        baseline: null,
        touchedFiles: ['src/a.ts'],
      })
    );
    expect(md).toContain('### Files changed in this PR');
    const table = md.split('### Files changed in this PR')[1].split('<details>')[0];
    expect(table).toContain('src/a.ts');
    expect(table).not.toContain('src/untouched.ts');
    // the Change column is meaningless without a baseline
    expect(table).not.toContain('| new |');
  });

  it('invalid-data: input, problem and fix', () => {
    const md = renderMarkdown(
      report({
        errors: [{ input: 'head', message: 'corrupt JSON', hint: 'check the artifact path' }],
      })
    );
    expect(md).toContain('⚠️ Coverage report error');
    expect(md).toContain('head');
    expect(md).toContain('corrupt JSON');
    expect(md).toContain('check the artifact path');
    expect(md).toMatchSnapshot();
  });

  it('no-change: single-line minimal comment', () => {
    const md = renderMarkdown(report({ head: base }));
    expect(md.split('\n')).toHaveLength(2); // marker + verdict
    expect(md).toMatchSnapshot();
  });

  it('monorepo: per-project verdict rows', () => {
    const inner = report();
    const md = renderMarkdown(
      report({
        projects: [
          { name: 'pkg-a', state: 'passed', totals: inner.totals!, files: [], policy: passPolicy },
          {
            name: 'pkg-b',
            state: 'threshold-failed',
            totals: inner.totals!,
            files: [],
            policy: failPolicy,
          },
        ],
      })
    );
    expect(md).toContain('📦 Monorepo coverage');
    expect(md).toContain('pkg-a');
    expect(md).toContain('pkg-b');
    expect(md).toMatchSnapshot();
  });
});

describe('renderMarkdown cross-state rules', () => {
  it('marker present in every state', () => {
    for (const md of [
      renderMarkdown(report()),
      renderMarkdown(report({ policy: failPolicy })),
      renderMarkdown(report({ base: null, baseline: null })),
      renderMarkdown(report({ head: base })),
    ]) {
      expect(md.startsWith(COMMENT_MARKER)).toBe(true);
    }
  });

  it('staleness note appears when the baseline is behind', () => {
    const md = renderMarkdown(report({ baseline: { ...baselineMeta, staleness: 3 } }));
    expect(md).toContain('3 commits behind');
  });

  it('truncates a 500-file report under the limit, keeping the verdict', () => {
    const files = Array.from({ length: 500 }, (_, i) => ({
      path: `src/dir-${i % 20}/file-${i}.ts`,
      covered: 50 + (i % 50),
      total: 100,
      uncoveredLines: [i + 1, i + 2, i + 5],
    }));
    const md = renderMarkdown(report({ head: model(files), base: model(files.slice(1)) }), {
      htmlReportUrl: 'https://example.com/report',
      maxChars: 20000,
    });
    expect(md.length).toBeLessThanOrEqual(20000);
    const firstContent = md.split('\n').find((l, i) => i > 0 && l.trim() !== '')!;
    expect(firstContent).toMatch(/Coverage|regression/);
    expect(md).toContain('truncated');
    expect(md).toContain('https://example.com/report');
  });
});
