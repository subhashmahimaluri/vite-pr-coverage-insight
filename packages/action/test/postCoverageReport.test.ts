import { beforeEach, describe, expect, it, vi } from 'vitest';

const octokit = {
  rest: {
    issues: {
      listComments: vi.fn(),
      createComment: vi.fn(),
      deleteComment: vi.fn(),
    },
    checks: {
      create: vi.fn(),
    },
  },
};

vi.mock('@actions/github', () => ({
  getOctokit: () => octokit,
  context: {
    repo: { owner: 'acme', repo: 'demo' },
    sha: 'fallback-sha',
    payload: { pull_request: { number: 42, head: { sha: 'head-sha' } } },
  },
}));

import { upsertCoverageComment } from '../src/github';
import { postCoverageReport } from '../src/postCoverageReport';

const baseArgs = {
  token: 't',
  owner: 'acme',
  repo: 'demo',
  prNumber: 42,
};

beforeEach(() => {
  vi.clearAllMocks();
  octokit.rest.issues.listComments.mockResolvedValue({ data: [] });
});

describe('upsertCoverageComment', () => {
  it('creates a tagged comment when none exists', async () => {
    await upsertCoverageComment({ octokit: octokit as never, ...baseArgs, body: 'report' });

    expect(octokit.rest.issues.deleteComment).not.toHaveBeenCalled();
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_number: 42,
        body: expect.stringContaining('<!-- coverage-report:vite-pr-coverage-insight -->'),
      })
    );
  });

  it('replaces the previous coverage comment instead of stacking', async () => {
    octokit.rest.issues.listComments.mockResolvedValue({
      data: [
        { id: 1, body: 'unrelated' },
        { id: 2, body: 'old report\n\n_Reported by **vite-pr-coverage-insight**_' },
      ],
    });

    await upsertCoverageComment({ octokit: octokit as never, ...baseArgs, body: 'new report' });

    expect(octokit.rest.issues.deleteComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 2 })
    );
    expect(octokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
  });
});

describe('postCoverageReport', () => {
  it('posts only a comment by default', async () => {
    await postCoverageReport({ ...baseArgs, markdown: 'report' });

    expect(octokit.rest.issues.createComment).toHaveBeenCalled();
    expect(octokit.rest.checks.create).not.toHaveBeenCalled();
  });

  it('creates a success check run when coverage held steady', async () => {
    await postCoverageReport({ ...baseArgs, markdown: 'all good ⬆️', useCheckRun: true });

    expect(octokit.rest.checks.create).toHaveBeenCalledWith(
      expect.objectContaining({ conclusion: 'success', head_sha: 'head-sha' })
    );
  });

  it('marks the check run neutral when coverage decreased', async () => {
    await postCoverageReport({ ...baseArgs, markdown: 'dropped ⬇️', useCheckRun: true });

    expect(octokit.rest.checks.create).toHaveBeenCalledWith(
      expect.objectContaining({ conclusion: 'neutral' })
    );
  });

  it('marks the check run failed when tests failed', async () => {
    await postCoverageReport({
      ...baseArgs,
      markdown: 'dropped ⬇️',
      useCheckRun: true,
      testFailures: { numFailedTests: 1, numTotalTests: 10, failedTests: [] },
    });

    expect(octokit.rest.checks.create).toHaveBeenCalledWith(
      expect.objectContaining({ conclusion: 'failure' })
    );
  });

  it('falls back to comment-only when the check run fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    octokit.rest.checks.create.mockRejectedValue(new Error('no permission'));

    await expect(
      postCoverageReport({ ...baseArgs, markdown: 'report', useCheckRun: true })
    ).resolves.toBeUndefined();

    expect(octokit.rest.issues.createComment).toHaveBeenCalled();
  });
});
