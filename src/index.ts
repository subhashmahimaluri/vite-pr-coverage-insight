// src/index.ts
import { getInput } from "@actions/core";
import { context } from "@actions/github";
import fs from "fs";
import path from "path";
import { CoverageSummary } from "./utils/compareCoverage";
import { generateCoverageReport } from "./formatCoverageMarkdown";
import { postCoverageReport } from "./postCoverageCheckRun";

/**
 * Main entry point for the GitHub Action
 * Reads coverage data, generates a report, and posts it to the PR
 */
async function run() {
  try {
    const githubToken = getInput("github-token", { required: true });
    const basePath = getInput("base", { required: true });
    const headPath = getInput("head", { required: true });
    const useCheckRun = getInput("use-check-run") === "true";

    // Read coverage data from files
    const baseJson = fs.readFileSync(path.resolve(basePath), "utf-8");
    const headJson = fs.readFileSync(path.resolve(headPath), "utf-8");

    const base: CoverageSummary = JSON.parse(baseJson);
    const pr: CoverageSummary = JSON.parse(headJson);

    // Generate the markdown report
    const markdown = generateCoverageReport(base, pr);

    // Get PR information
    const { owner, repo } = context.repo;
    const prNumber = context.payload.pull_request?.number;

    if (!prNumber) throw new Error("Pull request number not found");

    // Post the report to the PR
    await postCoverageReport({
      token: githubToken,
      owner,
      repo,
      prNumber,
      markdown,
      useCheckRun
    });
    
    console.log("✅ Coverage report successfully posted to PR");
  } catch (error) {
    console.error("❌ Error generating coverage comment:", error);
  }
}

run();
