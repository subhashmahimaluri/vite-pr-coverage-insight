import * as cache from '@actions/cache';
import { getInput, setFailed } from '@actions/core';
import { context, getOctokit } from '@actions/github';
import fs from 'fs';
import path from 'path';
import {
  applyInputOverrides,
  evaluatePolicy,
  loadConfig,
  summaryToModel,
  type Config,
  type CoverageModel,
  type CoverageSummary,
  type PolicyResult,
  type TestFailuresResult,
} from '@coverage-insight/core';
import {
  buildProjectReports,
  buildReport,
  renderHtml,
  renderMarkdown,
  type BuildReportInput,
  type InputError,
} from '@coverage-insight/reporters';
import { entriesToSeries, readHistoryEntries } from '@coverage-insight/history';
import { runAiSections } from './aiSections';
import { publishBaseline } from './baseline/publish';
import { getMergeBaseSha, resolveBaseline } from './baseline/resolve';
import {
  BaselineOctokit,
  DEFAULT_BASELINE_BRANCH,
  cacheKey,
  readBranchFile,
} from './baseline/store';
import { readCoverageInput } from './mergeCoverage';
import { parseTestFailures } from './parseTestFailures';
import { postCoverageReport } from './postCoverageReport';

const CACHE_DIR = '.coverage-insight';
const REPORT_JSON = 'coverage-report.json';
const REPORT_HTML = 'coverage-report.html';
const AI_AUDIT = 'ai-audit.json';

/**
 * Entry point. Modes:
 *  - baseline (Stage 2.1): publish HEAD coverage to the baseline store
 *  - report (default): single-run pipeline — parse → resolve baseline →
 *    policy → versioned JSON artifact (D6, every state) → markdown comment
 *    updated in place (D5) → optional AI sections (D2)
 */
async function run() {
  try {
    const mode = getInput('mode') || 'report';
    if (mode === 'baseline') {
      await runBaselineMode();
    } else {
      await runReportMode();
    }
  } catch (error) {
    console.error('❌ An error occurred during action execution:', error);
    // workflow-level failure is driven by the policy verdict, not crashes
  }
}

async function runBaselineMode(): Promise<void> {
  const githubToken = getInput('github-token', { required: true });
  const coveragePath = getInput('coverage') || getInput('head', { required: true });
  const branch = getInput('baseline-branch') || DEFAULT_BASELINE_BRANCH;

  const summary = readCoverageInput(coveragePath);
  const octokit = getOctokit(githubToken) as unknown as BaselineOctokit;
  const { owner, repo } = context.repo;

  const result = await publishBaseline({
    octokit,
    owner,
    repo,
    sha: context.sha,
    ref: context.ref,
    summary,
    branch,
  });

  console.log(
    `✅ Baseline ${result.entryPath} published to ${branch}` +
      (result.createdBranch ? ' (branch created)' : '') +
      (result.pruned.length > 0 ? `, pruned ${result.pruned.length} old entries` : '')
  );

  await saveBaselineToCache(summary, context.sha);
}

