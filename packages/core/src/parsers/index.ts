import type { CoverageModel } from '../model';
import { istanbulSummaryParser } from './istanbulSummary';
import { lcovParser } from './lcov';
import { CoverageParser, UnknownFormatError } from './types';
import { v8Parser } from './v8';

export { istanbulSummaryParser } from './istanbulSummary';
export { lcovParser } from './lcov';
export { UnknownFormatError } from './types';
export type { CoverageParser } from './types';
export { v8Parser } from './v8';

/**
 * Registered parsers in detection order. JSON formats are tried first
 * (their detection is exact), lcov last.
 */
export const parsers: CoverageParser[] = [istanbulSummaryParser, v8Parser, lcovParser];

/**
 * Parses raw coverage file content into the normalized {@link CoverageModel},
 * auto-detecting the format via each registered parser's `detect()`.
 *
 * @throws {UnknownFormatError} when no parser recognizes the content.
 */
export function parseCoverage(content: string): CoverageModel {
  for (const parser of parsers) {
    if (parser.detect(content)) return parser.parse(content);
  }
  throw new UnknownFormatError();
}
