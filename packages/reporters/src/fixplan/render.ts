import {
  METRIC_KEYS,
  type CoverageReport,
  type FileReport,
  type MetricKey,
} from '@coverage-insight/core';

/**
 * The fix plan: a downloadable markdown document built for handing to an AI
 * assistant (Copilot Chat, Claude, Cursor) — or a human. Changed files with
 * coverage gaps come first with one ready-to-paste prompt each; the repo's
 * lowest-covered files follow as a batch. No comment budget here: it's an
 * artifact.
 */
const CHANGED_PROMPT_CAP = 20;
const REPO_WIDE_CAP = 10;

function pct(file: FileReport, key: MetricKey): number {
  return file.metrics[key]?.head ?? 0;
}

function worstPct(file: FileReport): number {
  return Math.min(...METRIC_KEYS.map((key) => pct(file, key)));
}

function metricsLine(file: FileReport): string {
  return METRIC_KEYS.map((key) => `${key} ${pct(file, key).toFixed(1)}%`).join(' · ');
}

function fmtRanges(ranges: { start: number; end: number }[] | undefined): string {
  if (!ranges || ranges.length === 0) return '';
  return ranges
    .slice(0, 12)
    .map((r) => (r.start === r.end ? `${r.start}` : `${r.start}–${r.end}`))
    .join(', ');
}

/** one paste-ready prompt to cover a file — shared with the PR comment */
export function buildTestPrompt(file: FileReport): string {
  const ranges = fmtRanges(file.uncoveredRanges);
  const lines = [
    `Write tests for \`${file.path}\`.`,
    `Current coverage: ${metricsLine(file)}.`,
    ...(ranges ? [`Uncovered lines: ${ranges}.`] : []),
    'Cover the public behavior including branches and error paths — do not test',
    'implementation details. Follow the existing test style of this repository,',
    'and do not modify the source file unless it is untestable as written.',
  ];
  return ['```text', ...lines, '```'].join('\n');
}

function fileBlock(file: FileReport, index: number): string {
  return [
    `### ${index}. \`${file.path}\` — worst metric ${worstPct(file).toFixed(1)}%`,
    '',
    `- **Coverage:** ${metricsLine(file)}`,
    ...(file.uncoveredRanges?.length
      ? [`- **Uncovered lines:** ${fmtRanges(file.uncoveredRanges)}`]
      : []),
    '',
    '**Prompt for your AI assistant:**',
    '',
    buildTestPrompt(file),
  ].join('\n');
}

/** changed files that still have a coverage gap, worst first */
export function coverageGaps(report: CoverageReport): FileReport[] {
  const files = report.files ?? [];
  // the PR's git diff (`touched`) is authoritative when present; `change` is
  // only a baseline-derived heuristic (new coverage data ≠ changed by the PR)
  const hasDiff = files.some((file) => file.touched !== undefined);
  return files
    .filter((file) => (hasDiff ? file.touched : file.change !== 'unchanged'))
    .filter((file) => worstPct(file) < 100)
    .sort((a, b) => worstPct(a) - worstPct(b));
}

export function renderFixPlan(report: CoverageReport): string {
  const gaps = coverageGaps(report);
  const repoWide = (report.files ?? [])
    .filter((file) => !gaps.includes(file) && worstPct(file) < 80)
    .sort((a, b) => worstPct(a) - worstPct(b))
    .slice(0, REPO_WIDE_CAP);

  const parts: string[] = [
    '# Coverage fix plan — Coverage Insight',
    '',
    [
      report.pr ? `PR #${report.pr.number}` : null,
      `state: ${report.state}`,
      report.policyMeta ? `policy: ${report.policyMeta.description}` : null,
      `generated: ${report.generatedAt}`,
    ]
      .filter(Boolean)
      .join(' · '),
    '',
    '> **How to use:** paste a prompt block into Copilot Chat (or any AI assistant)',
    '> with the named file open. Cover the *changed* files first — they are what',
    '> the gate judges. Repo-wide gaps are debt you can pay down any time.',
    '',
    `## 🎯 Changed in this PR with coverage gaps (${gaps.length}) — cover these first`,
    '',
  ];

  if (gaps.length === 0) {
    parts.push('_Nothing — every file this PR touches is fully covered._ 🎉');
  } else {
    gaps.slice(0, CHANGED_PROMPT_CAP).forEach((file, i) => parts.push(fileBlock(file, i + 1), ''));
    if (gaps.length > CHANGED_PROMPT_CAP) {
      parts.push(`_…and ${gaps.length - CHANGED_PROMPT_CAP} more — see coverage-report.html._`);
    }
  }

  parts.push(
    '',
    `## 🧹 Lowest-covered files repo-wide (${repoWide.length}) — suggested cleanups`,
    ''
  );
  if (repoWide.length === 0) {
    parts.push('_None below 80%. Nice._');
  } else {
    parts.push(
      "_These don't block the merge — pick one, cover it, and the trend sparkline_",
      '_turns up on the next baseline run._',
      '',
      '| File | ' + METRIC_KEYS.map((k) => k).join(' | ') + ' |',
      '| --- | ' + METRIC_KEYS.map(() => '---:').join(' | ') + ' |',
      ...repoWide.map(
        (file) =>
          `| \`${file.path}\` | ` +
          METRIC_KEYS.map((key) => `${pct(file, key).toFixed(1)}%`).join(' | ') +
          ' |'
      ),
      '',
      '<details>',
      '<summary>Batch prompt for your AI assistant</summary>',
      '',
      '```text',
      'Work through the files listed below one at a time. For each: write tests',
      'covering the public behavior including branches and error paths, run the',
      'test suite, and only then move to the next file.',
      '',
      ...repoWide.map((file) => `- ${file.path} (worst metric ${worstPct(file).toFixed(1)}%)`),
      '```',
      '',
      '</details>'
    );
  }

  parts.push('', '---', '', '<sub>Generated by **Coverage Insight** · schema v1</sub>', '');
  return parts.join('\n');
}

/**
 * Collapsed per-file "cover with AI" block for the PR comment (kept small —
 * the comment has a 65k budget; the fix-plan artifact carries the rest).
 */
export function renderTestPromptsSection(report: CoverageReport, cap = 5): string {
  const gaps = coverageGaps(report).slice(0, cap);
  if (gaps.length === 0) return '';
  const blocks = gaps.map((file) => [`**\`${file.path}\`**`, '', buildTestPrompt(file)].join('\n'));
  return [
    '',
    '<details>',
    `<summary>🤖 Cover with AI — copy a prompt per changed file (${gaps.length})</summary>`,
    '',
    'Paste a block into Copilot Chat (or any AI assistant) with the file open.',
    '',
    blocks.join('\n\n'),
    '',
    '</details>',
  ].join('\n');
}
