import { getOctokit, context } from "@actions/github";

type CheckRunOptions = {
  token: string;
  title: string;
  summary: string;
  conclusion?: "success" | "failure" | "neutral";
  name?: string;
};

export async function postCoverageCheckRun({
  token,
  title,
  summary,
  conclusion = "success",
  name = "📊 Vite Coverage Report",
}: CheckRunOptions): Promise<void> {
  const octokit = getOctokit(token);
  const { owner, repo } = context.repo;

  // Use pull request SHA if available, fallback to context.sha
  const head_sha =
    context.payload.pull_request?.head.sha || context.sha;

  try {
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

    console.log("✅ Coverage check run created successfully");
  } catch (error) {
    console.error("❌ Failed to create check run:", error);
    throw error;
  }
}
