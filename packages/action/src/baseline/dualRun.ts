import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { CoverageSummary } from '@coverage-insight/core';
import { readCoverageInput, relativizeSummary } from '../mergeCoverage';

/**
 * Dual-run mode (`baseline-mode: scan`): materialize the PR's merge-base in a
 * temp git worktree, run the test suite there, and read its coverage — no
 * baseline branch or history required. Costs a second test run; the recorded
 * baseline stays the fast path. Requires the merge-base commit to be fetched
 * (actions/checkout with `fetch-depth: 0`).
 */
export function coverageFromMergeBase(params: {
  workspace: string;
  mergeBaseSha: string;
  /** the command that produces coverage (the action's run-script / base-run-script) */
  script: string;
  /** coverage path relative to the checkout, e.g. coverage/coverage-summary.json */
  coveragePath: string;
  timeoutMs?: number;
}): CoverageSummary | null {
  const { workspace, mergeBaseSha, script, coveragePath } = params;

  const probe = spawnSync('git', ['cat-file', '-e', `${mergeBaseSha}^{commit}`], {
    cwd: workspace,
  });
  if (probe.status !== 0) return null;

  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'covins-base-'));
  try {
    const add = spawnSync(
      'git',
      ['worktree', 'add', '--detach', '--force', worktree, mergeBaseSha],
      { cwd: workspace, encoding: 'utf-8' }
    );
    if (add.status !== 0) {
      throw new Error(`git worktree add failed: ${(add.stderr ?? '').slice(0, 300)}`);
    }

    console.log(`▶ Running on merge-base ${mergeBaseSha.slice(0, 7)}: ${script}`);
    const run = spawnSync(script, {
      shell: true,
      cwd: worktree,
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: params.timeoutMs ?? 20 * 60 * 1000,
      env: process.env,
    });
    if (run.status !== 0) {
      // base tests failing is not the PR's fault — log the tail and move on
      const tail = `${run.stdout ?? ''}${run.stderr ?? ''}`.split('\n').slice(-15).join('\n');
      console.warn(
        `⚠️ Merge-base test run exited with code ${run.status} — using its coverage if present.\n${tail}`
      );
    }

    const summary = readCoverageInput(path.resolve(worktree, coveragePath));
    return relativizeSummary(summary, worktree);
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: workspace });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
}
