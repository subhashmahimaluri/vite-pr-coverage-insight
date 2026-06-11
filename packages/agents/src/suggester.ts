import { AuditLog } from './runtime/audit';
import { GuardOptions, GuardState, guardedComplete } from './runtime/guards';
import type { ModelProvider } from './runtime/provider';
import type { AnalystFinding } from './analyst';

/** Stage 5.3 — test-suggester: runnable skeletons for the top risk findings. */

export type Suggestion = { file: string; code: string };
export type SuggesterResult = { suggestions: Suggestion[]; dropped: number };

export async function runTestSuggester(params: {
  findings: AnalystFinding[];
  framework: 'vitest' | 'jest';
  styleSample?: string;
  maxSuggestions?: number;
  provider: ModelProvider;
  guards: GuardOptions;
  guardState: GuardState;
  auditLog: AuditLog;
  /** compile-check hook — the action wires tsc --noEmit; invalid suggestions are dropped */
  validate: (code: string) => Promise<boolean>;
  now: () => string;
}): Promise<SuggesterResult> {
  const max = params.maxSuggestions ?? 3;
  const targets = params.findings.slice(0, max);
  const suggestions: Suggestion[] = [];
  let dropped = 0;

  for (const finding of targets) {
    const prompt =
      `Write a runnable ${params.framework} test skeleton covering ${finding.file} ` +
      `lines ${finding.lines} (${finding.reason}). ` +
      (params.styleSample
        ? `Mirror the conventions of this existing test:\n${params.styleSample}\n`
        : '') +
      'Respond with ONLY the TypeScript test code, no prose, no markdown fences.';

    const result = await guardedComplete(params.provider, prompt, params.guards, params.guardState);

    if (result.skipped) {
      params.auditLog.record({
        agent: 'test-suggester',
        prompt,
        response: null,
        inputTokens: 0,
        outputTokens: 0,
        estCostUsd: 0,
        timestamp: params.now(),
        skipped: result.reason,
      });
      break; // budget/timeout — stop asking
    }

    const code = result.usage.text
      .trim()
      .replace(/^```(?:ts|typescript)?\n?/, '')
      .replace(/\n?```$/, '');

    params.auditLog.record({
      agent: 'test-suggester',
      prompt,
      response: code,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estCostUsd: result.estCostUsd,
      timestamp: params.now(),
    });

    if (await params.validate(code)) {
      suggestions.push({ file: finding.file, code });
    } else {
      dropped += 1; // silently dropped from the comment; still in the audit log
    }
  }

  return { suggestions, dropped };
}

export function renderSuggesterSection(result: SuggesterResult): string {
  if (result.suggestions.length === 0) return '';
  const blocks = result.suggestions
    .map((s) => `**${s.file}**\n\n\`\`\`ts\n${s.code}\n\`\`\``)
    .join('\n\n');
  return `\n\n<details><summary>🧪 Suggested tests (generated)</summary>\n\n${blocks}\n\n</details>`;
}
