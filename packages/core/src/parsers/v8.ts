import type { CoverageMetric, CoverageModel, FileCoverage, MetricKey } from '../model';
import type { CoverageParser } from './types';

/**
 * Parser for `coverage-final.json` as produced by c8 and istanbul/nyc
 * (reporter `json`): a JSON object keyed by file path where each value is an
 * istanbul FileCoverage object (`statementMap`/`s`, `fnMap`/`f`,
 * `branchMap`/`b`). c8 emits the same istanbul shape; values wrapped in a
 * `{ data: … }` envelope (istanbul-lib-coverage serialization) are unwrapped.
 *
 * Per-file derivation:
 * - statements: count of `s` entries with execution count > 0
 * - functions:  count of `f` entries with execution count > 0
 * - branches:   every location of every `b` array counts individually
 * - lines:      derived from statement start lines — a line is covered when
 *               any statement starting on it has count > 0. We deliberately
 *               use `statementMap[id].start.line` only (not the full
 *               start..end span): istanbul itself attributes line hits to
 *               statement start lines, and multi-line statements would
 *               otherwise mark lines no tool reports as covered.
 * - uncoveredLines: lines whose every starting statement has count 0
 *
 * pct convention (istanbul): covered/total*100 rounded to 2 decimals;
 * total 0 → 100.
 */
export const v8Parser: CoverageParser = {
  name: 'v8',

  detect(content: string): boolean {
    const data = tryParseJson(content);
    if (!isRecord(data)) return false;
    // A summary file has a total.<metric>.pct roll-up; coverage-final does not.
    const total = data.total;
    if (isRecord(total) && isRecord(total.lines) && 'pct' in total.lines) return false;
    return Object.values(data).some((value) => {
      const fc = unwrap(value);
      return fc !== undefined && isRecord(fc.statementMap) && isRecord(fc.s);
    });
  },

  parse(content: string): CoverageModel {
    const data: unknown = JSON.parse(content);
    if (!isRecord(data)) {
      throw new Error('v8: expected a JSON object keyed by file path');
    }

    const files: FileCoverage[] = [];
    const sums: Record<MetricKey, { total: number; covered: number }> = {
      statements: { total: 0, covered: 0 },
      branches: { total: 0, covered: 0 },
      functions: { total: 0, covered: 0 },
      lines: { total: 0, covered: 0 },
    };

    for (const [key, value] of Object.entries(data)) {
      const fc = unwrap(value);
      if (fc === undefined) continue;
      const file = parseFile(typeof fc.path === 'string' ? fc.path : key, fc);
      for (const metricKey of Object.keys(sums) as MetricKey[]) {
        sums[metricKey].total += file.metrics[metricKey].total;
        sums[metricKey].covered += file.metrics[metricKey].covered;
      }
      files.push(file);
    }

    return {
      total: {
        statements: makeMetric(sums.statements.total, sums.statements.covered),
        branches: makeMetric(sums.branches.total, sums.branches.covered),
        functions: makeMetric(sums.functions.total, sums.functions.covered),
        lines: makeMetric(sums.lines.total, sums.lines.covered),
      },
      files,
    };
  },
};

function parseFile(path: string, fc: Record<string, unknown>): FileCoverage {
  const statementMap = isRecord(fc.statementMap) ? fc.statementMap : {};
  const s = isRecord(fc.s) ? fc.s : {};
  const f = isRecord(fc.f) ? fc.f : {};
  const b = isRecord(fc.b) ? fc.b : {};

  // statements
  let stmtTotal = 0;
  let stmtCovered = 0;
  // lines: covered when any statement starting on the line has count > 0
  const lineCovered = new Map<number, boolean>();
  for (const [id, loc] of Object.entries(statementMap)) {
    const line = startLine(loc);
    const count = toCount(s[id]);
    stmtTotal += 1;
    if (count > 0) stmtCovered += 1;
    if (line !== undefined) {
      lineCovered.set(line, (lineCovered.get(line) ?? false) || count > 0);
    }
  }

  // functions
  let fnTotal = 0;
  let fnCovered = 0;
  for (const count of Object.values(f)) {
    fnTotal += 1;
    if (toCount(count) > 0) fnCovered += 1;
  }

  // branches: each location in each branch array counts individually
  let brTotal = 0;
  let brCovered = 0;
  for (const counts of Object.values(b)) {
    if (!Array.isArray(counts)) continue;
    for (const count of counts) {
      brTotal += 1;
      if (toCount(count) > 0) brCovered += 1;
    }
  }

  let linesHit = 0;
  const uncovered: number[] = [];
  for (const [line, covered] of lineCovered) {
    if (covered) linesHit += 1;
    else uncovered.push(line);
  }
  uncovered.sort((a, b2) => a - b2);

  return {
    path,
    metrics: {
      statements: makeMetric(stmtTotal, stmtCovered),
      branches: makeMetric(brTotal, brCovered),
      functions: makeMetric(fnTotal, fnCovered),
      lines: makeMetric(lineCovered.size, linesHit),
    },
    ...(uncovered.length > 0 ? { uncoveredLines: uncovered } : {}),
  };
}

/** Unwraps an istanbul-lib-coverage `{ data: FileCoverageData }` envelope. */
function unwrap(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  if (isRecord(value.data) && isRecord(value.data.statementMap)) return value.data;
  return value;
}

function startLine(loc: unknown): number | undefined {
  if (!isRecord(loc) || !isRecord(loc.start)) return undefined;
  return typeof loc.start.line === 'number' ? loc.start.line : undefined;
}

function toCount(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function makeMetric(total: number, covered: number): CoverageMetric {
  return {
    total,
    covered,
    skipped: 0,
    // istanbul convention: an empty metric counts as fully covered.
    pct: total === 0 ? 100 : Math.round((covered / total) * 10000) / 100,
  };
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
