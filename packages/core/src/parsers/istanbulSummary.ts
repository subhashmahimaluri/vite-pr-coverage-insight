import { summaryToModel } from '../model';
import type { CoverageModel } from '../model';
import type { CoverageMetric, CoverageSummary } from '../types';
import type { CoverageParser } from './types';

type LineDetail = { line: number; covered: boolean };

/**
 * Parser for istanbul's `coverage-summary.json` (the `json-summary` reporter,
 * the v1 input format of this action).
 *
 * Detection: a JSON object whose `total.lines.pct` exists — the signature
 * shape of a summary file (a v8/istanbul `coverage-final.json` has no `total`
 * roll-up entry).
 *
 * pct handling: istanbul's own numbers are kept verbatim. For empty
 * aggregates istanbul can emit the literal string `"Unknown"` as pct; those
 * are coerced to 0.
 */
export const istanbulSummaryParser: CoverageParser = {
  name: 'istanbul-summary',

  detect(content: string): boolean {
    const data = tryParseJson(content);
    if (!isRecord(data)) return false;
    const total = data.total;
    if (!isRecord(total)) return false;
    const lines = total.lines;
    return isRecord(lines) && 'pct' in lines;
  },

  parse(content: string): CoverageModel {
    const data: unknown = JSON.parse(content);
    if (!isRecord(data) || !isRecord(data.total)) {
      throw new Error('istanbul-summary: expected a JSON object with a "total" entry');
    }

    const summary = {} as CoverageSummary;
    for (const [key, entry] of Object.entries(data)) {
      if (!isRecord(entry)) continue;
      summary[key] = {
        lines: toLinesMetric(entry.lines),
        statements: toMetric(entry.statements),
        functions: toMetric(entry.functions),
        branches: toMetric(entry.branches),
      };
    }
    return summaryToModel(summary);
  },
};

function toMetric(value: unknown): CoverageMetric {
  const rec = isRecord(value) ? value : {};
  return {
    // istanbul emits the string 'Unknown' for pct of empty aggregates → 0.
    pct: typeof rec.pct === 'number' ? rec.pct : 0,
    total: typeof rec.total === 'number' ? rec.total : 0,
    covered: typeof rec.covered === 'number' ? rec.covered : 0,
    skipped: typeof rec.skipped === 'number' ? rec.skipped : 0,
  };
}

function toLinesMetric(value: unknown): CoverageMetric & { details?: LineDetail[] } {
  const metric = toMetric(value);
  if (isRecord(value) && Array.isArray(value.details)) {
    const details = value.details.filter(
      (d: unknown): d is LineDetail =>
        isRecord(d) && typeof d.line === 'number' && typeof d.covered === 'boolean'
    );
    return { ...metric, details };
  }
  return metric;
}

function tryParseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
