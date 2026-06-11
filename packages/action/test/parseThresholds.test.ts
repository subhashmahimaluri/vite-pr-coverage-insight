import { describe, expect, it } from 'vitest';
import { parseThresholdsInput } from '../src/parseThresholds';

describe('parseThresholdsInput', () => {
  it('plain number applies to all four metrics', () => {
    expect(parseThresholdsInput('80')).toEqual({
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80,
    });
  });

  it('per-metric pairs with : or =', () => {
    expect(parseThresholdsInput('lines:85, branches=75')).toEqual({ lines: 85, branches: 75 });
  });

  it('JSON object form', () => {
    expect(parseThresholdsInput('{"lines":85,"functions":70}')).toEqual({
      lines: 85,
      functions: 70,
    });
  });

  it('empty input yields no thresholds', () => {
    expect(parseThresholdsInput('  ')).toEqual({});
  });

  it('rejects unknown metrics, out-of-range values and garbage', () => {
    expect(() => parseThresholdsInput('blah:90')).toThrow(/unknown metric/);
    expect(() => parseThresholdsInput('150')).toThrow(/0–100/);
    expect(() => parseThresholdsInput('lines:abc')).toThrow(/0–100/);
    expect(() => parseThresholdsInput('{broken')).toThrow(/JSON/);
  });
});
