import { beforeEach, describe, expect, it, vi } from 'vitest';

const octokit = {
  rest: {
    issues: {
      listComments: vi.fn(),
      createComment: vi.fn(),
      updateComment: vi.fn(),
    },
    checks: {
      create: vi.fn().mockResolvedValue({ data: { id: 9 } }),
      update: vi.fn(),
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

import { COMMENT_MARKER, upsertCoverageComment } from '../src/github';
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
  octokit.rest.checks.create.mockResolvedValue({ data: { id: 9 } });
});

function annotation(i: number) {
  return {
    path: `src/f${i}.ts`,
    start_line: 1,
    end_line: 1,
    annotation_level: 'warning' as const,
    message: 'not covered',
  };
}

describe('upsertCoverageComment (D5: one comment, updated in place)', () => {
  it('creates the comment when none exists', async () => {
    await upsertCoverageComment({
      octokit: octokit as never,
      ...baseArgs,
      body: `${COMMENT_MARKER}\nreport`,
    });

    expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled();
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 42, body: expect.stringContaining(COMMENT_MARKER) })
    );
  });

  it('updates the existing marked comment in place — never stacks or recreates', async () => {
    octokit.rest.issues.listComments.mockResolvedValue({
      data: [
        { id: 1, body: 'unrelated' },
        { id: 2, body: `${COMMENT_MARKER}\nold report` },
      ],
    });

    await upsertCoverageComment({
      octokit: octokit as never,
      ...baseArgs,
      body: `${COMMENT_MARKER}\nnew report`,
    });

    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 2, body: expect.stringContaining('new report') })
    );
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it('replaces a legacy v1 comment in place on upgrade', async () => {
    octokit.rest.issues.listComments.mockResolvedValue({
      data: [{ id: 7, body: 'old\n\n_Reported by **vite-pr-coverage-insight**_' }],
    });

    await upsertCoverageComment({
      octokit: octokit as never,
      ...baseArgs,
      body: `${COMMENT_MARKER}\nv2 report`,
    });

    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 7 })
    );
  });
});

describe('postCoverageReport', () => {
  it('posts only a comment by default', async () => {
    await postCoverageReport({ ...baseArgs, markdown: 'report' });

    expect(octokit.rest.issues.createComment).toHaveBeenCalled();
    expect(octokit.rest.checks.create).not.toHaveBeenCalled();
  });

  it('passes the caller-derived conclusion to the check run', async () => {
    for (const conclusion of ['success', 'failure', 'neutral'] as const) {
      await postCoverageReport({ ...baseArgs, markdown: 'r', useCheckRun: true, conclusion });
      expect(octokit.rest.checks.create).toHaveBeenCalledWith(
        expect.objectContaining({ conclusion, head_sha: 'head-sha' })
      );
    }
  });

  it('annotations force a check run even without use-check-run', async () => {
    await postCoverageReport({ ...baseArgs, markdown: 'r', annotations: [annotation(1)] });

    expect(octokit.rest.checks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({ annotations: [annotation(1)] }),
      })
    );
    expect(octokit.rest.checks.update).not.toHaveBeenCalled();
  });

  it('publishes >50 annotations in chunks via checks.update', async () => {
    const annotations = Array.from({ length: 120 }, (_, i) => annotation(i));
    await postCoverageReport({ ...baseArgs, markdown: 'r', useCheckRun: true, annotations });

    const created = octokit.rest.checks.create.mock.calls[0][0];
    expect(created.output.annotations).toHaveLength(50);
    expect(octokit.rest.checks.update).toHaveBeenCalledTimes(2);
    expect(octokit.rest.checks.update.mock.calls[0][0]).toMatchObject({ check_run_id: 9 });
    expect(octokit.rest.checks.update.mock.calls[1][0].output.annotations).toHaveLength(20);
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
