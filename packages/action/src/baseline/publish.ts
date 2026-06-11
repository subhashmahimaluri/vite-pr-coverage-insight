import type { CoverageSummary } from '@coverage-insight/core';
import {
  BaselineEntry,
  BaselineIndex,
  BaselineOctokit,
  DEFAULT_BASELINE_BRANCH,
  DEFAULT_MAX_ENTRIES,
  baselinePath,
  isNotFound,
  readBranchFile,
} from './store';

export type PublishResult = {
  /** true when the baseline branch was created by this run */
  createdBranch: boolean;
  /** SHAs whose baseline files were pruned */
  pruned: string[];
  entryPath: string;
};

/**
 * Commits {sha, ref, timestamp, summary} to the orphan baseline branch as
 * baselines/<sha>.json, maintains a newest-first index.json, and prunes to the
 * newest maxEntries entries (Stage 2.1).
 */
export async function publishBaseline(params: {
  octokit: BaselineOctokit;
  owner: string;
  repo: string;
  sha: string;
  ref: string;
  summary: CoverageSummary;
  branch?: string;
  maxEntries?: number;
  timestamp?: string;
}): Promise<PublishResult> {
  const {
    octokit,
    owner,
    repo,
    sha,
    ref,
    summary,
    branch = DEFAULT_BASELINE_BRANCH,
    maxEntries = DEFAULT_MAX_ENTRIES,
    timestamp = new Date().toISOString(),
  } = params;

  // Locate the current tip of the baseline branch, if it exists
  let tipSha: string | null = null;
  try {
    const { data } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    tipSha = data.object.sha;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  // Current index (newest first); tolerate a missing/corrupt index
  let index: BaselineIndex = { entries: [] };
  if (tipSha) {
    const raw = await readBranchFile(octokit, { owner, repo, branch, path: 'index.json' });
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as BaselineIndex;
        if (Array.isArray(parsed.entries)) index = parsed;
      } catch {
        // rebuild the index from scratch on corruption
      }
    }
  }

  const kept = [{ sha, timestamp }, ...index.entries.filter((e) => e.sha !== sha)].slice(
    0,
    maxEntries
  );
  const keptShas = new Set(kept.map((e) => e.sha));
  const pruned = index.entries.filter((e) => !keptShas.has(e.sha)).map((e) => e.sha);

  const entry: BaselineEntry = { sha, ref, timestamp, summary };

  const tree: Parameters<BaselineOctokit['rest']['git']['createTree']>[0]['tree'] = [
    {
      path: baselinePath(sha),
      mode: '100644',
      type: 'blob',
      content: JSON.stringify(entry),
    },
    {
      path: 'index.json',
      mode: '100644',
      type: 'blob',
      content: JSON.stringify({ entries: kept }, null, 2),
    },
    // deleting pruned baselines = tree entry with sha: null against base_tree
    ...pruned.map((p) => ({
      path: baselinePath(p),
      mode: '100644' as const,
      type: 'blob' as const,
      sha: null,
    })),
  ];

  let baseTree: string | undefined;
  if (tipSha) {
    const { data } = await octokit.rest.git.getCommit({ owner, repo, commit_sha: tipSha });
    baseTree = data.tree.sha;
  }

  const { data: newTree } = await octokit.rest.git.createTree({
    owner,
    repo,
    ...(baseTree ? { base_tree: baseTree } : {}),
    tree,
  });

  const { data: commit } = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: `coverage baseline for ${sha.slice(0, 7)} (${ref})`,
    tree: newTree.sha,
    parents: tipSha ? [tipSha] : [],
  });

  if (tipSha) {
    await octokit.rest.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: commit.sha,
    });
  } else {
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: commit.sha,
    });
  }

  return { createdBranch: !tipSha, pruned, entryPath: baselinePath(sha) };
}
