import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli';

const fixtures = path.resolve(__dirname, '../../../fixtures');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'covins-'));

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { stdout: (l: string) => out.push(l), stderr: (l: string) => err.push(l) },
  };
}

describe('covins compare', () => {
  it('prints the delta table for two summaries', async () => {
    const { out, io: streams } = io();
    const code = await runCli(
      [
        'compare',
        '--base',
        `${fixtures}/improvement/base.json`,
        '--head',
        `${fixtures}/improvement/head.json`,
      ],
      streams
    );
    expect(code).toBe(0);
    expect(out.join('\n')).toContain('lines');
    expect(out.join('\n')).toContain('+15.00% ↑');
  });

  it('accepts lcov input via auto-detection', async () => {
    const { io: streams } = io();
    const code = await runCli(
      [
        'compare',
        '--base',
        `${fixtures}/formats/lcov.info`,
        '--head',
        `${fixtures}/formats/lcov.info`,
      ],
      streams
    );
    expect(code).toBe(0);
  });
});

describe('covins check', () => {
  it('exit 0 with no thresholds configured', async () => {
    const { io: streams } = io();
    const code = await runCli(
      ['check', '--head', `${fixtures}/improvement/head.json`, '--cwd', tmp],
      streams
    );
    expect(code).toBe(0);
  });

  it('exit 2 when thresholds fail (Jenkins-style gate)', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'gate-'));
    fs.writeFileSync(
      path.join(dir, 'coverage-insight.config.json'),
      JSON.stringify({ thresholds: { lines: 99 } })
    );
    const { out, io: streams } = io();
    const code = await runCli(
      ['check', '--head', `${fixtures}/improvement/head.json`, '--cwd', dir],
      streams
    );
    expect(code).toBe(2);
    expect(out.join('\n')).toContain('verdict: fail');
    expect(out.join('\n')).toContain('required 99%');
  });
});

describe('covins report', () => {
  it('writes a schema-valid JSON report', async () => {
    const outFile = path.join(tmp, 'report.json');
    const { io: streams } = io();
    const code = await runCli(
      [
        'report',
        '--head',
        `${fixtures}/improvement/head.json`,
        '--base',
        `${fixtures}/improvement/base.json`,
        '--format',
        'json',
        '--out',
        outFile,
        '--cwd',
        tmp,
      ],
      streams
    );
    expect(code).toBe(0);
    const report = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
    expect(report.schemaVersion).toBe(1);
    expect(report.state).toBe('passed');
  });

  it('writes markdown and html', async () => {
    for (const format of ['md', 'html'] as const) {
      const outFile = path.join(tmp, `report.${format}`);
      const { io: streams } = io();
      const code = await runCli(
        [
          'report',
          '--head',
          `${fixtures}/improvement/head.json`,
          '--format',
          format,
          '--out',
          outFile,
          '--cwd',
          tmp,
        ],
        streams
      );
      expect(code).toBe(0);
      expect(fs.existsSync(outFile)).toBe(true);
    }
  });
});

describe('errors', () => {
  it('unknown command exits 2 with usage', async () => {
    const { err, io: streams } = io();
    expect(await runCli(['frobnicate'], streams)).toBe(2);
    expect(err.join('\n')).toContain('Usage:');
  });

  it('missing file is a clean error, not a stack trace', async () => {
    const { err, io: streams } = io();
    expect(await runCli(['check', '--head', '/nope.json'], streams)).toBe(2);
    expect(err.join('\n')).toContain('covins check:');
  });
});
