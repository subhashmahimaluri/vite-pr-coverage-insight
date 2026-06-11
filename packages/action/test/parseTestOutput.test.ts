import { describe, expect, it } from 'vitest';
import { parsePassingCounts, parseTestOutput } from '../src/parseTestOutput';

const VITEST_FAILURE = `
 ❯ src/components/ui/Tooltip.test.tsx (12 tests | 1 failed) 34ms
   × Tooltip > generates a stable id from the label

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/components/ui/Tooltip.test.tsx > Tooltip > generates a stable id from the label
AssertionError: expected 'tooltip-hello-world' to be 'tooltip-hello-world!' // Object.is equality

 Test Files  1 failed | 11 passed (12)
      Tests  1 failed | 205 passed (206)
   Start at  10:00:00
   Duration  2.41s
`;

const JEST_FAILURE = `
FAIL src/Button.test.js
  ● Button › renders the label

    expect(received).toBe(expected)

Tests:       2 failed, 48 passed, 50 total
Snapshots:   0 total
Time:        4.2 s
`;

const VITEST_THRESHOLD = `
 Test Files  12 passed (12)
      Tests  206 passed (206)

ERROR: Coverage for lines (87.3%) does not meet global threshold (90%)
ERROR: Coverage for statements (87.3%) does not meet global threshold (90%)
`;

describe('parseTestOutput', () => {
  it('vitest: recovers failed test name, file and counts', () => {
    const parsed = parseTestOutput(VITEST_FAILURE);
    expect(parsed.failures).toEqual({
      numFailedTests: 1,
      numTotalTests: 206,
      numPassedTests: 205,
      failedTests: [
        {
          testName: 'Tooltip > generates a stable id from the label',
          filePath: 'src/components/ui/Tooltip.test.tsx',
        },
      ],
    });
  });

  it('jest: recovers failed test bullets under the FAIL block and counts', () => {
    const parsed = parseTestOutput(JEST_FAILURE);
    expect(parsed.failures?.numFailedTests).toBe(2);
    expect(parsed.failures?.numTotalTests).toBe(50);
    expect(parsed.failures?.failedTests).toEqual([
      { testName: 'Button › renders the label', filePath: 'src/Button.test.js' },
    ]);
  });

  it("runner coverage thresholds are not test failures — they're reported separately", () => {
    const parsed = parseTestOutput(VITEST_THRESHOLD);
    expect(parsed.failures).toBeNull();
    expect(parsed.coverageThresholdErrors).toHaveLength(2);
    expect(parsed.coverageThresholdErrors[0]).toContain('lines (87.3%)');
  });

  it('strips ANSI color codes before matching', () => {
    const colored = VITEST_FAILURE.replace(/FAIL/g, '\x1b[31mFAIL\x1b[0m');
    expect(parseTestOutput(colored).failures?.numFailedTests).toBe(1);
  });

  it('unparseable output: no failures, tail keeps the last lines', () => {
    const parsed = parseTestOutput('something exploded\nstack trace here\n');
    expect(parsed.failures).toBeNull();
    expect(parsed.tail).toContain('stack trace here');
  });

  it('counts without parseable names yield a placeholder entry', () => {
    const parsed = parseTestOutput('Tests  3 failed | 10 passed (13)\n');
    expect(parsed.failures?.numFailedTests).toBe(3);
    expect(parsed.failures?.failedTests[0].testName).toContain('could not be parsed');
  });
});

describe('parsePassingCounts', () => {
  it('vitest passing summary', () => {
    expect(parsePassingCounts(' Tests  206 passed (206)\n')).toEqual({
      numFailedTests: 0,
      numTotalTests: 206,
      numPassedTests: 206,
      failedTests: [],
    });
  });

  it('jest passing summary', () => {
    expect(parsePassingCounts('Tests:       50 passed, 50 total\n')?.numPassedTests).toBe(50);
  });

  it('null when the run actually failed', () => {
    expect(parsePassingCounts(VITEST_FAILURE)).toBeNull();
  });

  it('null when nothing matches', () => {
    expect(parsePassingCounts('no summary here')).toBeNull();
  });
});
