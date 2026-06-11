import {
  relativizePath,
  type CoverageReport,
  type TestFailuresResult,
} from '@coverage-insight/core';

/**
 * Stage 7.4 — PR diff annotations. Uncovered ranges in files touched by the
 * PR become warning annotations in the Files-changed view; failed tests
 * become failure annotations on their test file. Published through the check
 * run API: max 50 annotations per request (GitHub limit), capped at 200.
 */

export type Annotation = {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'warning' | 'failure' | 'notice';
  message: string;
  title?: string;
};

export type AnnotationsMode = 'all' | 'coverage' | 'failed-tests' | 'none';

export const MAX_ANNOTATIONS = 200;
export const ANNOTATIONS_PER_REQUEST = 50;

export function buildCoverageAnnotations(report: CoverageReport): Annotation[] {
  const annotations: Annotation[] = [];
  for (const file of report.files ?? []) {
    // only annotate files the PR actually touched (fall back to changed-vs-baseline)
    const touched = file.touched ?? file.change !== 'unchanged';
    if (!touched || !file.uncoveredRanges?.length) continue;
    for (const range of file.uncoveredRanges) {
      annotations.push({
        path: file.path,
        start_line: range.start,
        end_line: range.end,
        annotation_level: 'warning',
        title: 'Uncovered code',
        message:
          range.start === range.end
            ? 'This line is not covered by tests.'
            : `Lines ${range.start}–${range.end} are not covered by tests.`,
      });
    }
  }
  return annotations;
}

export function buildFailedTestAnnotations(
  failures: TestFailuresResult | null,
  workspace: string
): Annotation[] {
  if (!failures || failures.numFailedTests === 0) return [];
  return failures.failedTests.map((test) => ({
    path: relativizePath(test.filePath, workspace),
    start_line: 1,
    end_line: 1,
    annotation_level: 'failure' as const,
    title: 'Failed test',
    message: test.message ? `${test.testName}\n\n${test.message}` : test.testName,
  }));
}

export function collectAnnotations(params: {
  mode: AnnotationsMode;
  report: CoverageReport;
  testFailures: TestFailuresResult | null;
  workspace: string;
}): Annotation[] {
  if (params.mode === 'none') return [];
  const annotations: Annotation[] = [];
  if (params.mode === 'all' || params.mode === 'failed-tests') {
    annotations.push(...buildFailedTestAnnotations(params.testFailures, params.workspace));
  }
  if (params.mode === 'all' || params.mode === 'coverage') {
    annotations.push(...buildCoverageAnnotations(params.report));
  }
  // failures first, then coverage — the cap drops the least urgent
  return annotations.slice(0, MAX_ANNOTATIONS);
}

export function chunkAnnotations(annotations: Annotation[]): Annotation[][] {
  const chunks: Annotation[][] = [];
  for (let i = 0; i < annotations.length; i += ANNOTATIONS_PER_REQUEST) {
    chunks.push(annotations.slice(i, i + ANNOTATIONS_PER_REQUEST));
  }
  return chunks;
}
