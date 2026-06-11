import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the committed bundle, not the sources. A dependency that goes
 * ESM-only (e.g. @actions/github@9, @actions/cache@6) makes ncc emit a
 * `webpackMissingModule` stub that throws "Cannot find module" the moment
 * dist/index.js loads — every consumer run then crashes with a minified
 * source dump before any error handling is registered.
 */

const DIST = path.resolve(__dirname, '../../../dist/index.js');

describe('dist/index.js smoke', () => {
  it('contains no unresolved-module stubs', () => {
    const bundle = fs.readFileSync(DIST, 'utf-8');
    expect(bundle).not.toContain('webpackMissingModule');
  });

  it('loads and exits cleanly without inputs (no load-time crash)', () => {
    const result = spawnSync(process.execPath, [DIST], {
      encoding: 'utf-8',
      timeout: 30_000,
      env: {
        PATH: process.env.PATH,
        // no GITHUB_* / INPUT_* — the action must fail gracefully, not crash
      },
    });
    const output = `${result.stdout}${result.stderr}`;
    expect(output).not.toContain('webpackMissingModule');
    // a load crash exits 1 and dumps the minified line; graceful handling exits 0
    expect(result.status).toBe(0);
  });
});
