// src/utils/github.ts
import type { GitHub } from "@actions/github/lib/utils";

export async function upsertCoverageComment({
  octokit,
  owner,
  repo,
  prNumber,
  body,
  botTag = "vite-pr-coverage-insight",
}: {
  octokit: InstanceType<typeof GitHub>;
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
  botTag?: string;
}) {
  const { data: comments } = await octokit.rest.issues.listComments({
    issue_number: prNumber,
    owner,
    repo,
  });

  const existing = comments.find((c) =>
    c.body?.includes(`Reported by **${botTag}**`)
  );

  const taggedBody = `<!-- coverage-report:${botTag} -->\n\n${body}\n\n_Reported by **${botTag}**_`;

  if (existing) {
    // ✅ Delete the old comment
    await octokit.rest.issues.deleteComment({
      owner,
      repo,
      comment_id: existing.id,
    });
  }
  
  // ✅ Create a fresh comment — this will appear at the latest commit
  await octokit.rest.issues.createComment({
    issue_number: prNumber,
    owner,
    repo,
    body: taggedBody,
  });
}
