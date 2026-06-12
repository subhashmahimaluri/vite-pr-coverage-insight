import { METRIC_KEYS, type MetricKey } from '@coverage-insight/core';
import type { HistoryPoint } from './series';

/**
 * Composite metric band: one SVG with all four metric cards — value,
 * covered/total counts, delta arrow, 30-run sparkline — value and sparkline
 * colored by coverage band. Committed to the baseline branch as
 * badges/metric-band-{light,dark}.svg (and per-PR variants) and embedded in
 * the comment via <picture> with prefers-color-scheme variants.
 * Deterministic: same series in, byte-identical SVG out (D7).
 */

const CARD_W = 196;
const CARD_H = 112;
const GAP = 8;
const LABELS: Record<MetricKey, string> = {
  statements: 'Statements',
  branches: 'Branches',
  functions: 'Functions',
  lines: 'Lines',
};

type Theme = 'light' | 'dark';

const THEMES: Record<Theme, { bg: string; card: string; fg: string; muted: string }> = {
  light: { bg: '#ffffff', card: '#f6f8fa', fg: '#1f2328', muted: '#656d76' },
  dark: { bg: '#0d1117', card: '#161b22', fg: '#e6edf3', muted: '#8b949e' },
};

function deltaColor(delta: number | null, theme: Theme): string {
  if (delta === null || delta === 0) return THEMES[theme].muted;
  return delta > 0 ? '#1a7f37' : '#cf222e';
}

/** value + sparkline colored by coverage band so a flat delta is not gray */
function bandColor(pct: number): string {
  return pct >= 80 ? '#1a7f37' : pct >= 60 ? '#9a6700' : '#cf222e';
}

function sparklinePath(values: number[], x0: number, y0: number, w: number, h: number): string {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = (x0 + (i * w) / (values.length - 1)).toFixed(2);
      const y = (y0 + h - ((v - min) / span) * h).toFixed(2);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
}

/** the hero card: what the coverage gate decided, in one glance */
export type GateCardInfo = {
  verdict: 'pass' | 'warn' | 'fail';
  /** e.g. '2 violations', 'all thresholds met', 'report-only' */
  subtitle: string;
};

const VERDICT_STYLE: Record<GateCardInfo['verdict'], { color: string; label: string }> = {
  pass: { color: '#1a7f37', label: 'PASS' },
  warn: { color: '#9a6700', label: 'PASS' }, // decreased within tolerance still passes
  fail: { color: '#cf222e', label: 'FAIL' },
};

function gateCard(gate: GateCardInfo, series: HistoryPoint[], theme: Theme): string {
  const t = THEMES[theme];
  const style = VERDICT_STYLE[gate.verdict];
  // the gate card sparkline shows the overall trend via lines%
  const values = series.slice(-30).map((p) => p.metrics.lines);
  const spark = sparklinePath(values, 14, 76, CARD_W - 28, 22);
  const subtitle = gate.subtitle.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return [
    `<rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" rx="8" fill="${t.card}" stroke="${style.color}" stroke-width="1.5"/>`,
    `<text x="14" y="22" font-size="12" fill="${t.muted}">🚦 Coverage gate</text>`,
    `<circle cx="${CARD_W - 18}" cy="18" r="4" fill="${style.color}"/>`,
    `<text x="14" y="48" font-size="22" font-weight="700" fill="${style.color}">${style.label}</text>`,
    `<text x="14" y="66" font-size="11" fill="${gate.verdict === 'fail' ? style.color : t.muted}">${subtitle}</text>`,
    spark ? `<path d="${spark}" fill="none" stroke="${style.color}" stroke-width="2"/>` : '',
  ].join('');
}

export function renderMetricBandSvg(
  series: HistoryPoint[],
  theme: Theme,
  opts: { gate?: GateCardInfo } = {}
): string {
  const t = THEMES[theme];
  const offset = opts.gate ? 1 : 0;
  const cardCount = 4 + offset;
  const width = CARD_W * cardCount + GAP * (cardCount - 1);
  const cards = METRIC_KEYS.map((key, index) => {
    const i = index + offset;
    const points = series.slice(-30);
    const values = points.map((p) => p.metrics[key]);
    const current = values[values.length - 1] ?? 0;
    const previous = values.length > 1 ? values[values.length - 2] : null;
    const delta = previous === null ? null : Math.round((current - previous) * 100) / 100;
    const counts = points[points.length - 1]?.counts?.[key];
    const color = bandColor(current);
    const dColor = deltaColor(delta, theme);
    const arrow = delta === null || delta === 0 ? '' : delta > 0 ? '▲' : '▼';
    const deltaText =
      delta === null ? '' : delta === 0 ? '±0.0' : `${arrow}${Math.abs(delta).toFixed(1)}`;
    const x = i * (CARD_W + GAP);
    const spark = sparklinePath(values, x + 14, 76, CARD_W - 28, 22);
    return [
      `<rect x="${x}" y="0" width="${CARD_W}" height="${CARD_H}" rx="8" fill="${t.card}"/>`,
      `<text x="${x + 14}" y="22" font-size="12" fill="${t.muted}">${LABELS[key]}</text>`,
      `<text x="${x + 14}" y="48" font-size="22" font-weight="700" fill="${color}">${current.toFixed(1)}%</text>`,
      deltaText
        ? `<text x="${x + CARD_W - 14}" y="48" font-size="13" font-weight="600" text-anchor="end" fill="${dColor}">${deltaText}</text>`
        : '',
      counts
        ? `<text x="${x + 14}" y="66" font-size="11" fill="${t.muted}">${counts.covered}/${counts.total} covered</text>`
        : '',
      spark ? `<path d="${spark}" fill="none" stroke="${color}" stroke-width="2"/>` : '',
    ].join('');
  }).join('');

  const lead = opts.gate ? gateCard(opts.gate, series, theme) : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${CARD_H}" ` +
    `viewBox="0 0 ${width} ${CARD_H}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" role="img" ` +
    `aria-label="coverage gate verdict and metrics">` +
    `<rect width="${width}" height="${CARD_H}" fill="${t.bg}"/>${lead}${cards}</svg>`
  );
}

export function metricBandPath(theme: Theme): string {
  return `badges/metric-band-${theme}.svg`;
}

/**
 * Per-PR band: the head run appended to the history series, live PR values.
 * `uniq` (sha + run id) goes INTO the filename — camo and the raw CDN cache
 * by path, so a fixed path can serve a stale band no matter the query string.
 */
export function prMetricBandPath(prNumber: number, theme: Theme, uniq?: string): string {
  return uniq
    ? `badges/pr-${prNumber}/${uniq}-${theme}.svg`
    : `badges/pr-${prNumber}-metric-band-${theme}.svg`;
}
