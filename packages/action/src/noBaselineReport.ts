import type { CoverageSummary } from '@coverage-insight/core';

/**
 * State 5 (no baseline): absolute numbers only, no diff. Rendered when the
 * resolver finds nothing and no explicit base input was given.
 */
export function formatNoBaselineMarkdown(head: CoverageSummary, mergeBaseSha?: string): string {
  const where = mergeBaseSha ? ` for merge-base \`${mergeBaseSha.slice(0, 7)}\`` : '';
  const header =
    `### 📊 Vite Coverage Report\n\n` +
    `ℹ️ **Baseline recorded** — no base coverage found${where}; showing absolute numbers only. ` +
    `The next PR after a main-branch baseline run will show deltas.\n\n` +
    `| Metric     | Coverage |\n|------------|----------|`;

  const rows = (['statements', 'branches', 'functions', 'lines'] as const).map(
    (metric) => `| ${metric} | ${head.total[metric].pct.toFixed(2)}% |`
  );

  return [header, ...rows].join('\n');
}

/** Appended when the baseline came from an ancestor commit (staleness > 0). */
export function stalenessNote(sha: string, staleness: number): string {
  return `\n\n_ℹ️ Baseline is ${staleness} commit${staleness === 1 ? '' : 's'} behind the merge-base (from \`${sha.slice(0, 7)}\`)._`;
}
