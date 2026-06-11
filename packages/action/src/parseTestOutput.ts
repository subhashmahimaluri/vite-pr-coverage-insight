import type { TestFailure, TestFailuresResult } from '@coverage-insight/core';

/**
 * Best-effort parse of a test runner's *text* output (captured from the
 * run-script command) when no test-failures JSON file was provided. Supports
 * the failure summaries printed by vitest and jest. The goal is never a full
 * parse — just enough to name the failed tests in the PR comment instead of
 * "exited with code 1".
 */

export type ParsedTestOutput = {
  /** failed tests recovered from the output, or null when none were found */
  failures: TestFailuresResult | null;
  /** the runner's own coverage-threshold errors (vitest/istanbul/jest wording) */
  coverageThresholdErrors: string[];
  /** last few non-empty lines — generic excerpt when nothing else matched */
  tail: string;
};

const MAX_PARSED_FAILURES = 20;
const TAIL_LINES = 6;

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

/** vitest failure summary: `FAIL  src/foo.test.ts > Suite > test name` (optionally `|project|` prefixed) */
const VITEST_FAIL = /^\s*FAIL\s+(?:\|[^|]+\|\s+)?(\S+\.[cm]?[jt]sx?)\s+>\s+(.+?)\s*$/;
/** jest suite header: `FAIL src/foo.test.js` */
const JEST_FAIL = /^\s*FAIL\s+(\S+\.[cm]?[jt]sx?)\s*$/;
/** jest test bullet under a FAIL block: `  ● Suite › test name` */
const JEST_BULLET = /^\s*●\s+(.+?)\s*$/;
/** vitest: `Tests  2 failed | 204 passed (206)` */
const VITEST_COUNTS = /^\s*Tests\s+(\d+)\s+failed(?:\s*\|\s*(\d+)\s+passed)?[^(]*\((\d+)\)/;
/** jest: `Tests:       2 failed, 204 passed, 206 total` */
const JEST_COUNTS =
  /^\s*Tests:\s+(?:(\d+)\s+failed,\s*)?(?:\d+\s+skipped,\s*)?(\d+)\s+passed,\s+(\d+)\s+total/;
/** vitest/istanbul: `ERROR: Coverage for lines (87.3%) does not meet global threshold (90%)`
 *  jest: `Jest: "global" coverage threshold for lines (90%) not met: 87.3%` */
const THRESHOLD_ERROR = /coverage (?:for .+ does not meet|threshold for .+ not met)/i;

export function parseTestOutput(output: string): ParsedTestOutput {
  const lines = output.replace(ANSI, '').split(/\r?\n/);

  const failed: TestFailure[] = [];
  const seen = new Set<string>();
  const thresholdErrors: string[] = [];
  let counts: { failed: number; passed?: number; total: number } | null = null;
  let jestSuite: string | null = null;

  const add = (failure: TestFailure) => {
    const key = `${failure.filePath}::${failure.testName}`;
    if (seen.has(key)) return;
    seen.add(key);
    failed.push(failure);
  };

  for (const raw of lines) {
    const vitest = VITEST_FAIL.exec(raw);
    if (vitest) {
      add({ testName: vitest[2], filePath: vitest[1] });
      jestSuite = null;
      continue;
    }
    const jest = JEST_FAIL.exec(raw);
    if (jest) {
      jestSuite = jest[1];
      continue;
    }
    if (jestSuite) {
      const bullet = JEST_BULLET.exec(raw);
      if (bullet && !/^Console$/i.test(bullet[1])) {
        add({ testName: bullet[1], filePath: jestSuite });
        continue;
      }
    }
    const vitestCounts = VITEST_COUNTS.exec(raw);
    if (vitestCounts) {
      counts = {
        failed: Number(vitestCounts[1]),
        ...(vitestCounts[2] !== undefined ? { passed: Number(vitestCounts[2]) } : {}),
        total: Number(vitestCounts[3]),
      };
      continue;
    }
    const jestCounts = JEST_COUNTS.exec(raw);
    if (jestCounts) {
      counts = {
        failed: Number(jestCounts[1] ?? 0),
        passed: Number(jestCounts[2]),
        total: Number(jestCounts[3]),
      };
      continue;
    }
    if (THRESHOLD_ERROR.test(raw)) {
      thresholdErrors.push(raw.trim());
    }
  }

  const tail = lines
    .filter((l) => l.trim() !== '')
    .slice(-TAIL_LINES)
    .join('\n');

  const numFailed = counts?.failed ?? failed.length;
  let failures: TestFailuresResult | null = null;
  if (numFailed > 0) {
    failures = {
      numFailedTests: numFailed,
      numTotalTests: counts?.total ?? 0,
      ...(counts?.passed !== undefined ? { numPassedTests: counts.passed } : {}),
      failedTests:
        failed.length > 0
          ? failed.slice(0, MAX_PARSED_FAILURES)
          : [
              {
                testName: `${numFailed} failed test(s) — names could not be parsed from the output; see the CI log`,
                filePath: '(test run)',
              },
            ],
    };
  }

  return { failures, coverageThresholdErrors: thresholdErrors, tail };
}

/** counts for a passing run, so the comment can say "N tests passing" */
export function parsePassingCounts(output: string): TestFailuresResult | null {
  const parsed = parseTestOutput(output);
  if (parsed.failures) return null;
  const clean = output.replace(ANSI, '');
  const vitest = /^\s*Tests\s+(\d+)\s+passed\s*\((\d+)\)/m.exec(clean);
  if (vitest) {
    return {
      numFailedTests: 0,
      numTotalTests: Number(vitest[2]),
      numPassedTests: Number(vitest[1]),
      failedTests: [],
    };
  }
  const jest = /^\s*Tests:\s+(?:\d+\s+skipped,\s*)?(\d+)\s+passed,\s+(\d+)\s+total/m.exec(clean);
  if (jest) {
    return {
      numFailedTests: 0,
      numTotalTests: Number(jest[2]),
      numPassedTests: Number(jest[1]),
      failedTests: [],
    };
  }
  return null;
}
