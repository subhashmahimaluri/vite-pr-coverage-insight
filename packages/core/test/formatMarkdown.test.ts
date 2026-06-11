import { describe, expect, it } from 'vitest';
import { formatCoverageMarkdown } from '../src';
import type { FileCoverageResult } from '../src';
import { loadTestFailures, prInfo } from './helpers';

const summaryRows = [
  { metric: 'statements', base: 80, pr: 85, delta: 5, symbol: '⬆️' },
  { metric: 'branches', base: 70, pr: 65.5, delta: -4.5, symbol: '⬇️' },
];

function fileCoverage(uncoveredLines: number[]): FileCoverageResult {
  return {
    newFiles: [],
    modifiedFiles: [
      {
        file: '/app/src/math.ts',
        metrics: {
          branches: { base: 70, pr: 65.5, delta: -4.5, symbol: '⬇️' },
          functions: { base: 80, pr: 85, delta: 5, symbol: '⬆️' },
          lines: { base: 80, pr: 85, delta: 5, symbol: '⬆️' },
          statements: { base: 80, pr: 85, delta: 5, symbol: '⬆️' },
        },
        uncoveredLines,
      },
    ],
  };
}

describe('formatCoverageMarkdown', () => {
  it('formats the summary table with signed two-decimal deltas', () => {
    const md = formatCoverageMarkdown(summaryRows, []);

    expect(md).toContain('| statements | 80.00% | 85.00% | +5.00% ⬆️ |');
    expect(md).toContain('| branches | 70.00% | 65.50% | -4.50% ⬇️ |');
  });

  it('groups consecutive uncovered lines into ranges', () => {
    const md = formatCoverageMarkdown(summaryRows, [fileCoverage([3, 1, 2, 7, 10, 11])], prInfo);

    expect(md).toContain('[1-3, 7, 10-11]');
  });

  it('links uncovered lines to the PR files view when prInfo is given', () => {
    const md = formatCoverageMarkdown(summaryRows, [fileCoverage([5])], prInfo);

    expect(md).toContain('https://github.com/acme/demo/pull/42/files');
  });

  it('falls back to the file path link without prInfo', () => {
    const md = formatCoverageMarkdown(summaryRows, [fileCoverage([5])]);

    expect(md).toContain('[5](/app/src/math.ts)');
  });

  it('shows a dash when a file has no uncovered lines', () => {
    const md = formatCoverageMarkdown(summaryRows, [fileCoverage([])], prInfo);

    expect(md).toContain('| - |');
  });

  it('omits the breakdown section when there are no file changes', () => {
    const md = formatCoverageMarkdown(summaryRows, []);

    expect(md).not.toContain('File Coverage Breakdown');
  });

  it('renders new files with uncovered lines and PR links', () => {
    const coverage: FileCoverageResult = {
      newFiles: [
        {
          file: '/app/src/date.ts',
          metrics: { branches: 100, functions: 100, lines: 100, statements: 100 },
          uncoveredLines: [8, 9],
        },
      ],
      modifiedFiles: [],
    };

    const withPr = formatCoverageMarkdown(summaryRows, [coverage], prInfo);
    expect(withPr).toContain('🆕 Newly Added Files:');
    expect(withPr).toContain('[date.ts](https://github.com/acme/demo/pull/42/files)');
    expect(withPr).toContain('[8-9](https://github.com/acme/demo/pull/42/files)');

    const withoutPr = formatCoverageMarkdown(summaryRows, [coverage]);
    expect(withoutPr).toContain('[date.ts](/app/src/date.ts)');
    expect(withoutPr).toContain('[8-9](/app/src/date.ts)');
  });

  it('renders the failed tests section', () => {
    const md = formatCoverageMarkdown(summaryRows, [], prInfo, loadTestFailures());

    expect(md).toContain('❌ Failed Tests (2/48)');
    expect(md).toContain('| math.test.ts | should round half-up at the boundary |');
  });

  it('omits the failed tests section when everything passed', () => {
    const md = formatCoverageMarkdown(summaryRows, [], prInfo, {
      numFailedTests: 0,
      numTotalTests: 48,
      failedTests: [],
    });

    expect(md).not.toContain('Failed Tests');
  });

  it('appends the missing-data warning when coverageError is set', () => {
    const md = formatCoverageMarkdown(summaryRows, [], prInfo, null, true);

    expect(md).toContain('⚠️ **Warning:** Could not generate full coverage comparison');
  });
});
