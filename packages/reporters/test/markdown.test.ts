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

  it('tests-failed: merge-blocked alert, named failures, PR-only coverage', () => {
    const md = renderMarkdown(
      report({
        testFailures: {
          numFailedTests: 1,
          numTotalTests: 5,
          failedTests: [{ testName: 'boom', filePath: 'src/a.test.ts' }],
        },
      }),
      {
        visuals: 'images',
        badgeImages: { light: 'https://raw.test/l.svg', dark: 'https://raw.test/d.svg' },
      }
    );
    expect(md).toContain('🛑 Tests failed');
    expect(md).toContain('[!CAUTION]');
    expect(md).toContain('cannot merge');
    expect(md).toContain('boom');
    expect(md).toContain('src/a.test.ts');
    // no failed·passed·total line — the per-suite spoilers carry the counts
    expect(md).not.toContain('passed ·');
    // base-branch visuals are hidden: only this PR's own numbers
    expect(md).not.toContain('<picture>');
    expect(md).not.toContain('mermaid');
    expect(md).toContain("Coverage below is from this PR's failed run");
    expect(md).toMatchSnapshot();
  });

  it('tests-failed with a broken head input: failures headline + error, no zeroed totals', () => {
    const md = renderMarkdown(
      report({
        head: model([]),
        testFailures: {
          numFailedTests: 2,
          numTotalTests: 0,
          failedTests: [{ testName: 'boom', filePath: 'src/a.test.ts' }],
        },
        errors: [
          {
            input: 'head',
            message: 'ENOENT: no such file',
            hint: 'enable coverage.reportOnFailure',
          },
        ],
      })
    );
    expect(md).toContain('🛑 Tests failed');
    expect(md).toContain('boom');
    expect(md).toContain('ENOENT');
    expect(md).not.toContain("Coverage below is from this PR's failed run");
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
    expect(md).toContain('<summary>📋 Full coverage table (2)</summary>');
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
    expect(md).toContain('✏️ Files changed in this PR');
    const table = md.split('✏️ Files changed in this PR')[1].split('</details>')[0];
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

  it('warnings render as a banner without changing the state', () => {
    const md = renderMarkdown(
      report({ warnings: ["The test runner's own coverage thresholds are not met: lines 87.2%"] })
    );
    expect(md).toContain('✅ Coverage gate passed');
    expect(md).toContain('[!WARNING]');
    expect(md).toContain('thresholds are not met');
  });

  it('warnings survive the minimal no-change comment', () => {
    const md = renderMarkdown(report({ head: base, warnings: ['exited 1 but tests passed'] }));
    expect(md).toContain('✅ Coverage unchanged');
    expect(md).toContain('[!WARNING]');
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
    const md = renderMarkdown(
      report({
        head: model(files),
        base: model(files.slice(1)),
        touchedFiles: files.map((f) => f.path),
      }),
      {
        htmlReportUrl: 'https://example.com/report',
        maxChars: 20000,
      }
    );
    expect(md.length).toBeLessThanOrEqual(20000);
    const firstContent = md.split('\n').find((l, i) => i > 0 && l.trim() !== '')!;
    expect(firstContent).toMatch(/Coverage|regression/);
    expect(md).toContain('truncated');
    expect(md).toContain('https://example.com/report');
  });
});

describe('visuals modes', () => {
  it('images: <picture> with light/dark variants, plus mermaid', () => {
    const md = renderMarkdown(
      report({
        history: [
          { sha: 'a1', lines: 80 },
          { sha: 'b2', lines: 85 },
          { sha: 'c3', lines: 90 },
        ],
      }),
      {
        visuals: 'images',
        badgeImages: { light: 'https://raw.test/l.svg', dark: 'https://raw.test/d.svg' },
      }
    );
    expect(md).toContain('<picture>');
    expect(md).toContain('prefers-color-scheme: dark');
    expect(md).toContain('https://raw.test/l.svg');
    expect(md).toContain('```mermaid');
    // graphs are the only visible coverage block — tables collapse into one
    // spoiler with the PR report first, then the base branch
    expect(md).toContain('<summary>📊 Coverage report — this PR vs base branch</summary>');
    const spoiler = md.split('📊 Coverage report')[1].split('</details>')[0];
    expect(spoiler.indexOf('**Current PR**')).toBeLessThan(spoiler.indexOf('**Base branch**'));
    // files-changed and the trend chart are collapsed too
    expect(md).toMatch(/<summary>✏️ Changed files/);
    expect(md).toMatch(/<summary>📈 Coverage trend/);
    expect(md).toMatchSnapshot();
  });

  it('no badge images: open totals table, no picture, no inline-card duplication', () => {
    const md = renderMarkdown(
      report({
        history: [
          { sha: 'a1', lines: 80 },
          { sha: 'b2', lines: 85 },
        ],
      })
      // no visuals/badgeImages — e.g. text mode or no history
    );
    expect(md).not.toContain('<picture>');
    // without the band the PR totals table stays open (it IS the summary)
    expect(md).toContain('| St. | Category | Percentage | Covered / Total |');
    expect(md).not.toContain('📊 Coverage report — this PR vs base branch');
  });

  it('images without badgeImages: PR-true shields cards, never base values', () => {
    const md = renderMarkdown(
      report({
        history: [
          { sha: 'a1', lines: 80 },
          { sha: 'b2', lines: 85 },
        ],
      }),
      { visuals: 'images' } // no badgeImages — e.g. missing contents: write
    );
    expect(md).not.toContain('<picture>');
    // card layout: 4 cells, each ONE badge (value + delta) in band-palette hex
    expect(md).toContain('<table><tr>');
    expect(md.match(/<td align="center">/g)).toHaveLength(4);
    expect(md).toContain('<h3>STATEMENTS</h3>');
    expect(md).toContain('<sub><i>'); // counts: small + italic, visually muted
    expect(md).toContain(encodeURIComponent('90.0%')); // head value, not 80% base
    expect(md).toContain(encodeURIComponent('▲')); // delta inside the same badge
    expect(md).toContain('-1a7f37?style=for-the-badge'); // deep green, not neon
    expect(md).toContain('grant `contents: write`');
    // detailed tables still collapse behind the spoiler
    expect(md).toContain('<summary>📊 Coverage report — this PR vs base branch</summary>');
  });

  it('mermaid: chart but no picture (private-repo auto fallback)', () => {
    const md = renderMarkdown(
      report({
        history: [
          { sha: 'a1', lines: 80 },
          { sha: 'b2', lines: 85 },
        ],
      }),
      { visuals: 'mermaid' }
    );
    expect(md).not.toContain('<picture>');
    expect(md).toContain('xychart-beta');
  });

  it('text: no mermaid, no picture — plain tables only', () => {
    const md = renderMarkdown(
      report({
        history: [
          { sha: 'a1', lines: 80 },
          { sha: 'b2', lines: 85 },
        ],
      }),
      { visuals: 'text' }
    );
    expect(md).not.toContain('<picture>');
    expect(md).not.toContain('mermaid');
  });
});
