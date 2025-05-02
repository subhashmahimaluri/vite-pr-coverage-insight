import { getInput } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import fs from "fs";
import path from "path";
import { formatCoverageMarkdown } from "./utils/formatMarkdown";
import { postCoverageCheckRun } from "./utils/github";
import { compareCoverage, CoverageSummary } from "./utils/compareCoverage";

async function run() {
  try {
    const githubToken = getInput("github-token", { required: true });
    const basePath = getInput("base", { required: true });
    const headPath = getInput("head", { required: true });

    const baseJson = fs.readFileSync(path.resolve(basePath), "utf-8");
    const headJson = fs.readFileSync(path.resolve(headPath), "utf-8");

    const base: CoverageSummary = JSON.parse(baseJson);
    const pr: CoverageSummary = JSON.parse(headJson);

    const rows = compareCoverage(base, pr);

    const markdown = formatCoverageMarkdown(rows, []); // placeholder for reduced file deltas

    const octokit = getOctokit(githubToken);
    const { owner, repo } = context.repo;
    const prNumber = context.payload.pull_request?.number;

    if (!prNumber) throw new Error("Pull request number not found");

    await postCoverageCheckRun({
      token: process.env.GITHUB_TOKEN!,
      title: "📊 Vite Coverage Report",
      summary: markdown, // from formatCoverageMarkdown(...)
    });
    
  } catch (error) {
    console.error("❌ Error generating coverage comment:", error);
  }
}

run();
