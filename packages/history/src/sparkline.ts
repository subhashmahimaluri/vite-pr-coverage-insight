export type SparklineOptions = {
  width?: number;
  height?: number;
  stroke?: string;
};

const DEFAULT_WIDTH = 120;
const DEFAULT_HEIGHT = 24;
const DEFAULT_STROKE = '#2da44e';
const PADDING = 2;

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

function fmt(value: number): string {
  return value.toFixed(2);
}

/**
 * Renders a compact, fully deterministic SVG sparkline (polyline) for a series
 * of values. Coordinates are normalized to the min/max of the series; a flat
 * series renders as a horizontal midline. No timestamps, ids, or randomness:
 * identical input always yields an identical SVG string.
 */
export function renderSparklineSvg(values: number[], opts: SparklineOptions = {}): string {
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const stroke = opts.stroke ?? DEFAULT_STROKE;

  const open =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" role="img" aria-label="coverage trend">`;
  if (values.length === 0) return `${open}</svg>`;

  // A single point is invisible as a polyline — extend it into a flat line.
  const points = values.length === 1 ? [values[0], values[0]] : values;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const innerWidth = width - 2 * PADDING;
  const innerHeight = height - 2 * PADDING;
  const stepX = innerWidth / (points.length - 1);

  const coords = points
    .map((value, i) => {
      const x = PADDING + i * stepX;
      const y =
        max === min ? height / 2 : PADDING + (1 - (value - min) / (max - min)) * innerHeight;
      return `${fmt(x)},${fmt(y)}`;
    })
    .join(' ');

  return (
    `${open}<polyline fill="none" stroke="${stroke}" stroke-width="1.5" ` +
    `points="${coords}"/></svg>`
  );
}

/**
 * Renders a unicode block-character sparkline (▁▂▃▄▅▆▇█) normalized to the
 * min/max of the series. A flat series renders as all ▄ (midline).
 */
export function renderUnicodeSparkline(values: number[]): string {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return BLOCKS[3].repeat(values.length);
  return values
    .map((value) => BLOCKS[Math.round(((value - min) / (max - min)) * (BLOCKS.length - 1))])
    .join('');
}
