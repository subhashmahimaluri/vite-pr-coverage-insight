import type { MetricKey } from '@coverage-insight/core';

const BADGE_HEIGHT = 20;
/** Approximate Verdana 11px advance per character — no canvas measurement, fully deterministic. */
const CHAR_WIDTH = 6.5;
/** Horizontal padding per badge segment (total, split evenly). */
const SEGMENT_PADDING = 10;

const LABEL_FILL = '#555';
const GREEN = '#4c1';
const RED = '#e05d44';
const GRAY = '#9f9f9f';

/** Formats a number for SVG attributes without float noise ("42.5", "90"). */
function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function segmentWidth(text: string): number {
  return text.length * CHAR_WIDTH + SEGMENT_PADDING;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Value text such as "90.1% ▲0.4", "88.0% ▼0.2", "90.1% ■" (zero/null delta). */
export function deltaBadgeValue(current: number, delta: number | null): string {
  const pct = `${current.toFixed(1)}%`;
  if (delta === null || delta === 0) return `${pct} ■`;
  if (delta > 0) return `${pct} ▲${delta.toFixed(1)}`;
  return `${pct} ▼${Math.abs(delta).toFixed(1)}`;
}

/**
 * Renders a shields-style flat SVG badge: label = metric name, value = current
 * percentage plus delta arrow. Green when delta ≥ 0, red when delta < 0, gray
 * when delta is null (no baseline to compare against). Deterministic — text
 * width is approximated at 6.5px per character plus padding.
 */
export function renderDeltaBadgeSvg(
  metric: MetricKey,
  current: number,
  delta: number | null
): string {
  const label = metric;
  const value = deltaBadgeValue(current, delta);
  const valueFill = delta === null ? GRAY : delta < 0 ? RED : GREEN;

  const labelWidth = segmentWidth(label);
  const valueWidth = segmentWidth(value);
  const totalWidth = labelWidth + valueWidth;
  const ariaLabel = escapeXml(`${label}: ${value}`);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(totalWidth)}" ` +
    `height="${BADGE_HEIGHT}" role="img" aria-label="${ariaLabel}">` +
    `<rect width="${num(labelWidth)}" height="${BADGE_HEIGHT}" fill="${LABEL_FILL}"/>` +
    `<rect x="${num(labelWidth)}" width="${num(valueWidth)}" height="${BADGE_HEIGHT}" ` +
    `fill="${valueFill}"/>` +
    `<g fill="#fff" text-anchor="middle" ` +
    `font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">` +
    `<text x="${num(labelWidth / 2)}" y="14">${escapeXml(label)}</text>` +
    `<text x="${num(labelWidth + valueWidth / 2)}" y="14">${escapeXml(value)}</text>` +
    `</g></svg>`
  );
}

/** shields.io color for a coverage percentage. */
export function shieldsColor(
  pct: number
): 'brightgreen' | 'green' | 'yellowgreen' | 'yellow' | 'orange' | 'red' {
  if (pct >= 90) return 'brightgreen';
  if (pct >= 80) return 'green';
  if (pct >= 70) return 'yellowgreen';
  if (pct >= 60) return 'yellow';
  if (pct >= 50) return 'orange';
  return 'red';
}

/**
 * JSON for a shields.io endpoint badge
 * (https://shields.io/badges/endpoint-badge), suitable for committing to the
 * history branch and referencing from a README.
 */
export function shieldsEndpointJson(metric: MetricKey, current: number): string {
  return JSON.stringify({
    schemaVersion: 1,
    label: `coverage:${metric}`,
    message: `${current.toFixed(1)}%`,
    color: shieldsColor(current),
  });
}
