import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseTestFailures } from '../src/parseTestFailures';

const fixturesDir = path.resolve(__dirname, '../../../fixtures');

describe('parseTestFailures', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses a valid failures file', () => {
    const result = parseTestFailures(path.join(fixturesDir, 'test-failures/failures.json'));

    expect(result).not.toBeNull();
    expect(result!.numFailedTests).toBe(2);
    expect(result!.failedTests[0].testName).toBe('should round half-up at the boundary');
  });

  it('returns null for a missing file', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(parseTestFailures('/nonexistent/failures.json')).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it('returns null for corrupt JSON', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const corrupt = path.join(os.tmpdir(), 'corrupt-failures.json');
    fs.writeFileSync(corrupt, '{not json');

    try {
      expect(parseTestFailures(corrupt)).toBeNull();
    } finally {
      fs.rmSync(corrupt, { force: true });
    }
  });
});
