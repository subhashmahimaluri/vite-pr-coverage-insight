import { getOctokit, context } from '@actions/github';
import { ANNOTATIONS_PER_REQUEST, chunkAnnotations, type Annotation } from './annotations';

/**
 * Posts a coverage report as a GitHub check run, attaching diff annotations
 * in chunks of 50 (the API limit per request): the first chunk rides the
 * create call, the rest follow as updates to the same check run.
 */
export async function postCoverageCheckRun({
  token,
  title,
  summary,
  conclusion = 'success',
  name = '📊 Coverage Report',
  annotations = [],
}: {
  token: string;
  title: string;
  summary: string;
  conclusion?: 'success' | 'failure' | 'neutral';
  name?: string;
  annotations?: Annotation[];
}): Promise<void> {
  const octokit = getOctokit(token);
  const { owner, repo } = context.repo;
  const head_sha = context.payload.pull_request?.head.sha || context.sha;

  const chunks = chunkAnnotations(annotations);
  const [firstChunk, ...rest] = chunks;

  const { data: checkRun } = await octokit.rest.checks.create({
    owner,
    repo,
    name,
    head_sha,
    status: 'completed',
    conclusion,
    output: {
      title,
      summary,
      ...(firstChunk && firstChunk.length > 0 ? { annotations: firstChunk } : {}),
    },
  });

  for (const chunk of rest) {
    if (chunk.length > ANNOTATIONS_PER_REQUEST) continue; // defensive, never true
    await octokit.rest.checks.update({
      owner,
      repo,
      check_run_id: checkRun.id,
      output: { title, summary, annotations: chunk },
    });
  }
}
