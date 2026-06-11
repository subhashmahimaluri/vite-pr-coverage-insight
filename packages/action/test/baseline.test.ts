import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoverageSummary } from '@coverage-insight/core';
import { commitBranchFiles, publishBaseline } from '../src/baseline/publish';
import { getMergeBaseSha, resolveBaseline } from '../src/baseline/resolve';
import { baselinePath, cacheKey } from '../src/baseline/store';

const summary = {
  total: {
    lines: { pct: 90, total: 100, covered: 90, skipped: 0 },
    statements: { pct: 90, total: 100, covered: 90, skipped: 0 },
    functions: { pct: 90, total: 10, covered: 9, skipped: 0 },
    branches: { pct: 85, total: 20, covered: 17, skipped: 0 },
  },
} as CoverageSummary;

function entryJson(sha: string): string {
  return JSON.stringify({
    sha,
    ref: 'refs/heads/main',
    timestamp: '2026-06-11T00:00:00Z',
    summary,
  });
}

function b64(content: string) {
  return { content: Buffer.from(content).toString('base64'), encoding: 'base64' };
}

function notFound(): never {
  const error = new Error('Not Found') as Error & { status: number };
  error.status = 404;
  throw error;
}

function makeOctokit() {
  return {
    rest: {
      git: {
        getRef: vi.fn(),
        getCommit: vi.fn(),
        createTree: vi.fn().mockResolvedValue({ data: { sha: 'tree-sha' } }),
        createCommit: vi.fn().mockResolvedValue({ data: { sha: 'commit-sha' } }),
        createRef: vi.fn().mockResolvedValue({}),
        updateRef: vi.fn().mockResolvedValue({}),
      },
      repos: {
        getContent: vi.fn(),
        listCommits: vi.fn(),
        compareCommitsWithBasehead: vi.fn(),
      },
    },
  };
}

let octokit: ReturnType<typeof makeOctokit>;
const base = { owner: 'acme', repo: 'demo' };

beforeEach(() => {
  octokit = makeOctokit();
});

describe('publishBaseline', () => {
  it('creates the orphan branch on first publish', async () => {
    octokit.rest.git.getRef.mockImplementation(notFound);

    const result = await publishBaseline({
      octokit,
      ...base,
      sha: 'abc123',
      ref: 'refs/heads/main',
      summary,
      timestamp: '2026-06-11T00:00:00Z',
    });

    expect(result.createdBranch).toBe(true);
    expect(result.entryPath).toBe('baselines/abc123.json');
    // orphan commit: no parents, no base_tree
    expect(octokit.rest.git.createCommit).toHaveBeenCalledWith(
      expect.objectContaining({ parents: [] })
    );
    expect(octokit.rest.git.createTree.mock.calls[0][0].base_tree).toBeUndefined();
    expect(octokit.rest.git.createRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'refs/heads/coverage-baseline', sha: 'commit-sha' })
    );

    const tree = octokit.rest.git.createTree.mock.calls[0][0].tree;
    const paths = tree.map((t: { path: string }) => t.path);
    expect(paths).toEqual(['baselines/abc123.json', 'index.json']);
  });

  it('appends to an existing branch and prunes beyond maxEntries', async () => {
    octokit.rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'tip' } } });
    octokit.rest.git.getCommit.mockResolvedValue({ data: { tree: { sha: 'tip-tree' } } });
    const existing = [
      { sha: 'old1', timestamp: '2026-06-10T00:00:00Z' },
      { sha: 'old2', timestamp: '2026-06-09T00:00:00Z' },
      { sha: 'old3', timestamp: '2026-06-08T00:00:00Z' },
    ];
    octokit.rest.repos.getContent.mockResolvedValue({
      data: b64(JSON.stringify({ entries: existing })),
    });

    const result = await publishBaseline({
      octokit,
      ...base,
      sha: 'new1',
      ref: 'refs/heads/main',
      summary,
      maxEntries: 3,
      timestamp: '2026-06-11T00:00:00Z',
    });

    expect(result.createdBranch).toBe(false);
    expect(result.pruned).toEqual(['old3']);
    expect(octokit.rest.git.updateRef).toHaveBeenCalled();

    const tree = octokit.rest.git.createTree.mock.calls[0][0].tree;
    const deletion = tree.find((t: { sha?: string | null }) => t.sha === null);
    expect(deletion.path).toBe('baselines/old3.json');

    const index = JSON.parse(tree.find((t: { path: string }) => t.path === 'index.json').content);
    expect(index.entries.map((e: { sha: string }) => e.sha)).toEqual(['new1', 'old1', 'old2']);
  });

  it('recovers from a corrupt index', async () => {
    octokit.rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'tip' } } });
    octokit.rest.git.getCommit.mockResolvedValue({ data: { tree: { sha: 'tip-tree' } } });
    octokit.rest.repos.getContent.mockResolvedValue({ data: b64('{corrupt') });

    const result = await publishBaseline({
      octokit,
      ...base,
      sha: 'abc',
      ref: 'refs/heads/main',
      summary,
    });

    expect(result.pruned).toEqual([]);
  });
});

