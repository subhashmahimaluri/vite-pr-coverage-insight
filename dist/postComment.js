"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.postComment = postComment;
const github_1 = require("@actions/github");
async function postComment(token, body) {
    const octokit = (0, github_1.getOctokit)(token);
    const { owner, repo } = github_1.context.repo;
    const pull_number = github_1.context.payload.pull_request?.number;
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
