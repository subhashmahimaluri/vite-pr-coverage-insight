import { z } from 'zod';

/**
 * coverage-report.json — schemaVersion 1 (decision D6).
 * The single integration surface: reporters, agents, and skills consume only
 * this, never raw coverage files. Emitted in EVERY state, including errors.
 */

export const REPORT_SCHEMA_VERSION = 1;

export const reportStateSchema = z.enum([
  'passed', // 1: gate met, tests pass
  'threshold-failed', // 2: metric below threshold
  'tests-failed', // 3: failed suites in input
  'regression', // 4: a file decreased
  'no-baseline', // 5: first run / unresolvable baseline
  'invalid-data', // 6: missing/corrupt input
  'no-change', // 7: zero coverage delta
  'monorepo', // 8: multiple projects
]);
export type ReportState = z.infer<typeof reportStateSchema>;

export const metricKeySchema = z.enum(['statements', 'branches', 'functions', 'lines']);

export const metricValueSchema = z.object({
  pct: z.number(),
  total: z.number(),
  covered: z.number(),
  skipped: z.number(),
});

export const metricDeltaSchema = z.object({
  base: z.number().nullable(), // null when no baseline
  head: z.number(),
  delta: z.number().nullable(),
  /** head counts — power "N uncovered" and shortest-path-to-green math */
  covered: z.number().int().optional(),
  total: z.number().int().optional(),
});

export const fileReportSchema = z.object({
  path: z.string(),
  /** 'new' | 'modified' | 'unchanged' relative to baseline */
  change: z.enum(['new', 'modified', 'unchanged']),
  /** true when the file is part of the PR's git diff (set when known) */
  touched: z.boolean().optional(),
  metrics: z.record(metricKeySchema, metricDeltaSchema),
  uncoveredRanges: z.array(z.object({ start: z.number().int(), end: z.number().int() })).optional(),
});

export const policyViolationSchema = z.object({
  rule: z.enum(['threshold', 'override-threshold', 'ratchet-total', 'ratchet-file']),
  metric: metricKeySchema,
  scope: z.string(),
  required: z.number(),
  actual: z.number(),
  gap: z.number(),
});

export const policyResultSchema = z.object({
  verdict: z.enum(['pass', 'warn', 'fail']),
  violations: z.array(policyViolationSchema),
});

export const testFailuresSchema = z.object({
  numFailedTests: z.number().int(),
  numTotalTests: z.number().int(),
  failedTests: z.array(
    z.object({
      testName: z.string(),
      filePath: z.string(),
      /** error excerpt, truncated by the renderer */
      message: z.string().optional(),
    })
  ),
});

export const baselineMetaSchema = z.object({
  /** main-branch SHA the baseline was produced from */
  sha: z.string(),
  ref: z.string().optional(),
  timestamp: z.string().optional(),
  /** how it was found */
  source: z.enum(['input', 'cache', 'branch', 'ancestor']),
  /** commits between merge-base and the baseline commit (0 = exact) */
  staleness: z.number().int().min(0).default(0),
});

export const projectReportSchema = z.object({
  name: z.string(),
  state: reportStateSchema,
  totals: z.record(metricKeySchema, metricDeltaSchema),
  files: z.array(fileReportSchema),
  policy: policyResultSchema,
});

export const inputErrorSchema = z.object({
  input: z.string(), // which input (base / head / test-failures / config)
  message: z.string(), // what was wrong
  hint: z.string().optional(), // how to fix
});

export const coverageReportSchema = z.object({
  schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
  generatedAt: z.string(),
  state: reportStateSchema,
  repo: z.object({ owner: z.string(), repo: z.string() }).optional(),
  pr: z.object({ number: z.number().int(), headSha: z.string().optional() }).optional(),
  totals: z.record(metricKeySchema, metricDeltaSchema).optional(),
  files: z.array(fileReportSchema).optional(),
  policy: policyResultSchema.optional(),
  testFailures: testFailuresSchema.nullable().optional(),
  baseline: baselineMetaSchema.nullable().optional(),
  projects: z.array(projectReportSchema).optional(), // state 8 only
  errors: z.array(inputErrorSchema).optional(), // state 6
  /** policy context for the header line (description + config source + thresholds) */
  policyMeta: z
    .object({
      description: z.string(),
      source: z.string().optional(),
      thresholds: z.partialRecord(metricKeySchema, z.number()).optional(),
    })
    .optional(),
  /** history series for sparklines, newest last */
  history: z
    .array(
      z.object({
        sha: z.string(),
        timestamp: z.string().optional(),
        lines: z.number(),
        statements: z.number().optional(),
        functions: z.number().optional(),
        branches: z.number().optional(),
      })
    )
    .optional(),
  ai: z
    .object({
      enabled: z.boolean(),
      skippedReason: z.string().optional(),
    })
    .optional(),
});

export type CoverageReport = z.infer<typeof coverageReportSchema>;
export type FileReport = z.infer<typeof fileReportSchema>;
export type MetricDelta = z.infer<typeof metricDeltaSchema>;
export type BaselineMeta = z.infer<typeof baselineMetaSchema>;
export type ProjectReport = z.infer<typeof projectReportSchema>;
