import { getOctokit, context } from "@actions/github";
import { postCoverageCheckRun } from "./utils/checkRun";
import { upsertCoverageComment } from "./utils/github";

/**
 * Posts the coverage report to the PR as a comment and optionally as a check run
 * 
 * @param options Options for posting the coverage report
 */
export async function postCoverageReport({
  token,
  owner,
  repo,
  prNumber,
  markdown,
  useCheckRun = false
}: {
  token: string;
  owner: string;
  repo: string;
  prNumber: number;
  markdown: string;
  useCheckRun?: boolean;
}): Promise<void> {
  const octokit = getOctokit(token);
  
  // Post as a PR comment
  await upsertCoverageComment({
    octokit,
    owner,
    repo,
    prNumber,
    body: markdown,
  });

  // Optionally post as a check run
  if (useCheckRun) {
    await postCoverageCheckRun({
      token,
      title: "Coverage Report",
      summary: markdown,
      conclusion: markdown.includes("⬇️") ? "neutral" : "success",
    });
  }
}

// Re-export the utility functions
export {
  postCoverageCheckRun,
  upsertCoverageComment
};