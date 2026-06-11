import fs from 'fs';
import path from 'path';
import { relativizePath, type CoverageMetric, type CoverageSummary } from '@coverage-insight/core';

const METRICS = ['statements', 'branches', 'functions', 'lines'] as const;

/**
 * Merges coverage-summary.json shards (Stage 2.4 — sharded test matrices).
 *
 * Shards are expected to be file-disjoint (each source file's coverage comes
 * from exactly one shard, the normal case when sharding by test file). When
 * the same file appears in several shards we keep the shard with the most
 * covered lines — summary files don't carry enough detail for a true merge
 * (that requires merging coverage-final.json with istanbul-merge before
 * summarizing, which is documented as the preferred route for overlapping
 * shards).
 */
export function mergeSummaries(shards: CoverageSummary[]): CoverageSummary {
  if (shards.length === 0) throw new Error('No coverage shards to merge');
  if (shards.length === 1) return shards[0];

  const files = new Map<string, CoverageSummary[string]>();
  for (const shard of shards) {
    for (const [filePath, metrics] of Object.entries(shard)) {
      if (filePath === 'total') continue;
      const existing = files.get(filePath);
      if (!existing || metrics.lines.covered > existing.lines.covered) {
        files.set(filePath, metrics);
      }
    }
  }

  const total = {} as CoverageSummary['total'];
  for (const metric of METRICS) {
    let covered = 0;
    let totalCount = 0;
    let skipped = 0;
    for (const fileMetrics of files.values()) {
      covered += fileMetrics[metric].covered;
      totalCount += fileMetrics[metric].total;
      skipped += fileMetrics[metric].skipped;
    }
    total[metric] = {
      covered,
      total: totalCount,
      skipped,
      pct: totalCount === 0 ? 100 : Number(((covered / totalCount) * 100).toFixed(2)),
    } satisfies CoverageMetric;
  }

  return { total, ...Object.fromEntries(files) } as CoverageSummary;
}

/**
 * Rewrites the absolute runner paths istanbul emits into repo-relative keys so
 * reports stay readable and baselines compare across runners.
 */
export function relativizeSummary(summary: CoverageSummary, root: string): CoverageSummary {
  if (!root) return summary;
  const out = { total: summary.total } as CoverageSummary;
  for (const [filePath, metrics] of Object.entries(summary)) {
    if (filePath === 'total') continue;
    out[relativizePath(filePath, root)] = metrics;
  }
  return out;
}

/**
 * Reads a coverage input that is either a single coverage-summary.json file or
 * a directory of shard summaries to merge.
 */
export function readCoverageInput(inputPath: string): CoverageSummary {
  const resolved = path.resolve(inputPath);
  const stat = fs.statSync(resolved);

  if (stat.isFile()) {
    return JSON.parse(fs.readFileSync(resolved, 'utf-8')) as CoverageSummary;
  }

  const shardFiles = fs
    .readdirSync(resolved)
    .filter((f) => f.endsWith('.json'))
    .sort();
  if (shardFiles.length === 0) {
    throw new Error(`No .json coverage shards found in directory: ${inputPath}`);
  }

  const shards = shardFiles.map(
    (f) => JSON.parse(fs.readFileSync(path.join(resolved, f), 'utf-8')) as CoverageSummary
  );
  return mergeSummaries(shards);
}
