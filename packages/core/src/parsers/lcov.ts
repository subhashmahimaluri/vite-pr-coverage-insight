import type { CoverageMetric, CoverageModel, FileCoverage, MetricKey } from '../model';
import type { CoverageParser } from './types';

/**
 * Streaming parser for lcov tracefiles (`lcov.info`).
 *
 * Performance contract (phase 6.4): a single forward pass over the content
 * using index arithmetic — no regular expressions, no global line array, and
 * no intermediate per-record structures beyond the record currently being
 * read. State is reset at every `end_of_record`, so memory is bounded by the
 * largest single record, not the file size. A 100k-line tracefile must parse
 * in well under 2 seconds (see test/lcov.bench.test.ts).
 *
 * Records handled:
 * - `SF:<path>`            — starts a file record
 * - `DA:<line>,<hits>`     — per-line execution counts; duplicate entries for
 *                            the same line are merged by summing hits (lcov
 *                            merge semantics), never double-counted
 * - `LF:`/`LH:`            — lines found/hit; preferred for line totals when
 *                            present, otherwise derived from DA entries
 * - `FNF:`/`FNH:`          — functions found/hit
 * - `BRF:`/`BRH:`          — branches found/hit
 * - `end_of_record`        — finalizes the file record
 *
 * All other records (TN, FN, FNDA, BRDA, checksums…) are skipped.
 *
 * Note: lcov has no statement concept, so the `statements` metric mirrors
 * `lines` — the closest equivalent and the convention used by most
 * lcov-to-istanbul converters.
 *
 * pct convention (istanbul): covered/total*100 rounded to 2 decimals;
 * a metric with total 0 reports 100.
 */
export const lcovParser: CoverageParser = {
  name: 'lcov',

  detect(content: string): boolean {
    // A tracefile contains at least one SF: record at the start of a line.
    if (content.startsWith('SF:')) return true;
    if (content.includes('\nSF:')) return true;
    // Tolerate a TN:-only header before the first SF on the same buffer.
    return content.startsWith('TN:') && content.includes('SF:');
  },

  parse(content: string): CoverageModel {
    const files: FileCoverage[] = [];
    const sums: Record<MetricKey, { total: number; covered: number }> = {
      statements: { total: 0, covered: 0 },
      branches: { total: 0, covered: 0 },
      functions: { total: 0, covered: 0 },
      lines: { total: 0, covered: 0 },
    };

    // ---- state for the current record only ----
    let path: string | null = null;
    let lineHits: Map<number, number> = new Map();
    let lf = -1;
    let lh = -1;
    let fnf = 0;
    let fnh = 0;
    let brf = 0;
    let brh = 0;

    const resetRecord = (): void => {
      path = null;
      lineHits = new Map();
      lf = -1;
      lh = -1;
      fnf = 0;
      fnh = 0;
      brf = 0;
      brh = 0;
    };

    const finalizeRecord = (): void => {
      if (path === null) return;

      let daCovered = 0;
      const uncovered: number[] = [];
      for (const [line, hits] of lineHits) {
        if (hits > 0) daCovered += 1;
        else uncovered.push(line);
      }
      uncovered.sort((a, b) => a - b);

      // Prefer the explicit LF/LH summary records when present.
      const linesTotal = lf >= 0 ? lf : lineHits.size;
      const linesCovered = lh >= 0 ? lh : daCovered;

      const metrics: Record<MetricKey, CoverageMetric> = {
        // lcov has no statement records — mirror the lines metric.
        statements: makeMetric(linesTotal, linesCovered),
        branches: makeMetric(brf, brh),
        functions: makeMetric(fnf, fnh),
        lines: makeMetric(linesTotal, linesCovered),
      };
      for (const key of Object.keys(sums) as MetricKey[]) {
        sums[key].total += metrics[key].total;
        sums[key].covered += metrics[key].covered;
      }
      files.push({
        path,
        metrics,
        ...(uncovered.length > 0 ? { uncoveredLines: uncovered } : {}),
      });
      resetRecord();
    };

    // ---- single forward pass ----
    let pos = 0;
    const len = content.length;
    while (pos < len) {
      let eol = content.indexOf('\n', pos);
      if (eol === -1) eol = len;
      let end = eol;
      if (end > pos && content.charCodeAt(end - 1) === 13 /* \r */) end -= 1;

      if (end > pos) {
        const first = content.charCodeAt(pos);
        if (first === 83 /* S */ && content.startsWith('SF:', pos)) {
          finalizeRecord(); // tolerate a missing end_of_record
          path = content.slice(pos + 3, end);
        } else if (first === 68 /* D */ && content.startsWith('DA:', pos)) {
          const comma = content.indexOf(',', pos + 3);
          if (comma !== -1 && comma < end) {
            const line = parseDecimal(content, pos + 3, comma);
            // A third ,checksum field may follow the hit count.
            const comma2 = content.indexOf(',', comma + 1);
            const hitsEnd = comma2 !== -1 && comma2 < end ? comma2 : end;
            const hits = parseDecimal(content, comma + 1, hitsEnd);
            if (line >= 0 && hits >= 0) {
              // Merge duplicates by summing hits (lcov tracefile merge rule).
              lineHits.set(line, (lineHits.get(line) ?? 0) + hits);
            }
          }
        } else if (first === 101 /* e */ && content.startsWith('end_of_record', pos)) {
          finalizeRecord();
        } else if (first === 76 /* L */) {
          if (content.startsWith('LF:', pos)) lf = parseDecimal(content, pos + 3, end);
          else if (content.startsWith('LH:', pos)) lh = parseDecimal(content, pos + 3, end);
        } else if (first === 70 /* F */) {
          if (content.startsWith('FNF:', pos))
            fnf = Math.max(0, parseDecimal(content, pos + 4, end));
          else if (content.startsWith('FNH:', pos))
            fnh = Math.max(0, parseDecimal(content, pos + 4, end));
        } else if (first === 66 /* B */) {
          if (content.startsWith('BRF:', pos))
            brf = Math.max(0, parseDecimal(content, pos + 4, end));
          else if (content.startsWith('BRH:', pos))
            brh = Math.max(0, parseDecimal(content, pos + 4, end));
        }
        // Anything else (TN:, FN:, FNDA:, BRDA:, …) is intentionally skipped.
      }
      pos = eol + 1;
    }
    finalizeRecord(); // tolerate a tracefile without a trailing end_of_record

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

function makeMetric(total: number, covered: number): CoverageMetric {
  const safeTotal = total >= 0 ? total : 0;
  const safeCovered = covered >= 0 ? covered : 0;
  return {
    total: safeTotal,
    covered: safeCovered,
    skipped: 0,
    // istanbul convention: an empty metric counts as fully covered.
    pct: safeTotal === 0 ? 100 : Math.round((safeCovered / safeTotal) * 10000) / 100,
  };
}

/** Parses a non-negative base-10 integer from content[start, end); -1 on garbage. */
function parseDecimal(content: string, start: number, end: number): number {
  let value = 0;
  if (start >= end) return -1;
  for (let i = start; i < end; i += 1) {
    const c = content.charCodeAt(i);
    if (c < 48 || c > 57) return -1;
    value = value * 10 + (c - 48);
  }
  return value;
}
