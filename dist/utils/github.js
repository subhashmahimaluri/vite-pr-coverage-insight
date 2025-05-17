"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertCoverageComment = upsertCoverageComment;
async function upsertCoverageComment({ octokit, owner, repo, prNumber, body, botTag = "vite-pr-coverage-insight", }) {
    const { data: comments } = await octokit.rest.issues.listComments({
        issue_number: prNumber,
        owner,
        repo,
    });
    const existing = comments.find((c) => c.body?.includes(`Reported by **${botTag}**`));
    const taggedBody = `<!-- coverage-report:${botTag} -->\n\n${body}\n\n_Reported by **${botTag}**_`;
    if (existing) {
        await octokit.rest.issues.deleteComment({
            owner,
            repo,
            comment_id: existing.id,
        });
    }
    await octokit.rest.issues.createComment({
        issue_number: prNumber,
        owner,
        repo,
        body: taggedBody,
    });
}
