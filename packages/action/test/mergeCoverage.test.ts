import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoverageSummary } from '@coverage-insight/core';
import { mergeSummaries, readCoverageInput } from '../src/mergeCoverage';

function metric(covered: number, total: number) {
  return {
    covered,
    total,
    skipped: 0,
    pct: total === 0 ? 100 : Number(((covered / total) * 100).toFixed(2)),
  };
}

function fileEntry(covered: number, total: number) {
  return {
    lines: metric(covered, total),
    statements: metric(covered, total),
    functions: metric(covered, total),
    branches: metric(covered, total),
  };
}

const shardA = {
  total: fileEntry(8, 10),
  '/app/a.ts': fileEntry(8, 10),
} as CoverageSummary;

const shardB = {
  total: fileEntry(5, 10),
  '/app/b.ts': fileEntry(5, 10),
} as CoverageSummary;

// the single full run over both files, for the merged-equals-single-run proof
const fullRun = {
  total: fileEntry(13, 20),
  '/app/a.ts': fileEntry(8, 10),
  '/app/b.ts': fileEntry(5, 10),
} as CoverageSummary;

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('mergeSummaries', () => {
  it('merged file-disjoint shards equal a single full run', () => {
    const merged = mergeSummaries([shardA, shardB]);

    expect(merged.total).toEqual(fullRun.total);
    expect(merged['/app/a.ts']).toEqual(fullRun['/app/a.ts']);
    expect(merged['/app/b.ts']).toEqual(fullRun['/app/b.ts']);
  });

  it('keeps the better shard when a file overlaps', () => {
    const overlapping = {
      total: fileEntry(3, 10),
      '/app/a.ts': fileEntry(3, 10),
    } as CoverageSummary;

    const merged = mergeSummaries([overlapping, shardA]);

    expect(merged['/app/a.ts'].lines.covered).toBe(8);
  });

  it('is identity for a single shard', () => {
    expect(mergeSummaries([shardA])).toBe(shardA);
  });

  it('throws on empty input', () => {
    expect(() => mergeSummaries([])).toThrow('No coverage shards');
  });
});

describe('readCoverageInput', () => {
  it('reads a single file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'covins-'));
    tmpDirs.push(dir);
    const file = path.join(dir, 'coverage-summary.json');
    fs.writeFileSync(file, JSON.stringify(shardA));

    expect(readCoverageInput(file).total.lines.covered).toBe(8);
  });

  it('merges all shards in a directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'covins-'));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, 'shard-1.json'), JSON.stringify(shardA));
    fs.writeFileSync(path.join(dir, 'shard-2.json'), JSON.stringify(shardB));

    const merged = readCoverageInput(dir);
    expect(merged.total).toEqual(fullRun.total);
  });

  it('throws a clear error for an empty directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'covins-'));
    tmpDirs.push(dir);

    expect(() => readCoverageInput(dir)).toThrow('No .json coverage shards');
  });
});
