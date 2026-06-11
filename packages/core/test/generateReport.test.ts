import { describe, expect, it } from 'vitest';
import { generateCoverageReport } from '../src';
import { loadFixturePair, loadTestFailures, prInfo } from './helpers';

const scenarios = ['improvement', 'regression', 'new-file', 'deleted-file', 'identical'] as const;

describe('generateCoverageReport', () => {
  for (const scenario of scenarios) {
    it(`matches snapshot for ${scenario}`, () => {
      const { base, head } = loadFixturePair(scenario);
      expect(generateCoverageReport(base, head, null, prInfo)).toMatchSnapshot();
    });

    it(`matches snapshot for ${scenario} with test failures`, () => {
      const { base, head } = loadFixturePair(scenario);
      expect(generateCoverageReport(base, head, loadTestFailures(), prInfo)).toMatchSnapshot();
    });
  }

  it('renders a warning instead of crashing when head coverage is missing', () => {
    const { base } = loadFixturePair('improvement');
    const report = generateCoverageReport(base, null, null, prInfo);

    expect(report).toContain('⚠️ **Warning:**');
    expect(report).toContain('75.00%');
  });

  it('renders a warning instead of crashing when both summaries are missing', () => {
    const report = generateCoverageReport(null, null, null, prInfo);

    expect(report).toContain('⚠️ **Warning:**');
  });

  it('keeps the error notice when coverageError is forced', () => {
    const { base, head } = loadFixturePair('identical');
    const report = generateCoverageReport(base, head, null, prInfo, true);

    expect(report).toContain('⚠️ **Warning:**');
  });
});
