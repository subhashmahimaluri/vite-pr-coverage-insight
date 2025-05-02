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

  const taggedBody = `${body}\n\n_Reported by **${botTag}**_`;

  if (existing) {
    await octokit.rest.issues.updateComment({
      comment_id: existing.id,
      owner,
      repo,
      body: taggedBody,
    });
  } else {
    await octokit.rest.issues.createComment({
      issue_number: prNumber,
      owner,
      repo,
      body: taggedBody,
    });
  }
}