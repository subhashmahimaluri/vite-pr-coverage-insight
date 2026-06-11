import { METRIC_KEYS, type MetricKey } from '@coverage-insight/core';

/**
 * Parses the `thresholds` action input — the per-project coverage gate set
 * directly in the workflow yaml (equivalent to `thresholds` in
 * coverage-insight.config.json; the input wins). Accepted forms:
 *
 *   thresholds: 80                          # all four metrics
 *   thresholds: lines:85, branches:75       # per metric (`:` or `=`)
 *   thresholds: '{"lines":85,"branches":75}'
 */
export function parseThresholdsInput(raw: string): Partial<Record<MetricKey, number>> {
  const input = raw.trim();
  if (!input) return {};

  const valid = (n: number): boolean => Number.isFinite(n) && n >= 0 && n <= 100;
  const fail = (reason: string): never => {
    throw new Error(
      `invalid \`thresholds\` input "${raw}" (${reason}) — use a number (80), pairs (lines:85, branches:75) or JSON`
    );
  };

  // plain number → every metric
  const all = Number(input);
  if (!Number.isNaN(all)) {
    if (!valid(all)) fail('must be 0–100');
    return Object.fromEntries(METRIC_KEYS.map((k) => [k, all]));
  }

  let entries: [string, unknown][];
  if (input.startsWith('{')) {
    try {
      entries = Object.entries(JSON.parse(input) as Record<string, unknown>);
    } catch {
      return fail('not valid JSON');
    }
  } else {
    entries = input.split(',').map((pair) => {
      const [key, value, ...rest] = pair.split(/[:=]/).map((s) => s.trim());
      if (!key || value === undefined || rest.length > 0) fail(`bad pair "${pair.trim()}"`);
      return [key, Number(value)];
    });
  }

  const thresholds: Partial<Record<MetricKey, number>> = {};
  for (const [key, value] of entries) {
    if (!(METRIC_KEYS as readonly string[]).includes(key)) {
      fail(`unknown metric "${key}" — expected ${METRIC_KEYS.join('/')}`);
    }
    const n = Number(value);
    if (!valid(n)) fail(`"${key}" must be a number 0–100`);
    thresholds[key as MetricKey] = n;
  }
  return thresholds;
}
