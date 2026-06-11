import type { CompletionUsage, ModelProvider } from './provider';

/**
 * Budget/timeout guards (Stage 5.1). Every breach degrades gracefully: the
 * caller gets {skipped, reason} and the deterministic report is untouched.
 */

export type GuardOptions = {
  maxTokensPerRun: number;
  maxEstimatedCostUsd: number;
  timeoutMs?: number;
  costPer1kInputUsd?: number;
  costPer1kOutputUsd?: number;
};

export type GuardState = {
  usedInputTokens: number;
  usedOutputTokens: number;
  estCostUsd: number;
};

export type GuardedResult =
  | { skipped: false; usage: CompletionUsage; estCostUsd: number }
  | { skipped: true; reason: string };

export function newGuardState(): GuardState {
  return { usedInputTokens: 0, usedOutputTokens: 0, estCostUsd: 0 };
}

/** chars/4 is the standard rough token estimate; only used for pre-checks. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function guardedComplete(
  provider: ModelProvider,
  prompt: string,
  opts: GuardOptions & { maxTokens?: number },
  state: GuardState
): Promise<GuardedResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const costIn = opts.costPer1kInputUsd ?? 0.003;
  const costOut = opts.costPer1kOutputUsd ?? 0.015;
  const maxTokens = opts.maxTokens ?? 2048;

  const promptTokens = estimateTokens(prompt);
  const projectedTokens = state.usedInputTokens + state.usedOutputTokens + promptTokens + maxTokens;
  if (projectedTokens > opts.maxTokensPerRun) {
    return {
      skipped: true,
      reason: `token budget exceeded (projected ${projectedTokens} > ${opts.maxTokensPerRun})`,
    };
  }

  const projectedCost =
    state.estCostUsd + (promptTokens / 1000) * costIn + (maxTokens / 1000) * costOut;
  if (projectedCost > opts.maxEstimatedCostUsd) {
    return {
      skipped: true,
      reason: `cost ceiling exceeded (projected $${projectedCost.toFixed(4)} > $${opts.maxEstimatedCostUsd})`,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const usage = await provider.complete(prompt, {
      maxTokens,
      timeoutMs,
      signal: controller.signal,
    });
    state.usedInputTokens += usage.inputTokens;
    state.usedOutputTokens += usage.outputTokens;
    const callCost = (usage.inputTokens / 1000) * costIn + (usage.outputTokens / 1000) * costOut;
    state.estCostUsd += callCost;
    return { skipped: false, usage, estCostUsd: callCost };
  } catch (error) {
    const aborted = controller.signal.aborted;
    return {
      skipped: true,
      reason: aborted ? `timeout after ${timeoutMs}ms` : `provider error: ${error}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
