import * as cache from '@actions/cache';
import { getInput, info, setFailed, warning } from '@actions/core';
import { execSync } from 'child_process';
import { context, getOctokit } from '@actions/github';
import fs from 'fs';
import path from 'path';
import {
  applyInputOverrides,
  evaluatePolicy,
  loadConfig,
  relativizeModel,
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
import {
  badgeFiles,
  entriesToSeries,
  metricBandPath,
  readHistoryEntries,
  renderMetricBandSvg,
} from '@coverage-insight/history';
import { runAiSections } from './aiSections';
import { collectAnnotations, type AnnotationsMode } from './annotations';
import { publishBaseline } from './baseline/publish';
import { getMergeBaseSha, resolveBaseline } from './baseline/resolve';
import {
  BaselineOctokit,
  DEFAULT_BASELINE_BRANCH,
  cacheKey,
  readBranchFile,
} from './baseline/store';
import { readCoverageInput, relativizeSummary } from './mergeCoverage';
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
  const script = getInput('run-script');
  if (script) runScript(script);

  const githubToken = getInput('github-token', { required: true });
  const coveragePath = getInput('coverage') || getInput('head', { required: true });
  const branch = getInput('baseline-branch') || DEFAULT_BASELINE_BRANCH;

  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const summary = relativizeSummary(readCoverageInput(coveragePath), workspace);
  const octokit = getOctokit(githubToken) as unknown as BaselineOctokit;
  const { owner, repo } = context.repo;

  // regenerate badges (metric band light/dark, sparklines, shields endpoints)
  // from the history series including this run, committed in the same push
  let extraFiles: { path: string; content: string }[] = [];
  try {
    const existing = await readHistoryEntries((p) =>
      readBranchFile(octokit, { owner, repo, branch, path: p })
    );
    const timestamp = new Date().toISOString();
    const series = entriesToSeries([{ sha: context.sha, timestamp, summary }, ...existing]);
    extraFiles = [
      ...badgeFiles(series),
      { path: metricBandPath('light'), content: renderMetricBandSvg(series, 'light') },
      { path: metricBandPath('dark'), content: renderMetricBandSvg(series, 'dark') },
    ];
  } catch (error) {
    console.warn(`⚠️ Badge generation skipped: ${error}`);
  }

  const result = await publishBaseline({
    octokit,
    owner,
    repo,
    sha: context.sha,
    ref: context.ref,
    summary,
    branch,
    extraFiles,
  });

  console.log(
    `✅ Baseline ${result.entryPath} published to ${branch}` +
      (result.createdBranch ? ' (branch created)' : '') +
      (result.pruned.length > 0 ? `, pruned ${result.pruned.length} old entries` : '')
  );

  await saveBaselineToCache(summary, context.sha);
}

