import { METRIC_KEYS, type MetricKey } from '@coverage-insight/core';
import type { HistoryPoint } from './series';

/**
 * Composite metric band: one SVG with all four metric cards — value,
 * covered/total counts, delta pill, 30-run sparkline with area fill and
 * endpoint dot — colored by *policy threshold* when one is configured
 * (pass = green, within 2pp above = amber, below = red) and by the 80/60
 * coverage band otherwise. Committed to the baseline branch as
 * badges/metric-band-{light,dark}.svg (and per-PR variants) and embedded in
 * the comment via <picture> with prefers-color-scheme variants.
 * Deterministic: same series in, byte-identical SVG out (D7).
 */

const CARD_W = 196;
const CARD_H = 118;
const GAP = 8;
/** sparklines never zoom into noise: the y-domain spans at least this many pp */
const MIN_SPARK_SPAN = 4;
const LABELS: Record<MetricKey, string> = {
  statements: 'Statements',
  branches: 'Branches',
  functions: 'Functions',
  lines: 'Lines',
};

type Theme = 'light' | 'dark';

export type MetricBandOptions = {
  /** configured policy thresholds — drive the status color when present */
  thresholds?: Partial<Record<MetricKey, number>>;
};

const THEMES: Record<
  Theme,
  { bg: string; card: string; border: string; fg: string; muted: string; axis: string }
> = {
  light: {
    bg: '#ffffff',
    card: '#f6f8fa',
    border: '#d0d7de',
    fg: '#1f2328',
    muted: '#656d76',
    axis: '#d0d7de',
  },
  dark: {
    bg: '#0d1117',
    card: '#161b22',
    border: '#30363d',
    fg: '#e6edf3',
    muted: '#8b949e',
    axis: '#30363d',
  },
};

const STATUS = {
  light: { good: '#1a7f37', warn: '#9a6700', bad: '#cf222e' },
  dark: { good: '#3fb950', warn: '#d29922', bad: '#f85149' },
} as const;

/**
 * Explicit tint fills (no fill-opacity: several SVG renderers — including
 * image proxies — rasterize opacity unreliably, turning pills/areas solid).
 */
const TINTS = {
  light: { good: '#dafbe1', warn: '#fff8c5', bad: '#ffebe9', neutral: '#eaeef2' },
  dark: { good: '#12261e', warn: '#272115', bad: '#25171c', neutral: '#21262d' },
} as const;

type StatusKey = keyof (typeof STATUS)['light'];

function deltaColor(delta: number | null, theme: Theme): string {
  if (delta === null || delta === 0) return THEMES[theme].muted;
  return delta > 0 ? STATUS[theme].good : STATUS[theme].bad;
}

function deltaTint(delta: number | null, theme: Theme): string {
  if (delta === null || delta === 0) return TINTS[theme].neutral;
  return delta > 0 ? TINTS[theme].good : TINTS[theme].bad;
}

/**
 * Status key. Threshold-aware when the policy defines one: passing is
 * green, passing by less than 2pp is amber (at risk), failing is red.
 * Without a threshold, falls back to the 80/60 coverage bands.
 */
function statusKey(pct: number, required: number | undefined): StatusKey {
  if (required !== undefined) {
    if (pct < required) return 'bad';
    return pct - required < 2 ? 'warn' : 'good';
  }
  return pct >= 80 ? 'good' : pct >= 60 ? 'warn' : 'bad';
}

type SparkGeometry = {
  line: string;
  area: string;
  endX: number;
  endY: number;
  thresholdY: number | null;
};

/**
 * Sparkline geometry with a padded y-domain (≥ MIN_SPARK_SPAN pp) so noise in
 * a stable series doesn't render as cliffs, clamped to 0–100. Returns the
 * line path, a closed area path, the endpoint, and the threshold guide y
 * (when the threshold falls inside the domain).
 */
function sparkGeometry(
  values: number[],
  required: number | undefined,
  x0: number,
  y0: number,
  w: number,
  h: number
): SparkGeometry | null {
  if (values.length < 2) return null;
  let min = Math.min(...values);
  let max = Math.max(...values);
  const pad = Math.max(MIN_SPARK_SPAN - (max - min), 0) / 2;
  min = Math.max(0, min - pad);
  max = Math.min(100, max + pad);
  const span = max - min || 1;
  const pt = (v: number, i: number): [number, number] => [
    x0 + (i * w) / (values.length - 1),
    y0 + h - ((v - min) / span) * h,
  ];
  const coords = values.map((v, i) => pt(v, i));
  const line = coords
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
  const [endX, endY] = coords[coords.length - 1];
  const area =
    `${line} L${(x0 + w).toFixed(2)},${(y0 + h).toFixed(2)} ` +
    `L${x0.toFixed(2)},${(y0 + h).toFixed(2)} Z`;
  const thresholdY =
    required !== undefined && required >= min && required <= max
      ? y0 + h - ((required - min) / span) * h
      : null;
  return { line, area, endX, endY, thresholdY };
}

