import type { MetricKey } from '../model';

export type PolicyVerdict = 'pass' | 'warn' | 'fail';

export type PolicyViolation = {
  /** which rule produced this violation */
  rule: 'threshold' | 'override-threshold' | 'ratchet-total' | 'ratchet-file';
  metric: MetricKey;
  /** 'total' or a file path */
  scope: string;
  /** required pct (threshold) or baseline pct (ratchet) */
  required: number;
  actual: number;
  /** positive number of percentage points missing */
  gap: number;
};

export type PolicyResult = {
  verdict: PolicyVerdict;
  violations: PolicyViolation[];
};

export const PASS: PolicyResult = { verdict: 'pass', violations: [] };
