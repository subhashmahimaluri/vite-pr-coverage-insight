// src/utils/parseTestFailures.ts
import fs from 'fs';

/**
 * Represents a single test failure
 */
export type TestFailure = {
  testName: string;
  filePath: string;
};

/**
 * Represents the result of parsing test failures
 */
export type TestFailuresResult = {
  numFailedTests: number;
  numTotalTests: number;
  failedTests: TestFailure[];
};

/**
 * Parses a test failures JSON file
 * 
 * @param filePath Path to the test failures JSON file
 * @returns Parsed test failures or null if file doesn't exist or is invalid
 */
export function parseTestFailures(filePath: string): TestFailuresResult | null {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(fileContent) as TestFailuresResult;
  } catch (error) {
    console.warn(`Warning: Could not parse test failures file: ${error}`);
    return null;
  }
}