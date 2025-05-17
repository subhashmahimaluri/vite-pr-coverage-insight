"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.postCoverageCheckRun = postCoverageCheckRun;
const github_1 = require("@actions/github");
async function postCoverageCheckRun({ token, title, summary, conclusion = "success", name = "📊 Vite Coverage Report", }) {
    const octokit = (0, github_1.getOctokit)(token);
    const { owner, repo } = github_1.context.repo;
    const head_sha = github_1.context.payload.pull_request?.head.sha || github_1.context.sha;
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
