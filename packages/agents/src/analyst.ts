import { z } from 'zod';
import type { CoverageReport } from '@coverage-insight/core';
import { AuditLog } from './runtime/audit';
import { GuardOptions, GuardState, guardedComplete } from './runtime/guards';
import type { ModelProvider } from './runtime/provider';
import { buildPromptContext } from './runtime/redact';

/** Stage 5.2 — coverage-analyst: explains risk in uncovered changed code. */

const findingSchema = z.object({
  file: z.string(),
  lines: z.string(),
  risk: z.enum(['high', 'med', 'low']),
  reason: z.string(),
});

const analystOutputSchema = z.object({
  summary: z.string(),
  findings: z.array(findingSchema),
});

export type AnalystFinding = z.infer<typeof findingSchema>;
export type AnalystOutput = z.infer<typeof analystOutputSchema>;
export type AnalystResult =
  | { skipped: false; output: AnalystOutput }
  | { skipped: true; reason: string };

const INSTRUCTIONS =
  'You are a coverage risk analyst. Given coverage data for a pull request, ' +
  'identify the riskiest uncovered changed code. Respond with ONLY a JSON object ' +
  '{"summary": string, "findings": [{"file": string, "lines": string, ' +
  '"risk": "high"|"med"|"low", "reason": string}]} — no prose, no markdown fences.';

function extractJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '');
  return JSON.parse(trimmed);
}

export async function runCoverageAnalyst(params: {
  report: CoverageReport;
  snippets?: Map<string, string>;
  provider: ModelProvider;
  guards: GuardOptions;
  guardState: GuardState;
  redacted: boolean;
  auditLog: AuditLog;
  now: () => string;
}): Promise<AnalystResult> {
  const { report, provider, guards, guardState, redacted, auditLog, now } = params;
  const changed = (report.files ?? []).filter((f) => f.change !== 'unchanged');

  const context = buildPromptContext(
    {
      paths: changed.map((f) => f.path),
      metrics: changed
        .map((f) => `${f.path}: lines ${f.metrics.lines?.head}% (Δ ${f.metrics.lines?.delta})`)
        .join('\n'),
      uncoveredRanges: changed
        .filter((f) => f.uncoveredRanges?.length)
        .map((f) => `${f.path}: ${f.uncoveredRanges!.map((r) => `${r.start}-${r.end}`).join(', ')}`)
        .join('\n'),
      snippets: params.snippets,
    },
    redacted
  );
  const prompt = `${INSTRUCTIONS}\n\n${context}`;

  const valid = new Set(changed.map((f) => f.path));

  for (let attempt = 0; attempt < 2; attempt++) {
    const retryNote =
      attempt === 0
        ? ''
        : '\n\nYour previous response was not valid JSON of the required shape. Respond with ONLY the JSON object.';
    const result = await guardedComplete(provider, prompt + retryNote, guards, guardState);

    if (result.skipped) {
      auditLog.record({
        agent: 'coverage-analyst',
        prompt,
        response: null,
        inputTokens: 0,
        outputTokens: 0,
        estCostUsd: 0,
        timestamp: now(),
        skipped: result.reason,
      });
      return { skipped: true, reason: result.reason };
    }

    auditLog.record({
      agent: 'coverage-analyst',
      prompt: prompt + retryNote,
      response: result.usage.text,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estCostUsd: result.estCostUsd,
      timestamp: now(),
    });

    try {
      const parsed = analystOutputSchema.parse(extractJson(result.usage.text));
      // findings outside the diff are dropped, enforced in code not prompt
      const findings = parsed.findings.filter((f) => valid.has(f.file));
      return { skipped: false, output: { summary: parsed.summary, findings } };
    } catch {
      // fall through to retry
    }
  }

  return { skipped: true, reason: 'model returned invalid JSON twice' };
}

const RISK_BADGES = { high: '🔴', med: '🟡', low: '🟢' } as const;

export function renderAnalystSection(result: AnalystResult): string {
  if (result.skipped) {
    return `\n\n---\n\n_🤖 AI risk analysis skipped: ${result.reason}_`;
  }
  const lines = ['\n\n---\n\n### 🤖 AI risk analysis (generated)', '', result.output.summary, ''];
  for (const f of result.output.findings) {
    lines.push(`- ${RISK_BADGES[f.risk]} **${f.file}** (${f.lines}): ${f.reason}`);
  }
  return lines.join('\n');
}
