import { getOctokit } from '@actions/github';
import type { Annotation } from './annotations';
import { postCoverageCheckRun } from './checkRun';
import { upsertCoverageComment } from './github';

/**
 * Posts the rendered markdown as the single in-place PR comment (D5) and a
 * check run when requested — or whenever there are diff annotations to
 * publish (annotations only travel via the checks API).
 */
export async function postCoverageReport({
  token,
  owner,
  repo,
  prNumber,
  markdown,
  useCheckRun = false,
  conclusion = 'success',
  annotations = [],
}: {
  token: string;
  owner: string;
  repo: string;
  prNumber: number;
  markdown: string;
  useCheckRun?: boolean;
  conclusion?: 'success' | 'failure' | 'neutral';
  annotations?: Annotation[];
}): Promise<void> {
  const octokit = getOctokit(token);

  await upsertCoverageComment({
    octokit,
    owner,
    repo,
    prNumber,
    body: markdown,
  });

  if (useCheckRun || annotations.length > 0) {
    try {
      await postCoverageCheckRun({
        token,
        title: 'Coverage Report',
        summary: markdown,
        conclusion,
        annotations,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('⚠️ Failed to create check run:', message);
      console.warn('⚠️ Falling back to PR comment only');
    }
  }
}
