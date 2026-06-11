import type { CoverageModel } from '../model';

/**
 * A coverage format parser plugin. Each parser knows how to recognize its
 * format from raw file content and normalize it into the shared
 * {@link CoverageModel} consumed by the diff engine, policy engine and
 * reporters.
 */
export type CoverageParser = {
  /** Stable identifier used in auto-detection diagnostics ('istanbul-summary' | 'v8' | 'lcov'). */
  name: string;
  /** Cheap content sniff — must not throw on arbitrary input. */
  detect(content: string): boolean;
  /** Full parse — may throw on malformed content of its own format. */
  parse(content: string): CoverageModel;
};

/** Thrown by `parseCoverage` when no registered parser recognizes the content. */
export class UnknownFormatError extends Error {
  constructor() {
    super(
      'Unrecognized coverage format. Supported formats: ' +
        'istanbul coverage-summary.json (json-summary reporter), ' +
        'v8/istanbul coverage-final.json (c8 / istanbul json reporter), ' +
        'and lcov (lcov.info).'
    );
    this.name = 'UnknownFormatError';
  }
}
