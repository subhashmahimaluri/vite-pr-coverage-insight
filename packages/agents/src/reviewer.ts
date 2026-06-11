import { z } from 'zod';
import type { PolicyResult, TestFailuresResult } from '@coverage-insight/core';
import { AuditLog } from './runtime/audit';
import { GuardOptions, GuardState, guardedComplete } from './runtime/guards';
import type { ModelProvider } from './runtime/provider';
import type { AnalystFinding } from './analyst';

/** Stage 5.4 — pr-risk-reviewer: one advisory verdict over all signals. */

const verdictSchema = z.object({
  verdict: z.enum(['looks-safe', 'review-carefully', 'high-risk']),
  rationale: z.string(),
  likelyCause: z.string().optional(),
});

export type ReviewerOutput = z.infer<typeof verdictSchema>;
export type ReviewerResult =
  | { skipped: false; output: ReviewerOutput }
  | { skipped: true; reason: string };

export async function runPrRiskReviewer(params: {
  analystFindings: AnalystFinding[];
  policy: PolicyResult;
  testFailures?: TestFailuresResult | null;
  diffStats?: { filesChanged: number; additions?: number; deletions?: number };
  provider: ModelProvider;
  guards: GuardOptions;
  guardState: GuardState;
  auditLog: AuditLog;
  now: () => string;
}): Promise<ReviewerResult> {
  const prompt =
    'You are a PR risk reviewer. Combine these signals into one verdict. ' +
    'Respond with ONLY JSON {"verdict": "looks-safe"|"review-carefully"|"high-risk", ' +
    '"rationale": string, "likelyCause"?: string}.\n\n' +
    `Policy: ${JSON.stringify(params.policy)}\n` +
    `Test failures: ${JSON.stringify(params.testFailures ?? null)}\n` +
    `Analyst findings: ${JSON.stringify(params.analystFindings)}\n` +
    `Diff stats: ${JSON.stringify(params.diffStats ?? null)}`;

  const result = await guardedComplete(params.provider, prompt, params.guards, params.guardState);

  if (result.skipped) {
    params.auditLog.record({
      agent: 'pr-risk-reviewer',
      prompt,
      response: null,
      inputTokens: 0,
      outputTokens: 0,
      estCostUsd: 0,
      timestamp: params.now(),
      skipped: result.reason,
    });
    return { skipped: true, reason: result.reason };
  }

  params.auditLog.record({
    agent: 'pr-risk-reviewer',
    prompt,
    response: result.usage.text,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    estCostUsd: result.estCostUsd,
    timestamp: params.now(),
  });

  let output: ReviewerOutput;
  try {
    const cleaned = result.usage.text
      .trim()
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '');
    output = verdictSchema.parse(JSON.parse(cleaned));
  } catch {
    return { skipped: true, reason: 'model returned invalid JSON' };
  }

  // Clamp in code, not prompt: the AI may never contradict the deterministic
  // gate — a failed policy or failed tests can never read 'looks-safe'.
  const gateFailed =
    params.policy.verdict === 'fail' || (params.testFailures?.numFailedTests ?? 0) > 0;
  if (gateFailed && output.verdict === 'looks-safe') {
    output = { ...output, verdict: 'review-carefully' };
  }

  return { skipped: false, output };
}

/**
 * Blocking is double opt-in (config ai: 'review' AND ai-can-block). Even then
 * the AI may only soften to 'neutral' — it never overrides a deterministic
 * 'failure', and a passing gate is never failed by AI.
 */
export function checkRunConclusion(
  aiVerdict: ReviewerOutput['verdict'],
  opts: { aiMode: 'off' | 'comment' | 'review'; aiCanBlock: boolean }
): 'neutral' | null {
  if (opts.aiMode !== 'review' || !opts.aiCanBlock) return null;
  return aiVerdict === 'high-risk' ? 'neutral' : null;
}

export function renderReviewerSection(
  result: ReviewerResult,
  state: { testsFailed: boolean }
): string {
  if (result.skipped) {
    return `\n\n---\n\n_🤖 AI risk review skipped: ${result.reason}_`;
  }
  if (state.testsFailed && result.output.likelyCause) {
    return `\n\n---\n\n> 💡 **Likely cause (generated):** ${result.output.likelyCause}`;
  }
  const icons = { 'looks-safe': '🟢', 'review-carefully': '🟡', 'high-risk': '🔴' } as const;
  return `\n\n---\n\n### 🤖 AI risk review (generated)\n\n${icons[result.output.verdict]} **${result.output.verdict}** — ${result.output.rationale}`;
}
