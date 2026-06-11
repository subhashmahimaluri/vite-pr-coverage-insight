import type { CoverageSummary, MetricKey } from '@coverage-insight/core';
import { METRIC_KEYS } from '@coverage-insight/core';

/** One point in the coverage time series (pct values per metric). */
export type HistoryPoint = {
  sha: string;
  timestamp?: string;
  metrics: Record<MetricKey, number>;
};

/**
 * A baseline entry as stored on the history branch (`baselines/<sha>.json`).
 * Structural copy of the action's baseline shape — packages/history must not
 * depend on packages/action.
 */
export type HistoryEntry = {
  sha: string;
  timestamp?: string;
  summary: CoverageSummary;
};

/** Shape of `index.json` on the history branch. Entries are newest first. */
export type HistoryIndex = {
  entries: { sha: string; timestamp?: string }[];
};

/** Default number of history entries read from the baseline branch. */
export const DEFAULT_MAX_HISTORY_ENTRIES = 30;

/**
 * Reads a file from the baseline/history branch. The action binds its own
 * octokit-backed implementation; tests pass a plain mock. Resolves to null
 * when the file does not exist.
 */
export type BranchFileReader = (path: string) => Promise<string | null>;

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as { sha?: unknown; summary?: unknown };
  if (typeof entry.sha !== 'string') return false;
  if (typeof entry.summary !== 'object' || entry.summary === null) return false;
  const total = (entry.summary as { total?: unknown }).total;
  if (typeof total !== 'object' || total === null) return false;
  return METRIC_KEYS.every((metric) => {
    const m = (total as Record<string, unknown>)[metric];
    return typeof m === 'object' && m !== null && typeof (m as { pct?: unknown }).pct === 'number';
  });
}

/**
 * Converts baseline entries into a time series, **oldest first** regardless of
 * input order: entries are first reversed (the index is newest first), then
 * stable-sorted by timestamp when both sides have one.
 */
export function entriesToSeries(entries: HistoryEntry[]): HistoryPoint[] {
  const oldestFirst = [...entries].reverse();
  oldestFirst.sort((a, b) => {
    if (!a.timestamp || !b.timestamp) return 0;
    if (a.timestamp < b.timestamp) return -1;
    if (a.timestamp > b.timestamp) return 1;
    return 0;
  });
  return oldestFirst.map((entry) => {
    const metrics = {} as Record<MetricKey, number>;
    for (const metric of METRIC_KEYS) {
      metrics[metric] = entry.summary.total[metric].pct;
    }
    return { sha: entry.sha, timestamp: entry.timestamp, metrics };
  });
}

/** Last `n` values of one metric from an oldest-first series (oldest first). */
export function lastN(series: HistoryPoint[], metric: MetricKey, n: number): number[] {
  if (n <= 0) return [];
  return series.slice(-n).map((point) => point.metrics[metric]);
}

/**
 * Reads up to `maxEntries` baseline entries (newest first, matching the index
 * order) from the history branch via `reader`. Missing or corrupt files —
 * including the index itself — are tolerated: corrupt entries are skipped and
 * a missing/corrupt index yields an empty array.
 */
export async function readHistoryEntries(
  reader: BranchFileReader,
  maxEntries: number = DEFAULT_MAX_HISTORY_ENTRIES
): Promise<HistoryEntry[]> {
  const indexRaw = await reader('index.json');
  if (indexRaw === null) return [];

  let indexEntries: HistoryIndex['entries'];
  try {
    const parsed = JSON.parse(indexRaw) as { entries?: unknown };
    if (!Array.isArray(parsed.entries)) return [];
    indexEntries = parsed.entries as HistoryIndex['entries'];
  } catch {
    return [];
  }

  const entries: HistoryEntry[] = [];
  for (const indexEntry of indexEntries.slice(0, maxEntries)) {
    if (typeof indexEntry !== 'object' || indexEntry === null) continue;
    if (typeof indexEntry.sha !== 'string') continue;
    const raw = await reader(`baselines/${indexEntry.sha}.json`);
    if (raw === null) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isHistoryEntry(parsed)) entries.push(parsed);
    } catch {
      // corrupt entry — skip
    }
  }
  return entries;
}