export function renderMetricBandSvg(
  series: HistoryPoint[],
  theme: Theme,
  opts: MetricBandOptions = {}
): string {
  const t = THEMES[theme];
  const width = CARD_W * 4 + GAP * 3;
  const cards = METRIC_KEYS.map((key, i) => {
    const points = series.slice(-30);
    const values = points.map((p) => p.metrics[key]);
    const current = values[values.length - 1] ?? 0;
    const previous = values.length > 1 ? values[values.length - 2] : null;
    const delta = previous === null ? null : Math.round((current - previous) * 100) / 100;
    const counts = points[points.length - 1]?.counts?.[key];
    const required = opts.thresholds?.[key];
    const status = statusKey(current, required);
    const color = STATUS[theme][status];
    const tint = TINTS[theme][status];
    // deltas smaller than the displayed precision (0.05pp) read as zero —
    // show the neutral pill instead of a misleading ▲0.0 / ▼0.0
    const shownDelta = delta !== null && Math.abs(delta) < 0.05 ? 0 : delta;
    const dColor = deltaColor(shownDelta, theme);
    const dTint = deltaTint(shownDelta, theme);
    const arrow = shownDelta === null || shownDelta === 0 ? '' : shownDelta > 0 ? '▲' : '▼';
    const deltaText =
      shownDelta === null
        ? ''
        : shownDelta === 0
          ? '±0.0'
          : `${arrow}${Math.abs(shownDelta).toFixed(1)}`;
    const x = i * (CARD_W + GAP);
    const spark = sparkGeometry(values, required, x + 14, 78, CARD_W - 28, 24);

    const deltaPill = deltaText
      ? [
          `<rect x="${x + CARD_W - 14 - 52}" y="32" width="52" height="20" rx="10" fill="${dTint}"/>`,
          `<text x="${x + CARD_W - 14 - 26}" y="46" font-size="12" font-weight="600" text-anchor="middle" fill="${dColor}">${deltaText}</text>`,
        ].join('')
      : '';

    const sparkSvg = spark
      ? [
          `<line x1="${x + 14}" y1="102" x2="${x + CARD_W - 14}" y2="102" stroke="${t.axis}" stroke-width="1"/>`,
          `<path d="${spark.area}" fill="${tint}"/>`,
          spark.thresholdY !== null
            ? `<line x1="${x + 14}" y1="${spark.thresholdY.toFixed(2)}" x2="${x + CARD_W - 14}" y2="${spark.thresholdY.toFixed(2)}" stroke="${t.muted}" stroke-width="1" stroke-dasharray="3,3"/>`
            : '',
          `<path d="${spark.line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
          `<circle cx="${spark.endX.toFixed(2)}" cy="${spark.endY.toFixed(2)}" r="3" fill="${color}"/>`,
        ].join('')
      : '';

    return [
      `<rect x="${x}" y="0" width="${CARD_W}" height="${CARD_H}" rx="8" fill="${t.card}" stroke="${t.border}" stroke-width="1"/>`,
      `<text x="${x + 14}" y="22" font-size="12" fill="${t.muted}">${LABELS[key]}${required !== undefined ? ` · min ${required}%` : ''}</text>`,
      `<text x="${x + 14}" y="50" font-size="22" font-weight="700" fill="${color}">${current.toFixed(1)}%</text>`,
      deltaPill,
      counts
        ? `<text x="${x + 14}" y="68" font-size="11" fill="${t.muted}">${counts.covered}/${counts.total} covered</text>`
        : '',
      sparkSvg,
    ].join('');
  }).join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${CARD_H}" ` +
    `viewBox="0 0 ${width} ${CARD_H}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" role="img" ` +
    `aria-label="coverage metrics">` +
    `<rect width="${width}" height="${CARD_H}" fill="${t.bg}"/>${cards}</svg>`
  );
}

export function metricBandPath(theme: Theme): string {
  return `badges/metric-band-${theme}.svg`;
}

/** per-PR band: the head run appended to the history series, live PR values */
export function prMetricBandPath(prNumber: number, theme: Theme): string {
  return `badges/pr-${prNumber}-metric-band-${theme}.svg`;
}
