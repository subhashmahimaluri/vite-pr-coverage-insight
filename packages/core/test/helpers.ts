import fs from 'fs';
import path from 'path';
import type { CoverageSummary, TestFailuresResult } from '../src';

const fixturesDir = path.resolve(__dirname, '../../../fixtures');

export function loadFixturePair(scenario: string): { base: CoverageSummary; head: CoverageSummary } {
  return {
    base: JSON.parse(fs.readFileSync(path.join(fixturesDir, scenario, 'base.json'), 'utf-8')),
    head: JSON.parse(fs.readFileSync(path.join(fixturesDir, scenario, 'head.json'), 'utf-8')),
  };
}

export function loadTestFailures(): TestFailuresResult {
  return JSON.parse(
    fs.readFileSync(path.join(fixturesDir, 'test-failures/failures.json'), 'utf-8')
  );
}

export const prInfo = { owner: 'acme', repo: 'demo', prNumber: 42 };
