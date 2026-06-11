import { describe, expect, it } from 'vitest';
import { buildReport, renderHtml } from '../src/index';
import { GENERATED_AT, baselineMeta, failPolicy, model, passPolicy } from './helpers';

function report(overrides: Partial<Parameters<typeof buildReport>[0]> = {}) {
  return buildReport({
    head: model([{ path: 'src/a.ts', covered: 9, total: 10, uncoveredLines: [4, 5, 9] }]),
    base: model([{ path: 'src/a.ts', covered: 8, total: 10 }]),
    policy: passPolicy,
    baseline: baselineMeta,
    repo: { owner: 'acme', repo: 'demo' },
    generatedAt: GENERATED_AT,
    history: [
      { sha: 'aaaaaaa1', lines: 80 },
      { sha: 'bbbbbbb2', lines: 85 },
      { sha: 'ccccccc3', lines: 90 },
    ],
    ...overrides,
  });
}

describe('renderHtml air-gap safety', () => {
  it('makes zero external requests: no http(s) URLs, CSP meta present', () => {
    const html = renderHtml(report());
    expect(html).not.toContain('http://');
    expect(html).not.toContain('https://');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("default-src 'none'");
  });

  it('opens from file://: doctype, no external link/script tags', () => {
    const html = renderHtml(report());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toContain('<link rel=');
    expect(html).not.toContain('<script src=');
  });

  it('escapes </script> in embedded data', () => {
    const html = renderHtml(
      report({ head: model([{ path: '</script>x.ts', covered: 1, total: 1 }]) })
    );
    expect(html).toContain('<\\/script>');
    const island = html.split('id="report-data">')[1].split('</script>')[0];
    expect(island).not.toContain('</script>');
  });
});

describe('renderHtml content', () => {
  it('renders verdict, trend, treemap and file table', () => {
    const html = renderHtml(report());
    expect(html).toContain('✅ Coverage gate passed');
    expect(html).toContain('Line coverage trend');
    expect(html).toContain('class="treemap"');
    expect(html).toContain('id="files"');
    expect(html).toContain('4–5, 9'); // uncovered ranges
  });

  it('draws the threshold line when policy has a lines threshold', () => {
    const html = renderHtml(report({ policy: failPolicy }));
    expect(html).toContain('threshold 90%');
    expect(html).toContain('❌ Coverage gate failed');
  });

  it('is deterministic', () => {
    expect(renderHtml(report())).toBe(renderHtml(report()));
  });

  it('keeps a 500-file report under 1.5MB', () => {
    const files = Array.from({ length: 500 }, (_, i) => ({
      path: `src/dir-${i % 12}/component-${i}.tsx`,
      covered: 40 + (i % 60),
      total: 100,
      uncoveredLines: [i + 1, i + 3],
    }));
    const html = renderHtml(report({ head: model(files), base: null, baseline: null }));
    expect(html.length).toBeLessThan(1.5 * 1024 * 1024);
  });
});