describe('commitBranchFiles', () => {
  const files = [{ path: 'badges/pr-39-metric-band-light.svg', content: '<svg>new</svg>' }];

  it('commits changed files onto the branch tip', async () => {
    octokit.rest.repos.getContent.mockImplementation(notFound);
    octokit.rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'tip' } } });
    octokit.rest.git.getCommit.mockResolvedValue({ data: { tree: { sha: 'tree' } } });

    await commitBranchFiles({
      octokit: octokit as never,
      ...base,
      branch: 'coverage-baseline',
      message: 'pr #39 metric band',
      files,
    });

    expect(octokit.rest.git.createTree).toHaveBeenCalledWith(
      expect.objectContaining({ base_tree: 'tree' })
    );
    expect(octokit.rest.git.updateRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'heads/coverage-baseline', sha: 'commit-sha' })
    );
  });

  it('no-ops when every file already has identical content', async () => {
    octokit.rest.repos.getContent.mockResolvedValue({ data: b64('<svg>new</svg>') });

    await commitBranchFiles({
      octokit: octokit as never,
      ...base,
      branch: 'coverage-baseline',
      message: 'noop',
      files,
    });

    expect(octokit.rest.git.createCommit).not.toHaveBeenCalled();
  });

  it('retries once when a concurrent run moved the ref', async () => {
    octokit.rest.repos.getContent.mockImplementation(notFound);
    octokit.rest.git.getRef.mockResolvedValue({ data: { object: { sha: 'tip' } } });
    octokit.rest.git.getCommit.mockResolvedValue({ data: { tree: { sha: 'tree' } } });
    octokit.rest.git.updateRef
      .mockRejectedValueOnce(new Error('Update is not a fast forward'))
      .mockResolvedValueOnce({});

    await commitBranchFiles({
      octokit: octokit as never,
      ...base,
      branch: 'coverage-baseline',
      message: 'retry',
      files,
    });

    expect(octokit.rest.git.updateRef).toHaveBeenCalledTimes(2);
  });
});

describe('getMergeBaseSha', () => {
  it('uses the compare API', async () => {
    octokit.rest.repos.compareCommitsWithBasehead.mockResolvedValue({
      data: { merge_base_commit: { sha: 'mb1' } },
    });

    const sha = await getMergeBaseSha({
      octokit,
      ...base,
      baseRef: 'main',
      headSha: 'head1',
    });

    expect(sha).toBe('mb1');
    expect(octokit.rest.repos.compareCommitsWithBasehead).toHaveBeenCalledWith(
      expect.objectContaining({ basehead: 'main...head1' })
    );
  });
});

describe('resolveBaseline', () => {
  it('path 1: returns the cache hit with staleness 0', async () => {
    const restoreCache = vi.fn().mockResolvedValue(entryJson('mb1'));

    const resolved = await resolveBaseline({
      octokit,
      ...base,
      mergeBaseSha: 'mb1',
      restoreCache,
    });

    expect(restoreCache).toHaveBeenCalledWith('mb1');
    expect(resolved?.meta).toMatchObject({ sha: 'mb1', source: 'cache', staleness: 0 });
    expect(resolved?.summary.total.lines.pct).toBe(90);
    expect(octokit.rest.repos.getContent).not.toHaveBeenCalled();
  });

  it('path 2: falls back to an exact branch lookup', async () => {
    octokit.rest.repos.getContent.mockImplementation(({ path: p }: { path: string }) => {
      if (p === baselinePath('mb1')) return Promise.resolve({ data: b64(entryJson('mb1')) });
      return notFound();
    });

    const resolved = await resolveBaseline({
      octokit,
      ...base,
      mergeBaseSha: 'mb1',
      restoreCache: async () => null,
    });

    expect(resolved?.meta).toMatchObject({ sha: 'mb1', source: 'branch', staleness: 0 });
  });

  it('path 3: walks ancestors and reports staleness', async () => {
    octokit.rest.repos.getContent.mockImplementation(({ path: p }: { path: string }) => {
      if (p === 'index.json')
        return Promise.resolve({
          data: b64(JSON.stringify({ entries: [{ sha: 'anc3', timestamp: 't' }] })),
        });
      if (p === baselinePath('anc3')) return Promise.resolve({ data: b64(entryJson('anc3')) });
      return notFound();
    });
    octokit.rest.repos.listCommits.mockResolvedValue({
      data: [{ sha: 'mb1' }, { sha: 'anc1' }, { sha: 'anc2' }, { sha: 'anc3' }],
    });

    const resolved = await resolveBaseline({
      octokit,
      ...base,
      mergeBaseSha: 'mb1',
    });

    expect(resolved?.meta).toMatchObject({ sha: 'anc3', source: 'ancestor', staleness: 3 });
  });

  it('path 4: returns null when nothing resolves', async () => {
    octokit.rest.repos.getContent.mockImplementation(notFound);

    const resolved = await resolveBaseline({
      octokit,
      ...base,
      mergeBaseSha: 'mb1',
      restoreCache: async () => null,
    });

    expect(resolved).toBeNull();
    // no index → no listCommits call wasted
    expect(octokit.rest.repos.listCommits).not.toHaveBeenCalled();
  });

  it('survives a failing cache restore', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    octokit.rest.repos.getContent.mockImplementation(({ path: p }: { path: string }) => {
      if (p === baselinePath('mb1')) return Promise.resolve({ data: b64(entryJson('mb1')) });
      return notFound();
    });

    const resolved = await resolveBaseline({
      octokit,
      ...base,
      mergeBaseSha: 'mb1',
      restoreCache: async () => {
        throw new Error('cache service down');
      },
    });

    expect(resolved?.meta.source).toBe('branch');
  });
});

describe('cacheKey', () => {
  it('matches the covins-baseline-<sha> convention', () => {
    expect(cacheKey('abc')).toBe('covins-baseline-abc');
  });
});
