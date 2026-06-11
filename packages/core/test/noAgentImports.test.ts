import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Decision D2: AI is strictly optional. No deterministic package may
 * statically import @coverage-insight/agents — only a dynamic
 * `await import(...)` behind an `ai !== 'off'` check (in the action) is
 * allowed.
 */

const ROOT = path.resolve(__dirname, '../../..');
const DETERMINISTIC_SRC_DIRS = [
  'packages/core/src',
  'packages/action/src',
  'packages/reporters/src',
  'packages/history/src',
  'packages/cli/src',
];

const STATIC_IMPORT =
  /(from\s+['"]@coverage-insight\/agents|require\(\s*['"]@coverage-insight\/agents)/;

function* walk(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.ts')) yield full;
  }
}

describe('D2 isolation', () => {
  it('no deterministic package statically imports @coverage-insight/agents', () => {
    const offenders: string[] = [];
    for (const dir of DETERMINISTIC_SRC_DIRS) {
      for (const file of walk(path.join(ROOT, dir))) {
        if (STATIC_IMPORT.test(fs.readFileSync(file, 'utf-8'))) {
          offenders.push(path.relative(ROOT, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