async function runReportMode(): Promise<void> {
  const script = getInput('run-script');
  const scriptExitCode = script ? runScript(script) : 0;

  const githubToken = getInput('github-token', { required: true });
  const basePath = getInput('base');
  const headPath = getInput('head', { required: true });
  const testFailuresPath = getInput('test-failures');
  const useCheckRun = getInput('use-check-run') === 'true';
  const baselineBranch = getInput('baseline-branch') || DEFAULT_BASELINE_BRANCH;
  const aiInput = getInput('ai') as Config['ai'] | '';
  const aiCanBlock = getInput('ai-can-block') === 'true';
  const annotationsMode = (getInput('annotations') || 'all') as AnnotationsMode;
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
    head = relativizeModel(summaryToModel(readCoverageInput(headPath)), workspace);
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
  // run-script failed but no failures file: still report failure mode (state 3)
  if (scriptExitCode !== 0 && (!testFailures || testFailures.numFailedTests === 0)) {
    testFailures = {
      numFailedTests: 1,
      numTotalTests: testFailures?.numTotalTests ?? 0,
      failedTests: [
        {
          testName: `Test run exited with code ${scriptExitCode} — see the CI log for details (provide the test-failures input for a per-test breakdown)`,
          filePath: script,
        },
      ],
    };
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
      base = relativizeModel(summaryToModel(summary), workspace);
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
          // older baselines may carry absolute runner paths — relativize both eras
          base = relativizeModel(
            summaryToModel(resolved.summary),
            process.env.GITHUB_WORKSPACE ?? workspace
          );
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

  // the PR's actual git diff — drives the "Files changed in this PR" table
  let touchedFiles: string[] | undefined;
  try {
    const filenames: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const { data } = await octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
        page,
      });
      filenames.push(...data.map((f) => f.filename));
      if (data.length < 100) break;
    }
    touchedFiles = filenames;
  } catch (error) {
    console.warn(`⚠️ Could not read the PR file list (changed-files table degraded): ${error}`);
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
        statements: point.metrics.statements,
        functions: point.metrics.functions,
        branches: point.metrics.branches,
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

  // visuals mode: config wins; 'auto' detects repo visibility — camo cannot
  // proxy authenticated raw URLs, so private repos get mermaid + unicode
  let visuals: 'images' | 'mermaid' | 'text' =
    config.visuals === 'auto' ? 'mermaid' : config.visuals;
  if (config.visuals === 'auto') {
    try {
      const { data } = await octokit.rest.repos.get({ owner, repo });
      visuals = data.private ? 'mermaid' : 'images';
    } catch {
      visuals = 'mermaid';
    }
  }
  const badgeImages =
    visuals === 'images' && history && history.length > 0
      ? {
          light: `https://raw.githubusercontent.com/${owner}/${repo}/${baselineBranch}/${metricBandPath('light')}`,
          dark: `https://raw.githubusercontent.com/${owner}/${repo}/${baselineBranch}/${metricBandPath('dark')}`,
        }
      : undefined;

  const report = buildReport({
    head: head ?? { total: emptyTotals(), files: [] },
    base,
    policy,
    policyMeta: describePolicy(config, loaded.source),
    testFailures,
    baseline,
    repo: { owner, repo },
    pr: { number: prNumber, headSha: context.payload.pull_request?.head?.sha },
    generatedAt: new Date().toISOString(),
    ...(touchedFiles ? { touchedFiles } : {}),
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

  const markdown = renderMarkdown(report, { visuals, badgeImages }) + ai.sections;

  const testsFailed = (testFailures?.numFailedTests ?? 0) > 0;
  let conclusion: 'success' | 'failure' | 'neutral' =
    policy.verdict === 'fail' || testsFailed || errors.length > 0
      ? 'failure'
      : policy.verdict === 'warn'
        ? 'neutral'
        : 'success';
  if (conclusion === 'success' && ai.conclusionOverride) {
    conclusion = ai.conclusionOverride;
  }

  const annotations = collectAnnotations({
    mode: annotationsMode,
    report,
    testFailures,
    workspace,
  });
  if (annotations.length > 0) {
    console.log(`🏷️ Publishing ${annotations.length} diff annotation(s) via the check run`);
  }

  await postCoverageReport({
    token: githubToken,
    owner,
    repo,
    prNumber,
    markdown,
    useCheckRun,
    conclusion,
    annotations,
  });

  console.log(`✅ Coverage report posted (state: ${report.state}, verdict: ${policy.verdict})`);

  if (testFailures && testFailures.numFailedTests > 0) {
    console.warn(`⚠️ ${testFailures.numFailedTests} tests failed`);
  }

  // failed tests and broken inputs always fail the job (blocks merge with
  // branch protection); the coverage gate fails it when thresholds are set
  if (testsFailed) {
    setFailed(`${testFailures!.numFailedTests} test(s) failed — see the PR comment`);
  } else if (errors.length > 0) {
    setFailed(
      `Coverage report error: ${errors.map((e) => e.input).join(', ')} — see the PR comment`
    );
  } else if (policy.verdict === 'fail' && policy.violations.length > 0) {
    setFailed(
      `Coverage gate failed: ${policy.violations.length} violation(s) — see the PR comment`
    );
  }
}

/** header context, e.g. 'min lines 90% · ratchet' + the config source */
function describePolicy(
  config: Config,
  source: string
): { description: string; source?: string; thresholds?: Config['thresholds'] } {
  const parts: string[] = [];
  const thresholds = Object.entries(config.thresholds ?? {});
  if (thresholds.length > 0) {
    parts.push(`min ${thresholds.map(([metric, pct]) => `${metric} ${pct}%`).join(', ')}`);
  }
  if (config.ratchet) parts.push('ratchet');
  if (parts.length === 0) parts.push('report-only');
  return {
    description: parts.join(' · '),
    ...(source !== 'defaults' ? { source: source.replace(/^file:/, '') } : {}),
    ...(config.thresholds ? { thresholds: config.thresholds } : {}),
  };
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

/** Run an arbitrary shell command, streaming its output to the action log. Returns the exit code. */
function runScript(script: string): number {
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  info(`▶ Running: ${script}`);
  try {
    execSync(script, { stdio: 'inherit', cwd: workspace });
    return 0;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException & { status?: number }).status ?? 1;
    warning(`run-script exited with code ${code} — posting coverage report anyway`);
    return code;
  }
}

run();
