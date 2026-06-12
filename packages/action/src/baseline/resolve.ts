import type { BaselineMeta, CoverageSummary } from '@coverage-insight/core';
import {
  BaselineEntry,
  BaselineIndex,
  BaselineOctokit,
  DEFAULT_BASELINE_BRANCH,
  baselinePath,
  readBranchFile,
} from './store';

export type ResolvedBaseline = {
  summary: CoverageSummary;
  meta: BaselineMeta;
  /** 🧬 mutation score recorded with the baseline entry, when present */
  mutationScore?: number;
};

/** Restore hook so tests (and the action) can plug in @actions/cache. Returns the file content or null. */
export type CacheRestore = (sha: string) => Promise<string | null>;

export async function getMergeBaseSha(params: {
  octokit: BaselineOctokit;
  owner: string;
  repo: string;
  baseRef: string;
  headSha: string;
}): Promise<string> {
  const { data } = await params.octokit.rest.repos.compareCommitsWithBasehead({
    owner: params.owner,
    repo: params.repo,
    basehead: `${params.baseRef}...${params.headSha}`,
  });
  return data.merge_base_commit.sha;
}

/**
 * Stage 2.2 resolution chain: actions/cache → baseline branch → first-parent
 * ancestor walk (≤ maxWalk, staleness reported) → null (no-baseline state).
 * The explicit `base` input bypasses this entirely (handled by the caller, D4).
 */
export async function resolveBaseline(params: {
  octokit: BaselineOctokit;
  owner: string;
  repo: string;
  mergeBaseSha: string;
  branch?: string;
  maxWalk?: number;
  restoreCache?: CacheRestore;
}): Promise<ResolvedBaseline | null> {
  const {
    octokit,
    owner,
    repo,
    mergeBaseSha,
    branch = DEFAULT_BASELINE_BRANCH,
    maxWalk = 50,
    restoreCache,
  } = params;

  // 1. actions/cache keyed by exact merge-base SHA
  if (restoreCache) {
    try {
      const cached = await restoreCache(mergeBaseSha);
      if (cached) {
        const entry = JSON.parse(cached) as BaselineEntry;
        return {
          summary: entry.summary,
          ...(entry.mutationScore !== undefined ? { mutationScore: entry.mutationScore } : {}),
          meta: {
            sha: mergeBaseSha,
            ref: entry.ref,
            timestamp: entry.timestamp,
            source: 'cache',
            staleness: 0,
          },
        };
      }
    } catch (error) {
      console.warn(`⚠️ Baseline cache restore failed, falling back to branch lookup: ${error}`);
    }
  }

  // 2. exact hit on the baseline branch
  const exact = await readEntry(octokit, { owner, repo, branch, sha: mergeBaseSha });
  if (exact) {
    return {
      summary: exact.summary,
      ...(exact.mutationScore !== undefined ? { mutationScore: exact.mutationScore } : {}),
      meta: {
        sha: mergeBaseSha,
        ref: exact.ref,
        timestamp: exact.timestamp,
        source: 'branch',
        staleness: 0,
      },
    };
  }

  // 3. nearest ancestor: walk history from the merge-base, consult the index
  //    once so the walk costs O(1) API content reads instead of one per commit
  const indexRaw = await readBranchFile(octokit, { owner, repo, branch, path: 'index.json' });
  const known = new Set<string>();
  if (indexRaw) {
    try {
      const index = JSON.parse(indexRaw) as BaselineIndex;
      for (const e of index.entries) known.add(e.sha);
    } catch {
      // ignore corrupt index — the walk below just finds nothing
    }
  }

  if (known.size > 0) {
    let ancestors: { sha: string }[] = [];
    try {
      const { data } = await octokit.rest.repos.listCommits({
        owner,
        repo,
        sha: mergeBaseSha,
        per_page: maxWalk,
      });
      ancestors = data;
    } catch (error) {
      console.warn(`⚠️ Ancestor walk failed: ${error}`);
    }

    for (let i = 1; i < ancestors.length; i++) {
      const sha = ancestors[i].sha;
      if (!known.has(sha)) continue;
      const entry = await readEntry(octokit, { owner, repo, branch, sha });
      if (entry) {
        return {
          summary: entry.summary,
          ...(entry.mutationScore !== undefined ? { mutationScore: entry.mutationScore } : {}),
          meta: {
            sha,
            ref: entry.ref,
            timestamp: entry.timestamp,
            source: 'ancestor',
            staleness: i,
          },
        };
      }
    }
  }

  // 4. no baseline anywhere
  return null;
}

async function readEntry(
  octokit: BaselineOctokit,
  params: { owner: string; repo: string; branch: string; sha: string }
): Promise<BaselineEntry | null> {
  const raw = await readBranchFile(octokit, {
    owner: params.owner,
    repo: params.repo,
    branch: params.branch,
    path: baselinePath(params.sha),
  });
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BaselineEntry;
  } catch {
    console.warn(`⚠️ Corrupt baseline entry for ${params.sha}, ignoring`);
    return null;
  }
}
