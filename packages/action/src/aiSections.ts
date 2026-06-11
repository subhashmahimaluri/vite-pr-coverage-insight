import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type {
  Config,
  CoverageReport,
  PolicyResult,
  TestFailuresResult,
} from '@coverage-insight/core';

/**
 * Phase 5 wiring. @coverage-insight/agents is loaded with a dynamic import
 * ONLY when ai !== 'off' (decision D2): with AI off there is zero non-GitHub
 * network traffic and the report is byte-identical.
 */

export type AiOutcome = {
  sections: string;
  auditJson: string | null;
  /** non-null only under the double opt-in (ai: 'review' + ai-can-block) */
  conclusionOverride: 'neutral' | null;
};

const SNIPPET_CONTEXT_LINES = 40;

function collectSnippets(report: CoverageReport, workspace: string): Map<string, string> {
  const snippets = new Map<string, string>();
  for (const file of report.files ?? []) {
    if (file.change === 'unchanged' || !file.uncoveredRanges?.length) continue;
    const abs = path.resolve(workspace, file.path.replace(/^\//, ''));
    if (!fs.existsSync(abs)) continue;
    const lines = fs.readFileSync(abs, 'utf-8').split('\n');
    const first = file.uncoveredRanges[0];
    const start = Math.max(0, first.start - 1 - SNIPPET_CONTEXT_LINES / 2);
    snippets.set(file.path, lines.slice(start, start + SNIPPET_CONTEXT_LINES).join('\n'));
  }
  return snippets;
}

function detectFramework(workspace: string): 'vitest' | 'jest' {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.jest && !deps.vitest) return 'jest';
  } catch {
    // default below
  }
  return 'vitest';
}

function tscValidate(code: string): boolean {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'covins-suggest-')),
    'suggestion.test.ts'
  );
  try {
    fs.writeFileSync(file, code);
    execFileSync('npx', ['--no-install', 'tsc', '--noEmit', '--skipLibCheck', file], {
      stdio: 'ignore',
      timeout: 30_000,
    });
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
}

export async function runAiSections(params: {
  report: CoverageReport;
  policy: PolicyResult;
  testFailures: TestFailuresResult | null;
  config: Config;
  aiCanBlock: boolean;
  workspace: string;
}): Promise<AiOutcome> {
  const { report, policy, testFailures, config } = params;
  const none: AiOutcome = { sections: '', auditJson: null, conclusionOverride: null };
  if (config.ai === 'off') return none;

  let agents: typeof import('@coverage-insight/agents');
  try {
    agents = await import('@coverage-insight/agents');
  } catch (error) {
    console.warn(
      `⚠️ ai: '${config.ai}' configured but @coverage-insight/agents is unavailable: ${error}`
    );
    return none;
  }

  try {
    const provider = agents.selectProvider(process.env);
    const guards = {
      maxTokensPerRun: Number(process.env.AI_MAX_TOKENS ?? 50_000),
      maxEstimatedCostUsd: Number(process.env.AI_MAX_COST_USD ?? 0.5),
      timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 60_000),
    };
    const guardState = agents.newGuardState();
    const auditLog = new agents.AuditLog();
    const now = () => new Date().toISOString();
    const redacted = (config as { aiRedact?: boolean }).aiRedact ?? false;

    const analyst = await agents.runCoverageAnalyst({
      report,
      snippets: redacted ? undefined : collectSnippets(report, params.workspace),
      provider,
      guards,
      guardState,
      redacted,
      auditLog,
      now,
    });

    let sections = agents.renderAnalystSection(analyst);

    if (!analyst.skipped && analyst.output.findings.length > 0) {
      const suggester = await agents.runTestSuggester({
        findings: analyst.output.findings,
        framework: detectFramework(params.workspace),
        provider,
        guards,
        guardState,
        auditLog,
        validate: async (code) => tscValidate(code),
        now,
      });
      sections += agents.renderSuggesterSection(suggester);
    }

    let conclusionOverride: 'neutral' | null = null;
    if (config.ai === 'review') {
      const review = await agents.runPrRiskReviewer({
        analystFindings: analyst.skipped ? [] : analyst.output.findings,
        policy,
        testFailures,
        provider,
        guards,
        guardState,
        auditLog,
        now,
      });
      sections += agents.renderReviewerSection(review, {
        testsFailed: (testFailures?.numFailedTests ?? 0) > 0,
      });
      if (!review.skipped) {
        conclusionOverride = agents.checkRunConclusion(review.output.verdict, {
          aiMode: config.ai,
          aiCanBlock: params.aiCanBlock,
        });
      }
    }

    return { sections, auditJson: auditLog.toJson(), conclusionOverride };
  } catch (error) {
    console.warn(`⚠️ AI sections skipped: ${error}`);
    return none;
  }
}
