import type { GitHub } from '@actions/github/lib/utils';

/** D5 marker — the markdown renderer emits it as the first line. */
export const COMMENT_MARKER = '<!-- coverage-insight -->';
/** v1 marker, still recognized so upgrades replace the old comment in place. */
const LEGACY_TAG = 'Reported by **vite-pr-coverage-insight**';

/**
 * One comment per PR, updated in place (decision D5) — never stacks, never
 * delete+recreate (which re-notifies subscribers and moves the comment).
 */
export async function upsertCoverageComment({
  octokit,
  owner,
  repo,
  prNumber,
  body,
}: {
  octokit: InstanceType<typeof GitHub>;
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
}) {
  const { data: comments } = await octokit.rest.issues.listComments({
    issue_number: prNumber,
    owner,
    repo,
  });

  const existing = comments.find(
    (c: { id: number; body?: string }) =>
      c.body?.includes(COMMENT_MARKER) || c.body?.includes(LEGACY_TAG)
  );

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
  } else {
    await octokit.rest.issues.createComment({
      issue_number: prNumber,
      owner,
      repo,
      body,
    });
  }
}
