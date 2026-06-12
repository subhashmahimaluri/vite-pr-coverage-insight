import type { Config } from '@coverage-insight/core';

/**
 * Prevention, not cure: a copilot-instructions block derived from the repo's
 * actual coverage policy, so AI assistants ship tests alongside the code they
 * write. Upserted between markers so the rest of the file stays owned by the
 * team.
 */
export const INSTRUCTIONS_START = '<!-- coverage-insight:start -->';
export const INSTRUCTIONS_END = '<!-- coverage-insight:end -->';

export function renderCopilotInstructions(config: Config): string {
  const thresholds = Object.entries(config.thresholds ?? {});
  const policy =
    thresholds.length > 0
      ? `min ${thresholds.map(([metric, p]) => `${metric} ${p}%`).join(', ')}`
      : 'report-only';

  const lines: string[] = [
    INSTRUCTIONS_START,
    '',
    '## Test coverage rules (enforced by Coverage Insight)',
    '',
    `Pull requests in this repository are coverage-gated: **${policy}${
      config.ratchet ? ' · ratchet (coverage never decreases)' : ''
    }**.`,
    'Write code that passes the gate the first time:',
    '',
    '- **Every new module, function or branch ships with tests in the same PR.**',
    '  Untested new code is the main reason the gate fails.',
    ...(config.ratchet
      ? [
          '- Never reduce the coverage of an existing file — if you change it, keep or',
          `  improve its coverage (tolerance: ${config.ratchetTolerance ?? 0.1} percentage points).`,
        ]
      : []),
    ...(thresholds.length > 0 ? [`- Keep overall coverage at or above: ${policy}.`] : []),
    '- Test public behavior, not implementation details: assert on outputs and',
    '  side effects, cover error paths and edge-case branches.',
    '- Prefer small, focused test cases over one giant test; follow the existing',
    '  test layout and naming of this repository.',
    '- If code is hard to test, refactor for testability (extract pure functions,',
    '  inject dependencies) rather than skipping the test.',
    '- Never delete or `.skip` existing tests to make a change pass.',
    '',
    INSTRUCTIONS_END,
  ];
  return lines.join('\n');
}

/** insert or replace the marked block, leaving the rest of the file alone */
export function upsertInstructions(existing: string | null, block: string): string {
  if (!existing || existing.trim().length === 0) return `${block}\n`;
  const start = existing.indexOf(INSTRUCTIONS_START);
  const end = existing.indexOf(INSTRUCTIONS_END);
  if (start !== -1 && end !== -1 && end > start) {
    return existing.slice(0, start) + block + existing.slice(end + INSTRUCTIONS_END.length);
  }
  return `${existing.replace(/\s*$/, '')}\n\n${block}\n`;
}
