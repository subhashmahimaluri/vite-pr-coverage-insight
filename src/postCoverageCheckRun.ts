import { getOctokit, context } from "@actions/github";
import { postCoverageCheckRun } from "./utils/checkRun";
import { upsertCoverageComment } from "./utils/github";
import { TestFailuresResult } from "./utils/parseTestFailures";

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
  testFailures,
  useCheckRun = false
}: {
  token: string;
  owner: string;
  repo: string;
  prNumber: number;
  markdown: string;
  testFailures?: TestFailuresResult | null;
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
    try {
      // Determine conclusion based on coverage and test failures
      let conclusion: "success" | "failure" | "neutral" = "success";
      
      // If coverage decreased, set to neutral
      if (markdown.includes("⬇️")) {
        conclusion = "neutral";
      }
      
      // If tests failed, set to failure
      if (testFailures && testFailures.numFailedTests > 0) {
        conclusion = "failure";
      }
      
      await postCoverageCheckRun({
        token,
        title: "Coverage Report",
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

// Re-export the utility functions
export {
  postCoverageCheckRun,
  upsertCoverageComment
};