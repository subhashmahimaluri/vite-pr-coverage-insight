import { getOctokit } from '@actions/github';
import { postCoverageCheckRun } from './checkRun';
import { upsertCoverageComment } from './github';

/**
 * Posts the rendered markdown as the single in-place PR comment (D5) and
 * optionally as a check run whose conclusion the caller derives from the
 * policy verdict (and, under double opt-in, the AI reviewer).
 */
export async function postCoverageReport({
  token,
  owner,
  repo,
  prNumber,
  markdown,
  useCheckRun = false,
  conclusion = 'success',
}: {
  token: string;
  owner: string;
  repo: string;
  prNumber: number;
  markdown: string;
  useCheckRun?: boolean;
  conclusion?: 'success' | 'failure' | 'neutral';
}): Promise<void> {
  const octokit = getOctokit(token);

  await upsertCoverageComment({
    octokit,
    owner,
    repo,
    prNumber,
    body: markdown,
  });

  if (useCheckRun) {
    try {
      await postCoverageCheckRun({
        token,
        title: 'Coverage Report',
        summary: markdown,
        conclusion,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('⚠️ Failed to create check run:', message);
      console.warn('⚠️ Falling back to PR comment only');
    }
  }
}
