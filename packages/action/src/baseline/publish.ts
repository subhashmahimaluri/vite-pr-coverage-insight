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
  /** 🧬 mutation score to record with the entry (drives the band's Δ on PRs) */
  mutationScore?: number;
  /** additional files committed alongside the entry (e.g. badges/*.svg) */
  extraFiles?: { path: string; content: string }[];
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

  const entry: BaselineEntry = {
    sha,
    ref,
    timestamp,
    summary,
    ...(params.mutationScore !== undefined ? { mutationScore: params.mutationScore } : {}),
  };

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
    ...(params.extraFiles ?? []).map((f) => ({
      path: f.path,
      mode: '100644' as const,
      type: 'blob' as const,
      content: f.content,
    })),
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

/**
 * Commits a small set of files onto an existing branch (used for per-PR badge
 * SVGs on the baseline branch). No-ops when every file already has identical
 * content; retries once when a concurrent run moved the ref.
 */
export async function commitBranchFiles(params: {
  octokit: BaselineOctokit;
  owner: string;
  repo: string;
  branch: string;
  message: string;
  files: { path: string; content: string }[];
}): Promise<void> {
  const { octokit, owner, repo, branch, message, files } = params;

  const changed: typeof files = [];
  for (const file of files) {
    const existing = await readBranchFile(octokit, { owner, repo, branch, path: file.path });
    if (existing !== file.content) changed.push(file);
  }
  if (changed.length === 0) return;

  const attempt = async () => {
    const { data: ref } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
    const tipSha = ref.object.sha;
    const { data: tipCommit } = await octokit.rest.git.getCommit({
      owner,
      repo,
      commit_sha: tipSha,
    });
    const { data: newTree } = await octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: tipCommit.tree.sha,
      tree: changed.map((f) => ({
        path: f.path,
        mode: '100644' as const,
        type: 'blob' as const,
        content: f.content,
      })),
    });
    const { data: commit } = await octokit.rest.git.createCommit({
      owner,
      repo,
      message,
      tree: newTree.sha,
      parents: [tipSha],
    });
    await octokit.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: commit.sha });
  };

  try {
    await attempt();
  } catch {
    // a concurrent run may have advanced the branch — retry once from the new tip
    await attempt();
  }
}
