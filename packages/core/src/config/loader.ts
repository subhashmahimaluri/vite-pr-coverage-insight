import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { z } from 'zod';
import { configSchema, DEFAULT_CONFIG, type Config, type Thresholds } from './schema';

/** Thrown when a config file cannot be read, imported, or fails schema validation. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export type ConfigSource = `file:${string}` | 'package.json' | 'defaults';

export type LoadedConfig = {
  config: Config;
  source: ConfigSource;
};

/** Action-input-style overrides; every field is optional and wins over file config. */
export type InputOverrides = {
  thresholds?: Thresholds;
  ratchet?: boolean;
  ai?: Config['ai'];
  aiCanBlock?: boolean;
};

/** Discovery order — first match wins, then the package.json key, then defaults. */
const CONFIG_FILE_NAMES = [
  'coverage-insight.config.ts',
  'coverage-insight.config.mjs',
  'coverage-insight.config.json',
] as const;

const PACKAGE_JSON_KEY = 'coverage-insight';

/**
 * Discovers and validates the coverage-insight configuration in `cwd`.
 *
 * Discovery order: coverage-insight.config.ts → .mjs → .json → a
 * `"coverage-insight"` key in package.json. If nothing is found,
 * {@link DEFAULT_CONFIG} is returned with source `'defaults'`.
 */
export async function loadConfig(cwd: string = process.cwd()): Promise<LoadedConfig> {
  for (const name of CONFIG_FILE_NAMES) {
    const filePath = path.join(cwd, name);
    if (!fs.existsSync(filePath)) continue;
    const raw = await readConfigFile(filePath);
    const source: ConfigSource = `file:${filePath}`;
    return { config: validateConfig(raw, source), source };
  }

  const packageJsonPath = path.join(cwd, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const pkg = parseJsonFile(packageJsonPath) as Record<string, unknown>;
    if (pkg !== null && typeof pkg === 'object' && PACKAGE_JSON_KEY in pkg) {
      return {
        config: validateConfig(pkg[PACKAGE_JSON_KEY], 'package.json'),
        source: 'package.json',
      };
    }
  }

  return { config: DEFAULT_CONFIG, source: 'defaults' };
}

/**
 * Merges action-input overrides into a loaded config.
 * Precedence: inputs > config file > defaults. Threshold metrics merge
 * per-key, so an input `{ thresholds: { lines: 90 } }` keeps the file's
 * `branches` threshold. The merged result is re-validated.
 */
export function applyInputOverrides(config: Config, inputs: InputOverrides): Config {
  const merged: Config = { ...config };
  if (inputs.thresholds !== undefined) {
    merged.thresholds = { ...config.thresholds, ...withoutUndefined(inputs.thresholds) };
  }
  if (inputs.ratchet !== undefined) merged.ratchet = inputs.ratchet;
  if (inputs.ai !== undefined) merged.ai = inputs.ai;
  if (inputs.aiCanBlock !== undefined) merged.aiCanBlock = inputs.aiCanBlock;
  return validateConfig(merged, 'inputs');
}

/**
 * Loads the raw (unvalidated) value from a config file.
 *
 * .ts and .mjs files are loaded with a dynamic `import()`. Note that a .ts
 * config requires a TypeScript-capable runtime (tsx, vitest, ts-node/esm…) —
 * plain `node` cannot import it, in which case we surface a clear error.
 * The module's `default` export is used when present, otherwise the module
 * namespace itself.
 */
async function readConfigFile(filePath: string): Promise<unknown> {
  if (filePath.endsWith('.json')) {
    return parseJsonFile(filePath);
  }

  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(filePath).href)) as Record<string, unknown>;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const hint = filePath.endsWith('.ts')
      ? ' A .ts config requires a TypeScript-capable runtime (e.g. tsx or vitest); use coverage-insight.config.mjs or .json with plain node.'
      : '';
    throw new ConfigError(`Failed to load config file ${filePath}: ${reason}${hint}`);
  }
  return 'default' in mod ? mod.default : mod;
}

function parseJsonFile(filePath: string): unknown {
  const content = fs.readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(content);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Failed to parse ${filePath}: ${reason}`);
  }
}

/** Validates a raw value, throwing a ConfigError listing every invalid key. */
function validateConfig(raw: unknown, source: string): Config {
  const result = configSchema.safeParse(raw);
  if (result.success) return result.data;
  const lines = result.error.issues.flatMap((issue) => formatIssue(issue, raw));
  throw new ConfigError(`Invalid configuration (${source}):\n  ${lines.join('\n  ')}`);
}

/**
 * Renders one zod issue as `<path>: expected <type>, got <value>`, e.g.
 * `thresholds.lines: expected number <= 100, got 150`.
 */
function formatIssue(issue: z.core.$ZodIssue, raw: unknown): string[] {
  const where = issue.path.length > 0 ? issue.path.join('.') : 'config';
  const got = describeValue(valueAt(raw, issue.path));
  switch (issue.code) {
    case 'invalid_type':
      return [`${where}: expected ${issue.expected}, got ${got}`];
    case 'too_big':
      return [
        `${where}: expected ${issue.origin} ${issue.inclusive ? '<=' : '<'} ${issue.maximum}, got ${got}`,
      ];
    case 'too_small':
      return [
        `${where}: expected ${issue.origin} ${issue.inclusive ? '>=' : '>'} ${issue.minimum}, got ${got}`,
      ];
    case 'invalid_value':
      return [`${where}: expected one of ${issue.values.map(String).join(' | ')}, got ${got}`];
    case 'unrecognized_keys':
      return issue.keys.map(
        (key) => `${issue.path.length > 0 ? `${where}.${key}` : key}: unknown key`
      );
    default:
      return [`${where}: ${issue.message}`];
  }
}

/** Resolves the offending input value for an issue path. */
function valueAt(root: unknown, issuePath: ReadonlyArray<PropertyKey>): unknown {
  let current = root;
  for (const key of issuePath) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

function describeValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'object') return Array.isArray(value) ? 'array' : 'object';
  if (typeof value === 'function') return 'function';
  return JSON.stringify(value) ?? String(value);
}

/** Drops explicitly-undefined keys so they don't clobber file config on spread. */
function withoutUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key as keyof T] = value as T[keyof T];
  }
  return out;
}
