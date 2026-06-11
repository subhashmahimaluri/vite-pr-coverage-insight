import type { CoverageSummary } from '@coverage-insight/core';

export const DEFAULT_BASELINE_BRANCH = 'coverage-baseline';
export const DEFAULT_MAX_ENTRIES = 200;

export type BaselineEntry = {
  sha: string;
  ref: string;
  timestamp: string;
  summary: CoverageSummary;
};

export type BaselineIndex = {
  /** newest first */
  entries: { sha: string; timestamp: string }[];
};

export function baselinePath(sha: string): string {
  return `baselines/${sha}.json`;
}

export function cacheKey(sha: string): string {
  return `covins-baseline-${sha}`;
}

/**
 * Minimal structural slice of octokit used by the baseline store, so tests can
 * mock it without dragging in @actions/github types.
 */
export type BaselineOctokit = {
  rest: {
    git: {
      getRef(p: { owner: string; repo: string; ref: string }): Promise<{
        data: { object: { sha: string } };
      }>;
      getCommit(p: { owner: string; repo: string; commit_sha: string }): Promise<{
        data: { tree: { sha: string } };
      }>;
      createTree(p: {
        owner: string;
        repo: string;
        base_tree?: string;
        tree: {
          path: string;
          mode: '100644';
          type: 'blob';
          content?: string;
          sha?: string | null;
        }[];
      }): Promise<{ data: { sha: string } }>;
      createCommit(p: {
        owner: string;
        repo: string;
        message: string;
        tree: string;
        parents: string[];
      }): Promise<{ data: { sha: string } }>;
      createRef(p: { owner: string; repo: string; ref: string; sha: string }): Promise<unknown>;
      updateRef(p: {
        owner: string;
        repo: string;
        ref: string;
        sha: string;
        force?: boolean;
      }): Promise<unknown>;
    };
    repos: {
      getContent(p: { owner: string; repo: string; path: string; ref: string }): Promise<{
        data: unknown;
      }>;
      listCommits(p: { owner: string; repo: string; sha: string; per_page: number }): Promise<{
        data: { sha: string }[];
      }>;
      compareCommitsWithBasehead(p: { owner: string; repo: string; basehead: string }): Promise<{
        data: { merge_base_commit: { sha: string } };
      }>;
    };
  };
};

export function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: unknown }).status === 404
  );
}

/** Reads and base64-decodes a file from a branch via the contents API; null when missing. */
export async function readBranchFile(
  octokit: BaselineOctokit,
  params: { owner: string; repo: string; branch: string; path: string }
): Promise<string | null> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: params.owner,
      repo: params.repo,
      path: params.path,
      ref: params.branch,
    });
    const content = (data as { content?: string; encoding?: string }).content;
    if (!content) return null;
    return Buffer.from(content, 'base64').toString('utf-8');
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}
