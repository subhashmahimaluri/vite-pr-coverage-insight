export type CoverageMetric = {
  pct: number;
  total: number;
  covered: number;
  skipped: number;
};

export type CoverageSummary = {
  total: {
    lines: CoverageMetric;
    statements: CoverageMetric;
    functions: CoverageMetric;
    branches: CoverageMetric;
  };
  [key: string]: {
    lines: CoverageMetric & { details?: { line: number; covered: boolean }[] };
    statements: CoverageMetric;
    functions: CoverageMetric;
    branches: CoverageMetric;
  };
};

export type FileCoverageResult = {
  newFiles: {
    file: string;
    metrics: {
      branches: number;
      functions: number;
      lines: number;
      statements: number;
    };
    uncoveredLines: number[];
  }[];
  modifiedFiles: {
    file: string;
    metrics: {
      branches: { base: number; pr: number; delta: number; symbol: string };
      functions: { base: number; pr: number; delta: number; symbol: string };
      lines: { base: number; pr: number; delta: number; symbol: string };
      statements: { base: number; pr: number; delta: number; symbol: string };
    };
    uncoveredLines: number[];
  }[];
};

export type TestFailure = {
  testName: string;
  filePath: string;
  /** optional error excerpt shown in the failed-suites section */
  message?: string;
};

export type TestFailuresResult = {
  numFailedTests: number;
  numTotalTests: number;
  numPassedTests?: number;
  numTotalSuites?: number;
  numFailedSuites?: number;
  failedTests: TestFailure[];
};

export type PrInfo = {
  owner: string;
  repo: string;
  prNumber: number;
};
