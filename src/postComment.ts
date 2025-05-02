import { context, getOctokit } from '@actions/github';

export async function postComment(token: string, body: string) {
  const octokit = getOctokit(token);
  const { owner, repo } = context.repo;
  const pull_number = context.payload.pull_request?.number;

  if (!pull_number) {
    console.error('No pull request number found');
    return;
  }

  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: pull_number,
    body,
  });
}