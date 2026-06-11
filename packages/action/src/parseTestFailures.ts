import fs from 'fs';
import type { TestFailure, TestFailuresResult } from '@coverage-insight/core';

type VitestAssertionResult = {
  status: string;
  fullName?: string;
  ancestorTitles?: string[];
  title?: string;
  failureMessages?: string[];
};

type VitestTestResult = {
  name: string;
  status: string;
  assertionResults?: VitestAssertionResult[];
};

type VitestJsonReport = {
  numFailedTests: number;
  numTotalTests: number;
  numPassedTests?: number;
  numFailedTestSuites?: number;
  numTotalTestSuites?: number;
  testResults: VitestTestResult[];
};

function fromVitestJson(raw: VitestJsonReport): TestFailuresResult {
  const failedTests: TestFailure[] = [];
  for (const suite of raw.testResults) {
    for (const test of suite.assertionResults ?? []) {
      if (test.status !== 'failed') continue;
      const testName =
        test.fullName ??
        [...(test.ancestorTitles ?? []), test.title ?? ''].filter(Boolean).join(' > ');
      failedTests.push({
        testName,
        filePath: suite.name,
        message: test.failureMessages?.join('\n').slice(0, 2000),
      });
    }
  }
  return {
    numFailedTests: raw.numFailedTests,
    numTotalTests: raw.numTotalTests,
    numPassedTests: raw.numPassedTests,
    numTotalSuites: raw.numTotalTestSuites,
    numFailedSuites: raw.numFailedTestSuites,
    failedTests,
  };
}

export function parseTestFailures(filePath: string): TestFailuresResult | null {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(fileContent) as Record<string, unknown>;
    // vitest / jest JSON reporter — has a testResults array
    if (Array.isArray(parsed.testResults)) {
      return fromVitestJson(parsed as unknown as VitestJsonReport);
    }
    // action's own compact format — has a failedTests array
    return parsed as unknown as TestFailuresResult;
  } catch (error) {
    console.warn(`Warning: Could not parse test failures file: ${error}`);
    return null;
  }
}
