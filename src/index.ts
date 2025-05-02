// src/index.ts
import { getInput } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import fs from "fs";
import path from "path";
import { formatCoverageMarkdown } from "./utils/formatMarkdown";
import { postCoverageCheckRun } from "./utils/checkRun";
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
    const markdown = formatCoverageMarkdown(rows, []);

    await postCoverageCheckRun({
      token: githubToken,
      title: "📊 Vite Coverage Report",
      summary: markdown,
    });
  } catch (error) {
    console.error("❌ Error generating coverage check run:", error);
  }
}

run();