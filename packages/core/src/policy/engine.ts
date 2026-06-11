import picomatch from 'picomatch';
import type { Config, Thresholds } from '../config/schema';
import { METRIC_KEYS, type CoverageModel } from '../model';
import type { PolicyResult, PolicyViolation } from './types';

export type PolicyInput = {
  head: CoverageModel;
  /** baseline coverage; omit (or pass null) when no baseline is available */
  base?: CoverageModel | null;
  config: Config;
};

type OverrideMatcher = {
  thresholds: Thresholds;
  /** longest literal (non-wildcard) prefix length — higher is more specific */
  specificity: number;
  /** position in config.overrides — later entries win specificity ties */
  index: number;
  isMatch: (filePath: string) => boolean;
};

/** Characters that start the glob (non-literal) part of an override pattern. */
const GLOB_CHARS = new Set(['*', '?', '[', ']', '{', '}', '(', ')', '!', '+', '@']);

/**
 * Evaluates head coverage against the configured policy.
 *
 * Verdict mapping:
 * - 'fail' — any violation: a global threshold miss on the totals, a per-path
 *   override threshold miss on a matching file, or a ratchet decrease (total
 *   or per-file) greater than `ratchetTolerance`.
 * - 'warn' — no violations, but the ratchet observed a real decrease that
 *   stayed within tolerance (0 < decrease <= ratchetTolerance, total or file),
 *   OR ratchet is enabled and no base model was provided (nothing to ratchet
 *   against, so we cannot certify the run).
 * - 'pass' — everything else.
 *
 * Decreases and gaps are rounded to 2 decimals before comparison, so a
 * decrease that rounds to exactly the tolerance does NOT fail. All gaps are
 * positive percentage points.
 */
export function evaluatePolicy(input: PolicyInput): PolicyResult {
  const { head, base, config } = input;
  const violations: PolicyViolation[] = [];

  // 1. Global thresholds — checked against the head totals only.
  for (const metric of METRIC_KEYS) {
    const required = config.thresholds?.[metric];
    if (required === undefined) continue;
    const actual = head.total[metric].pct;
    if (actual < required) {
      violations.push({
        rule: 'threshold',
        metric,
        scope: 'total',
        required,
        actual,
        gap: round2(required - actual),
      });
    }
  }

  // 2. Per-path overrides — most specific matching glob wins per file.
  const matchers: OverrideMatcher[] = (config.overrides ?? []).map((override, index) => ({
    thresholds: override.thresholds,
    specificity: literalPrefixLength(override.path),
    index,
    isMatch: picomatch(override.path),
  }));
  if (matchers.length > 0) {
    for (const file of head.files) {
      const winner = pickOverride(matchers, file.path);
      if (!winner) continue;
      for (const metric of METRIC_KEYS) {
        const required = winner.thresholds[metric];
        if (required === undefined) continue;
        const actual = file.metrics[metric].pct;
        if (actual < required) {
          violations.push({
            rule: 'override-threshold',
            metric,
            scope: file.path,
            required,
            actual,
            gap: round2(required - actual),
          });
        }
      }
    }
  }

  // 3. Ratchet — no metric may decrease vs the baseline beyond the tolerance.
  let decreasedWithinTolerance = false;
  if (config.ratchet && base) {
    const tolerance = config.ratchetTolerance;

    for (const metric of METRIC_KEYS) {
      const required = base.total[metric].pct;
      const actual = head.total[metric].pct;
      const decrease = round2(required - actual);
      if (decrease > tolerance) {
        violations.push({
          rule: 'ratchet-total',
          metric,
          scope: 'total',
          required,
          actual,
          gap: decrease,
        });
      } else if (decrease > 0) {
        decreasedWithinTolerance = true;
      }
    }

    const baseFiles = new Map(base.files.map((file) => [file.path, file]));
    for (const file of head.files) {
      const baseFile = baseFiles.get(file.path);
      if (!baseFile) continue; // new files have no baseline to ratchet against
      for (const metric of METRIC_KEYS) {
        const required = baseFile.metrics[metric].pct;
        const actual = file.metrics[metric].pct;
        const decrease = round2(required - actual);
        if (decrease > tolerance) {
          violations.push({
            rule: 'ratchet-file',
            metric,
            scope: file.path,
            required,
            actual,
            gap: decrease,
          });
        } else if (decrease > 0) {
          decreasedWithinTolerance = true;
        }
      }
    }
  }

  const ratchetWithoutBase = config.ratchet && !base;
  const verdict =
    violations.length > 0
      ? 'fail'
      : decreasedWithinTolerance || ratchetWithoutBase
        ? 'warn'
        : 'pass';
  return { verdict, violations };
}

/**
 * Picks the most specific override matching a file path. Specificity is the
 * length of the glob's literal (non-wildcard) prefix; ties go to the override
 * defined later in the array.
 */
function pickOverride(matchers: OverrideMatcher[], filePath: string): OverrideMatcher | undefined {
  let winner: OverrideMatcher | undefined;
  for (const matcher of matchers) {
    if (!matcher.isMatch(filePath)) continue;
    if (
      !winner ||
      matcher.specificity > winner.specificity ||
      (matcher.specificity === winner.specificity && matcher.index > winner.index)
    ) {
      winner = matcher;
    }
  }
  return winner;
}

function literalPrefixLength(glob: string): number {
  for (let i = 0; i < glob.length; i++) {
    if (GLOB_CHARS.has(glob[i])) return i;
  }
  return glob.length;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