async function runReportMode(): Promise<void> {
  const githubToken = getInput('github-token', { required: true });
  const basePath = getInput('base');
  const headPath = getInput('head', { required: true });
  const testFailuresPath = getInput('test-failures');
  const useCheckRun = getInput('use-check-run') === 'true';
  const baselineBranch = getInput('baseline-branch') || DEFAULT_BASELINE_BRANCH;
  const aiInput = getInput('ai') as Config['ai'] | '';
  const aiCanBlock = getInput('ai-can-block') === 'true';
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();

  const { owner, repo } = context.repo;
  const prNumber = context.payload.pull_request?.number;
  if (!prNumber) throw new Error('Pull request number not found');

  const octokit = getOctokit(githubToken) as unknown as BaselineOctokit;

  // config: file < action inputs (Stage 3.1 precedence)
  const loaded = await loadConfig(workspace);
  const config = applyInputOverrides(loaded.config, aiInput ? { ai: aiInput } : {});

  const errors: InputError[] = [];

  // head coverage (file, shard directory, or any supported format)
  let head: CoverageModel | null = null;
  try {
    head = summaryToModel(readCoverageInput(headPath));
  } catch (error) {
    errors.push({
      input: 'head',
      message: error instanceof Error ? error.message : String(error),
      hint: 'point `head` at a coverage-summary.json file or a directory of shard summaries',
    });
  }

  let testFailures: TestFailuresResult | null = null;
  if (testFailuresPath) {
    testFailures = parseTestFailures(path.resolve(testFailuresPath));
  }

  // base: explicit input (v1, D4) wins over the baseline store (Stage 2.2)
  let base: CoverageModel | null = null;
  let baseline: BuildReportInput['baseline'] = null;
  if (basePath) {
    try {
      const summary = JSON.parse(
        fs.readFileSync(path.resolve(basePath), 'utf-8')
      ) as CoverageSummary;
      if (!summary?.total) throw new Error("missing 'total' field");
      base = summaryToModel(summary);
      baseline = { sha: 'explicit', source: 'input', staleness: 0 };
    } catch (error) {
      errors.push({
        input: 'base',
        message: error instanceof Error ? error.message : String(error),
        hint: 'fix the `base` path, or omit it to auto-resolve from the baseline store',
      });
    }
  } else {
    const baseRef = context.payload.pull_request?.base?.ref as string | undefined;
    const headSha = context.payload.pull_request?.head?.sha as string | undefined;
    if (baseRef && headSha) {
      try {
        const mergeBaseSha = await getMergeBaseSha({ octokit, owner, repo, baseRef, headSha });
        const resolved = await resolveBaseline({
          octokit,
          owner,
          repo,
          mergeBaseSha,
          branch: baselineBranch,
          restoreCache: (sha) => restoreBaselineFromCache(sha),
        });
        if (resolved) {
          base = summaryToModel(resolved.summary);
          baseline = resolved.meta;
          console.log(
            `ℹ️ Baseline resolved via ${resolved.meta.source} (${resolved.meta.sha.slice(0, 7)}, staleness ${resolved.meta.staleness})`
          );
        }
      } catch (error) {
        console.warn(`⚠️ Baseline resolution failed, reporting without a base: ${error}`);
      }
    }
  }

  // trend history for the report/HTML (best effort)
  let history: BuildReportInput['history'];
  try {
    const entries = await readHistoryEntries((p) =>
      readBranchFile(octokit, { owner, repo, branch: baselineBranch, path: p })
    );
    if (entries.length > 0) {
      history = entriesToSeries(entries).map((point) => ({
        sha: point.sha,
        timestamp: point.timestamp,
        lines: point.metrics.lines,
      }));
    }
  } catch {
    // no history is fine
  }

  const policy: PolicyResult =
    head && errors.length === 0
      ? evaluatePolicy({ head, base, config })
      : { verdict: 'fail', violations: [] };

  // monorepo projects (Stage 6.3): per-project gates from config.projects
  let projects: BuildReportInput['projects'];
  if (head && config.projects?.length) {
    try {
      projects = buildProjectReports(
        config.projects.map((project) => ({
          name: project.name,
          path: project.path,
          head: summaryToModel(readCoverageInput(path.resolve(workspace, project.coverage))),
          thresholds: project.thresholds,
        })),
        config,
        base
      );
    } catch (error) {
      console.warn(`⚠️ Monorepo project reports skipped: ${error}`);
    }
  }

  const report = buildReport({
    head: head ?? { total: emptyTotals(), files: [] },
    base,
    policy,
    testFailures,
    baseline,
    repo: { owner, repo },
    pr: { number: prNumber, headSha: context.payload.pull_request?.head?.sha },
    generatedAt: new Date().toISOString(),
    ...(projects ? { projects } : {}),
    ...(errors.length > 0 ? { errors } : {}),
    ...(history ? { history } : {}),
  });

  // D6: the JSON artifact is emitted in EVERY state, plus the HTML twin
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(REPORT_HTML, renderHtml(report));
  console.log(`📄 Wrote ${REPORT_JSON} and ${REPORT_HTML} (state: ${report.state})`);

  // optional AI sections (D2: dynamic import, off by default)
  const ai = await runAiSections({
    report,
    policy,
    testFailures,
    config,
    aiCanBlock,
    workspace,
  });
  if (ai.auditJson) {
    fs.writeFileSync(AI_AUDIT, ai.auditJson);
  }

  const markdown = renderMarkdown(report) + ai.sections;

  let conclusion: 'success' | 'failure' | 'neutral' =
    policy.verdict === 'fail' ? 'failure' : policy.verdict === 'warn' ? 'neutral' : 'success';
  if (conclusion === 'success' && ai.conclusionOverride) {
    conclusion = ai.conclusionOverride;
  }

  await postCoverageReport({
    token: githubToken,
    owner,
    repo,
    prNumber,
    markdown,
    useCheckRun,
    conclusion,
  });

  console.log(`✅ Coverage report posted (state: ${report.state}, verdict: ${policy.verdict})`);

  if (testFailures && testFailures.numFailedTests > 0) {
    console.warn(`⚠️ ${testFailures.numFailedTests} tests failed`);
  }

  // the gate is opt-in: only configured thresholds/ratchet can fail the job
  if (policy.verdict === 'fail' && policy.violations.length > 0) {
    setFailed(
      `Coverage gate failed: ${policy.violations.length} violation(s) — see the PR comment`
    );
  }
}

function emptyTotals(): CoverageModel['total'] {
  const zero = { pct: 0, total: 0, covered: 0, skipped: 0 };
  return { statements: zero, branches: zero, functions: zero, lines: zero };
}

/** actions/cache wrappers — tolerate failure outside the Actions runtime (forks, local runs) */
async function saveBaselineToCache(summary: CoverageSummary, sha: string): Promise<void> {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const file = path.join(CACHE_DIR, 'baseline.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ sha, ref: context.ref, timestamp: new Date().toISOString(), summary })
    );
    await cache.saveCache([CACHE_DIR], cacheKey(sha));
    console.log(`✅ Baseline cached as ${cacheKey(sha)}`);
  } catch (error) {
    console.warn(`⚠️ Baseline cache save skipped: ${error}`);
  }
}

async function restoreBaselineFromCache(sha: string): Promise<string | null> {
  try {
    const hit = await cache.restoreCache([CACHE_DIR], cacheKey(sha));
    if (!hit) return null;
    const file = path.join(CACHE_DIR, 'baseline.json');
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file, 'utf-8');
  } catch (error) {
    console.warn(`⚠️ Baseline cache restore skipped: ${error}`);
    return null;
  }
}

run();
