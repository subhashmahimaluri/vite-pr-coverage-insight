// src/index.ts
import { getInput } from "@actions/core";
import { context } from "@actions/github";
import fs from "fs";
import path from "path";
import { CoverageSummary } from "./utils/compareCoverage";
import { generateCoverageReport } from "./formatCoverageMarkdown";
import { postCoverageReport } from "./postCoverageCheckRun";
import { parseTestFailures, TestFailuresResult } from "./utils/parseTestFailures";

/**
 * Main entry point for the GitHub Action
 * Reads coverage data, generates a report, and posts it to the PR
 */
async function run() {
  try {
    const githubToken = getInput("github-token", { required: true });
    const basePath = getInput("base", { required: true });
    const headPath = getInput("head", { required: true });
    const testFailuresPath = getInput("test-failures");
    const useCheckRun = getInput("use-check-run") === "true";

    // Read coverage data from files
    const baseJson = fs.readFileSync(path.resolve(basePath), "utf-8");
    const headJson = fs.readFileSync(path.resolve(headPath), "utf-8");

    const base: CoverageSummary = JSON.parse(baseJson) || {};
    const pr: CoverageSummary = JSON.parse(headJson) || {};
    
    // Ensure coverage data exists
    if (!base.total || !pr.total) {
      throw new Error("Invalid coverage data - missing 'total' field");
    }

    // Parse test failures if provided
    let testFailures: TestFailuresResult | null = null;
    if (testFailuresPath) {
      testFailures = parseTestFailures(path.resolve(testFailuresPath));
    }

    // Get PR information
    const { owner, repo } = context.repo;
    const prNumber = context.payload.pull_request?.number;

    if (!prNumber) throw new Error("Pull request number not found");

    // Generate the markdown report with PR information and test failures
    const markdown = generateCoverageReport(base, pr, testFailures, { owner, repo, prNumber }, !base.total || !pr.total);

    // Post the report to the PR
    await postCoverageReport({
      token: githubToken,
      owner,
      repo,
      prNumber,
      markdown,
      testFailures,
      useCheckRun
    });
    
    console.log("✅ Coverage report successfully posted to PR");
    
    // Log test failures but do not exit with an error code
    if (testFailures && testFailures.numFailedTests > 0) {
      console.warn(`⚠️ ${testFailures.numFailedTests} tests failed`);
    }

  } catch (error) {
    console.error("❌ An error occurred during action execution:", error);
    // Do not exit with 1 here, let the workflow handle the status based on coverage thresholds
  }
}

run();
