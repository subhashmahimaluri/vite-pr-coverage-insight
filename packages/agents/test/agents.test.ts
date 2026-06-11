import { describe, expect, it, vi } from 'vitest';
import type { CoverageReport, PolicyResult } from '@coverage-insight/core';
import {
  AuditLog,
  GuardOptions,
  ModelProvider,
  checkRunConclusion,
  guardedComplete,
  newGuardState,
  renderAnalystSection,
  renderReviewerSection,
  runCoverageAnalyst,
  runPrRiskReviewer,
  runTestSuggester,
  selectProvider,
} from '../src/index';

const now = () => '2026-06-11T10:00:00Z';

function mockProvider(responses: string[]): ModelProvider {
  let i = 0;
  return {
    name: 'mock',
    complete: vi.fn(async () => ({
      text: responses[Math.min(i++, responses.length - 1)],
      inputTokens: 100,
      outputTokens: 50,
    })),
  };
}

const guards: GuardOptions = { maxTokensPerRun: 100_000, maxEstimatedCostUsd: 1 };

const report = {
  schemaVersion: 1,
  generatedAt: now(),
  state: 'passed',
  files: [
    {
      path: 'src/a.ts',
      change: 'modified',
      metrics: { lines: { base: 80, head: 70, delta: -10 } },
      uncoveredRanges: [{ start: 4, end: 9 }],
    },
  ],
} as unknown as CoverageReport;

const passPolicy: PolicyResult = { verdict: 'pass', violations: [] };
const failPolicy: PolicyResult = {
  verdict: 'fail',
  violations: [
    { rule: 'threshold', metric: 'lines', scope: 'total', required: 90, actual: 70, gap: 20 },
  ],
};

describe('provider selection', () => {
  it('names the missing env var', () => {
    expect(() => selectProvider({ AI_PROVIDER: 'anthropic' })).toThrow('ANTHROPIC_API_KEY');
    expect(() => selectProvider({ AI_PROVIDER: 'bedrock' })).toThrow('AWS_BEARER_TOKEN_BEDROCK');
    expect(() => selectProvider({ AI_PROVIDER: 'vertex' })).toThrow('GOOGLE_VERTEX_TOKEN');
    expect(() => selectProvider({ AI_PROVIDER: 'nope' } as never)).toThrow('Unknown AI provider');
  });
});

