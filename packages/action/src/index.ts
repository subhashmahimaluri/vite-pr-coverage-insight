import { getInput } from '@actions/core';
import { context, getOctokit } from '@actions/github';
import fs from 'fs';
import path from 'path';
import {
  CoverageSummary,
  TestFailuresResult,
  generateCoverageReport,
} from '@coverage-insight/core';
import { publishBaseline } from './baseline/publish';
import { getMergeBaseSha, resolveBaseline } from './baseline/resolve';
import { BaselineOctokit, DEFAULT_BASELINE_BRANCH, cacheKey } from './baseline/store';
import { readCoverageInput } from './mergeCoverage';
import { formatNoBaselineMarkdown, stalenessNote } from './noBaselineReport';
import { parseTestFailures } from './parseTestFailures';
import { postCoverageReport } from './postCoverageReport';

const CACHE_DIR = '.coverage-insight';

/**
 * Main entry point. Two modes (Stage 2.1/2.2):
 *  - mode: baseline — publish HEAD coverage to the baseline store (main pushes)
 *  - mode: report (default) — diff against an explicit base input (v1, D4) or
 *    the auto-resolved baseline, and post the PR comment
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
    // Do not exit with 1 here, let the workflow handle the status based on coverage thresholds
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

  const pr: CoverageSummary = readCoverageInput(headPath) || ({} as CoverageSummary);

  let testFailures: TestFailuresResult | null = null;
  if (testFailuresPath) {
    testFailures = parseTestFailures(path.resolve(testFailuresPath));
  }

  const { owner, repo } = context.repo;
  const prNumber = context.payload.pull_request?.number;
  if (!prNumber) throw new Error('Pull request number not found');

  const octokit = getOctokit(githubToken) as unknown as BaselineOctokit;

  // Resolve the base: explicit input (v1 behavior, D4) wins over the store
  let base: CoverageSummary | null = null;
  let baselineNote = '';
  let mergeBaseSha: string | undefined;

  if (basePath) {
    base = JSON.parse(fs.readFileSync(path.resolve(basePath), 'utf-8')) || {};
  } else {
    const baseRef = context.payload.pull_request?.base?.ref as string | undefined;
    const headSha = context.payload.pull_request?.head?.sha as string | undefined;
    if (baseRef && headSha) {
      mergeBaseSha = await getMergeBaseSha({ octokit, owner, repo, baseRef, headSha });
      const resolved = await resolveBaseline({
        octokit,
        owner,
        repo,
        mergeBaseSha,
        branch: baselineBranch,
        restoreCache: (sha) => restoreBaselineFromCache(sha),
      });
      if (resolved) {
        base = resolved.summary;
        console.log(
          `ℹ️ Baseline resolved via ${resolved.meta.source} (${resolved.meta.sha.slice(0, 7)}, staleness ${resolved.meta.staleness})`
        );
        if (resolved.meta.staleness > 0) {
          baselineNote = stalenessNote(resolved.meta.sha, resolved.meta.staleness);
        }
      }
    }
  }

  // No baseline anywhere → state 5: absolute numbers only
  if (!base) {
    const markdown = formatNoBaselineMarkdown(pr, mergeBaseSha);
    await postCoverageReport({
      token: githubToken,
      owner,
      repo,
      prNumber,
      markdown,
      testFailures,
      useCheckRun,
    });
    console.log('✅ No-baseline report posted to PR');
    return;
  }

  // Handle missing coverage data
  if (!base.total || !pr.total) {
    const markdown =
      `## ❌ Coverage Report Error\n\n` +
      `Invalid coverage data - missing 'total' field\n\n` +
      `Base coverage: ${base ? 'exists' : 'missing'}\n` +
      `PR coverage: ${pr ? 'exists' : 'missing'}`;

    await postCoverageReport({
      token: githubToken,
      owner,
      repo,
      prNumber,
      markdown,
      testFailures,
      useCheckRun,
    });
    return;
  }

  const markdown =
    generateCoverageReport(base, pr, testFailures, { owner, repo, prNumber }) + baselineNote;

  await postCoverageReport({
    token: githubToken,
    owner,
    repo,
    prNumber,
    markdown,
    testFailures,
    useCheckRun,
  });

  console.log('✅ Coverage report successfully posted to PR');

  if (testFailures && testFailures.numFailedTests > 0) {
    console.warn(`⚠️ ${testFailures.numFailedTests} tests failed`);
  }
}

/** actions/cache wrappers — tolerate failure outside the Actions runtime (forks, local runs) */
async function saveBaselineToCache(summary: CoverageSummary, sha: string): Promise<void> {
  try {
    const cache = await import('@actions/cache');
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
    const cache = await import('@actions/cache');
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
