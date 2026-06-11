import type { MetricKey } from '@coverage-insight/core';
import { METRIC_KEYS } from '@coverage-insight/core';
import { renderDeltaBadgeSvg, shieldsEndpointJson } from './badge';
import type { HistoryPoint } from './series';
import { renderSparklineSvg } from './sparkline';

export type BadgeFile = {
  path: string;
  content: string;
};

export function sparklinePath(metric: MetricKey): string {
  return `badges/sparkline-${metric}.svg`;
}

export function badgePath(metric: MetricKey): string {
  return `badges/badge-${metric}.svg`;
}

export function endpointPath(metric: MetricKey): string {
  return `badges/endpoint-${metric}.json`;
}

/**
 * Builds the badge files the action commits to the history branch: per metric
 * a sparkline SVG, a delta badge SVG, and a shields.io endpoint JSON (12 files
 * total). Current value = last point of the (oldest-first) series; delta =
 * last minus second-to-last, or null when the series has fewer than 2 points.
 */
export function badgeFiles(series: HistoryPoint[]): BadgeFile[] {
  const last = series.length > 0 ? series[series.length - 1] : undefined;
  const previous = series.length > 1 ? series[series.length - 2] : undefined;

  const files: BadgeFile[] = [];
  for (const metric of METRIC_KEYS) {
    const values = series.map((point) => point.metrics[metric]);
    const current = last ? last.metrics[metric] : 0;
    const delta = last && previous ? current - previous.metrics[metric] : null;

    files.push({ path: sparklinePath(metric), content: renderSparklineSvg(values) });
    files.push({ path: badgePath(metric), content: renderDeltaBadgeSvg(metric, current, delta) });
    files.push({ path: endpointPath(metric), content: shieldsEndpointJson(metric, current) });
  }
  return files;
}

/**
 * GitHub markdown cannot inline SVG, so sparklines are embedded as image
 * links against raw.githubusercontent.com. Caveat: on **private repos** raw
 * URLs require authentication, so the images will not render for most
 * viewers — the comment should fall back to the unicode sparkline
 * (`unicodeSparklines` config flag, default on).
 */
export const PRIVATE_REPO_RAW_URL_CAVEAT =
  'raw.githubusercontent.com URLs require authentication on private repositories; ' +
  'badge/sparkline images will not render in PR comments there. Use the unicode ' +
  'sparkline fallback (unicodeSparklines: true, the default) instead.';

export type CommentImageOptions = {
  owner: string;
  repo: string;
  /** History branch the badges are committed to (e.g. "coverage-baseline"). */
  branch: string;
  metric: MetricKey;
};

/** Raw-URL image markdown for one metric's sparkline, for the PR comment. */
export function commentImageMarkdown(opts: CommentImageOptions): string {
  const url =
    `https://raw.githubusercontent.com/${opts.owner}/${opts.repo}/` +
    `${opts.branch}/${sparklinePath(opts.metric)}`;
  return `![${opts.metric} trend](${url})`;
}