describe('guards', () => {
  it('skips on token budget breach without calling the provider', async () => {
    const provider = mockProvider(['x']);
    const result = await guardedComplete(
      provider,
      'p'.repeat(4000),
      { maxTokensPerRun: 500, maxEstimatedCostUsd: 1 },
      newGuardState()
    );
    expect(result.skipped).toBe(true);
    expect(result.skipped && result.reason).toContain('token budget');
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('skips on cost ceiling breach', async () => {
    const result = await guardedComplete(
      mockProvider(['x']),
      'prompt',
      { maxTokensPerRun: 100_000, maxEstimatedCostUsd: 0.000001 },
      newGuardState()
    );
    expect(result.skipped && result.reason).toContain('cost ceiling');
  });

  it('skips on timeout and reports it', async () => {
    const hanging: ModelProvider = {
      name: 'hang',
      complete: (_prompt, opts) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    };
    const result = await guardedComplete(
      hanging,
      'p',
      { ...guards, timeoutMs: 20 },
      newGuardState()
    );
    expect(result.skipped && result.reason).toContain('timeout');
  });

  it('accumulates usage across calls', async () => {
    const state = newGuardState();
    await guardedComplete(mockProvider(['a']), 'p', guards, state);
    await guardedComplete(mockProvider(['b']), 'p', guards, state);
    expect(state.usedInputTokens).toBe(200);
    expect(state.usedOutputTokens).toBe(100);
    expect(state.estCostUsd).toBeGreaterThan(0);
  });
});

describe('coverage-analyst', () => {
  const goodOutput = JSON.stringify({
    summary: 'one risky area',
    findings: [
      { file: 'src/a.ts', lines: '4-9', risk: 'high', reason: 'error path untested' },
      { file: 'src/not-in-diff.ts', lines: '1', risk: 'low', reason: 'should be dropped' },
    ],
  });

  it('parses output and drops findings outside the diff', async () => {
    const audit = new AuditLog();
    const result = await runCoverageAnalyst({
      report,
      provider: mockProvider([goodOutput]),
      guards,
      guardState: newGuardState(),
      redacted: false,
      auditLog: audit,
      now,
    });
    expect(result.skipped).toBe(false);
    if (!result.skipped) {
      expect(result.output.findings).toHaveLength(1);
      expect(result.output.findings[0].file).toBe('src/a.ts');
    }
    expect(audit.entries).toHaveLength(1);
  });

  it('retries once on malformed output, then succeeds', async () => {
    const provider = mockProvider(['not json at all', goodOutput]);
    const result = await runCoverageAnalyst({
      report,
      provider,
      guards,
      guardState: newGuardState(),
      redacted: false,
      auditLog: new AuditLog(),
      now,
    });
    expect(result.skipped).toBe(false);
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it('skips after two malformed responses without breaking', async () => {
    const result = await runCoverageAnalyst({
      report,
      provider: mockProvider(['garbage', 'more garbage']),
      guards,
      guardState: newGuardState(),
      redacted: false,
      auditLog: new AuditLog(),
      now,
    });
    expect(result.skipped).toBe(true);
    expect(renderAnalystSection(result)).toContain('skipped');
  });

  it('redaction mode strips snippets from the prompt', async () => {
    const provider = mockProvider([goodOutput]);
    await runCoverageAnalyst({
      report,
      snippets: new Map([['src/a.ts', 'const SECRET_SOURCE = 42;']]),
      provider,
      guards,
      guardState: newGuardState(),
      redacted: true,
      auditLog: new AuditLog(),
      now,
    });
    const prompt = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(prompt).not.toContain('SECRET_SOURCE');
    expect(prompt).toContain('src/a.ts');
  });
});

describe('test-suggester', () => {
  const finding = { file: 'src/a.ts', lines: '4-9', risk: 'high' as const, reason: 'untested' };

  it('keeps validated suggestions and drops failures silently', async () => {
    const audit = new AuditLog();
    const result = await runTestSuggester({
      findings: [finding, { ...finding, file: 'src/b.ts' }],
      framework: 'vitest',
      provider: mockProvider(['it("works")', 'broken {{{']),
      guards,
      guardState: newGuardState(),
      auditLog: audit,
      validate: async (code) => !code.includes('broken'),
      now,
    });
    expect(result.suggestions).toHaveLength(1);
    expect(result.dropped).toBe(1);
    expect(audit.entries).toHaveLength(2); // dropped one still audited
  });

  it('caps at maxSuggestions', async () => {
    const provider = mockProvider(['ok']);
    await runTestSuggester({
      findings: Array.from({ length: 10 }, (_, i) => ({ ...finding, file: `f${i}.ts` })),
      framework: 'vitest',
      maxSuggestions: 3,
      provider,
      guards,
      guardState: newGuardState(),
      auditLog: new AuditLog(),
      validate: async () => true,
      now,
    });
    expect(provider.complete).toHaveBeenCalledTimes(3);
  });
});

describe('pr-risk-reviewer', () => {
  const aiSafe = JSON.stringify({ verdict: 'looks-safe', rationale: 'all good' });

  it('clamps looks-safe to review-carefully when the gate failed', async () => {
    const result = await runPrRiskReviewer({
      analystFindings: [],
      policy: failPolicy,
      provider: mockProvider([aiSafe]),
      guards,
      guardState: newGuardState(),
      auditLog: new AuditLog(),
      now,
    });
    expect(!result.skipped && result.output.verdict).toBe('review-carefully');
  });

  it('does not clamp when the gate passed', async () => {
    const result = await runPrRiskReviewer({
      analystFindings: [],
      policy: passPolicy,
      provider: mockProvider([aiSafe]),
      guards,
      guardState: newGuardState(),
      auditLog: new AuditLog(),
      now,
    });
    expect(!result.skipped && result.output.verdict).toBe('looks-safe');
  });

  it('blocking opt-in matrix: only review + ai-can-block may go neutral', () => {
    expect(checkRunConclusion('high-risk', { aiMode: 'off', aiCanBlock: true })).toBeNull();
    expect(checkRunConclusion('high-risk', { aiMode: 'comment', aiCanBlock: true })).toBeNull();
    expect(checkRunConclusion('high-risk', { aiMode: 'review', aiCanBlock: false })).toBeNull();
    expect(checkRunConclusion('high-risk', { aiMode: 'review', aiCanBlock: true })).toBe('neutral');
    expect(checkRunConclusion('looks-safe', { aiMode: 'review', aiCanBlock: true })).toBeNull();
  });

  it('renders the likely-cause box in tests-failed state', async () => {
    const withCause = JSON.stringify({
      verdict: 'review-carefully',
      rationale: 'failures look related',
      likelyCause: 'mock not reset between tests',
    });
    const result = await runPrRiskReviewer({
      analystFindings: [],
      policy: passPolicy,
      testFailures: { numFailedTests: 2, numTotalTests: 10, failedTests: [] },
      provider: mockProvider([withCause]),
      guards,
      guardState: newGuardState(),
      auditLog: new AuditLog(),
      now,
    });
    const section = renderReviewerSection(result, { testsFailed: true });
    expect(section).toContain('💡 **Likely cause (generated):**');
    expect(section).toContain('mock not reset');
  });
});

describe('audit log', () => {
  it('serializes totals and records', async () => {
    const audit = new AuditLog();
    await runCoverageAnalyst({
      report,
      provider: mockProvider([JSON.stringify({ summary: 's', findings: [] })]),
      guards,
      guardState: newGuardState(),
      redacted: false,
      auditLog: audit,
      now,
    });
    const parsed = JSON.parse(audit.toJson());
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.totals.inputTokens).toBe(100);
    expect(parsed.records[0].agent).toBe('coverage-analyst');
  });
});
