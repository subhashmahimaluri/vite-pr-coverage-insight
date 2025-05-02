import { getOctokit, context } from "@actions/github";

export async function postCoverageCheckRun({
  token,
  title,
  summary,
  conclusion = "success",
  name = "📊 Vite Coverage Report",
}: {
  token: string;
  title: string;
  summary: string;
  conclusion?: "success" | "failure" | "neutral";
  name?: string;
}): Promise<void> {
  const octokit = getOctokit(token);
  const { owner, repo } = context.repo;
  const head_sha = context.payload.pull_request?.head.sha || context.sha;

  await octokit.rest.checks.create({
    owner,
    repo,
    name,
    head_sha,
    status: "completed",
    conclusion,
    output: {
      title,
      summary,
    },
  });
}