import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyInputOverrides, ConfigError, loadConfig } from '../src/config/loader';
import { configSchema, DEFAULT_CONFIG } from '../src/config/schema';

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'covins-config-'));
  tmpDirs.push(dir);
  return dir;
}

function write(dir: string, name: string, content: string): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

describe('loadConfig — discovery', () => {
  it('returns DEFAULT_CONFIG with source "defaults" when nothing is found', async () => {
    const dir = makeTmpDir();
    const loaded = await loadConfig(dir);
    expect(loaded.source).toBe('defaults');
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
  });

  it('loads coverage-insight.config.json', async () => {
    const dir = makeTmpDir();
    const filePath = write(
      dir,
      'coverage-insight.config.json',
      JSON.stringify({ thresholds: { lines: 80 }, ratchet: true })
    );
    const loaded = await loadConfig(dir);
    expect(loaded.source).toBe(`file:${filePath}`);
    expect(loaded.config.thresholds).toEqual({ lines: 80 });
    expect(loaded.config.ratchet).toBe(true);
    expect(loaded.config.ai).toBe('off'); // defaults still applied
  });

  it('loads coverage-insight.config.mjs (default export)', async () => {
    const dir = makeTmpDir();
    const filePath = write(
      dir,
      'coverage-insight.config.mjs',
      "export default { thresholds: { branches: 70 }, ai: 'comment' };\n"
    );
    const loaded = await loadConfig(dir);
    expect(loaded.source).toBe(`file:${filePath}`);
    expect(loaded.config.thresholds).toEqual({ branches: 70 });
    expect(loaded.config.ai).toBe('comment');
  });

  it('loads coverage-insight.config.ts (requires a TS-capable runtime such as vitest)', async () => {
    const dir = makeTmpDir();
    const filePath = write(
      dir,
      'coverage-insight.config.ts',
      'const config = { thresholds: { functions: 95 } };\nexport default config;\n'
    );
    const loaded = await loadConfig(dir);
    expect(loaded.source).toBe(`file:${filePath}`);
    expect(loaded.config.thresholds).toEqual({ functions: 95 });
  });

  it('reads the "coverage-insight" key in package.json when no config file exists', async () => {
    const dir = makeTmpDir();
    write(
      dir,
      'package.json',
      JSON.stringify({ name: 'x', 'coverage-insight': { thresholds: { statements: 60 } } })
    );
    const loaded = await loadConfig(dir);
    expect(loaded.source).toBe('package.json');
    expect(loaded.config.thresholds).toEqual({ statements: 60 });
  });

  it('falls back to defaults when package.json has no coverage-insight key', async () => {
    const dir = makeTmpDir();
    write(dir, 'package.json', JSON.stringify({ name: 'x' }));
    const loaded = await loadConfig(dir);
    expect(loaded.source).toBe('defaults');
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
  });

  it('prefers .ts over .mjs, .json and package.json (first found wins)', async () => {
    const dir = makeTmpDir();
    write(dir, 'coverage-insight.config.ts', 'export default { thresholds: { lines: 1 } };\n');
    write(dir, 'coverage-insight.config.mjs', 'export default { thresholds: { lines: 2 } };\n');
    write(dir, 'coverage-insight.config.json', JSON.stringify({ thresholds: { lines: 3 } }));
    write(
      dir,
      'package.json',
      JSON.stringify({ 'coverage-insight': { thresholds: { lines: 4 } } })
    );
    const loaded = await loadConfig(dir);
    expect(loaded.config.thresholds).toEqual({ lines: 1 });
  });

  it('prefers .json over the package.json key', async () => {
    const dir = makeTmpDir();
    write(dir, 'coverage-insight.config.json', JSON.stringify({ thresholds: { lines: 3 } }));
    write(
      dir,
      'package.json',
      JSON.stringify({ 'coverage-insight': { thresholds: { lines: 4 } } })
    );
    const loaded = await loadConfig(dir);
    expect(loaded.config.thresholds).toEqual({ lines: 3 });
    expect(loaded.source).toMatch(/^file:.*coverage-insight\.config\.json$/);
  });
});

describe('loadConfig — validation errors', () => {
  it('reports the exact path and expected type for invalid values', async () => {
    const dir = makeTmpDir();
    write(
      dir,
      'coverage-insight.config.json',
      JSON.stringify({ thresholds: { lines: 150 }, ratchet: 'yes' })
    );
    const error = await loadConfig(dir).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as ConfigError).message;
    expect(message).toContain('thresholds.lines: expected number <= 100, got 150');
    expect(message).toContain('ratchet: expected boolean, got "yes"');
  });

  it('rejects unknown keys (strict schema) and names each one', async () => {
    const dir = makeTmpDir();
    write(
      dir,
      'coverage-insight.config.json',
      JSON.stringify({ bogus: true, thresholds: { linez: 80 } })
    );
    const error = await loadConfig(dir).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as ConfigError).message;
    expect(message).toContain('bogus: unknown key');
    expect(message).toContain('thresholds.linez: unknown key');
  });

  it('reports invalid enum values with the allowed options', async () => {
    const dir = makeTmpDir();
    write(dir, 'coverage-insight.config.json', JSON.stringify({ ai: 'always' }));
    const error = await loadConfig(dir).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).message).toContain(
      'ai: expected one of off | comment | review, got "always"'
    );
  });

  it('throws a ConfigError for malformed JSON', async () => {
    const dir = makeTmpDir();
    write(dir, 'coverage-insight.config.json', '{ not json');
    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/Failed to parse/);
  });

  it('throws a ConfigError when a module config fails to import', async () => {
    const dir = makeTmpDir();
    write(dir, 'coverage-insight.config.mjs', 'export default {{{;\n');
    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/Failed to load config file/);
  });
});

describe('applyInputOverrides — precedence inputs > file > defaults', () => {
  it('input values win over file config, file values win over defaults', () => {
    const fileConfig = configSchema.parse({
      thresholds: { lines: 70, branches: 65 },
      ratchet: false,
      ai: 'comment',
    });
    const merged = applyInputOverrides(fileConfig, {
      thresholds: { lines: 90 },
      ratchet: true,
    });
    expect(merged.thresholds).toEqual({ lines: 90, branches: 65 }); // input wins, file kept
    expect(merged.ratchet).toBe(true); // input wins over file
    expect(merged.ai).toBe('comment'); // file wins over default 'off'
    expect(merged.ratchetTolerance).toBe(0.1); // untouched default
  });

  it('returns the config unchanged for empty inputs', () => {
    const fileConfig = configSchema.parse({ thresholds: { lines: 70 } });
    expect(applyInputOverrides(fileConfig, {})).toEqual(fileConfig);
  });

  it('ignores explicitly-undefined input fields', () => {
    const fileConfig = configSchema.parse({ thresholds: { lines: 70 }, aiCanBlock: true });
    const merged = applyInputOverrides(fileConfig, {
      thresholds: { lines: undefined },
      ratchet: undefined,
      aiCanBlock: undefined,
    });
    expect(merged.thresholds).toEqual({ lines: 70 });
    expect(merged.aiCanBlock).toBe(true);
  });

  it('re-validates the merged config and reports bad input values', () => {
    const fileConfig = configSchema.parse({});
    expect(() => applyInputOverrides(fileConfig, { thresholds: { lines: 150 } })).toThrow(
      /thresholds\.lines: expected number <= 100, got 150/
    );
  });
});
