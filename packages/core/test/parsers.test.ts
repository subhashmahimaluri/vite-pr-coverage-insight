import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { METRIC_KEYS, type CoverageModel, type FileCoverage } from '../src/model';
import {
  istanbulSummaryParser,
  lcovParser,
  parseCoverage,
  parsers,
  UnknownFormatError,
  v8Parser,
} from '../src/parsers';

const formatsDir = path.resolve(__dirname, '../../../fixtures/formats');
const summaryContent = fs.readFileSync(path.join(formatsDir, 'coverage-summary.json'), 'utf-8');
const finalContent = fs.readFileSync(path.join(formatsDir, 'coverage-final.json'), 'utf-8');
const lcovContent = fs.readFileSync(path.join(formatsDir, 'lcov.info'), 'utf-8');

const PCT_TOLERANCE = 0.1;

function fileByPath(model: CoverageModel, filePath: string): FileCoverage {
  const file = model.files.find((f) => f.path === filePath);
  expect(file, `expected model to contain ${filePath}`).toBeDefined();
  return file as FileCoverage;
}

function expectPctClose(actual: number, expected: number, label: string): void {
  expect(Math.abs(actual - expected), `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(
    PCT_TOLERANCE
  );
}

describe('parser equivalence across formats', () => {
  const models = {
    'istanbul-summary': istanbulSummaryParser.parse(summaryContent),
    v8: v8Parser.parse(finalContent),
    lcov: lcovParser.parse(lcovContent),
  };
  const names = Object.keys(models) as (keyof typeof models)[];
  const reference = models['istanbul-summary'];

  it('all three fixtures describe the same two files', () => {
    for (const name of names) {
      expect(models[name].files.map((f) => f.path).sort()).toEqual(['src/math.ts', 'src/util.ts']);
    }
  });

  it.each(names)('%s totals match the reference within 0.1 pct', (name) => {
    for (const metric of METRIC_KEYS) {
      expectPctClose(
        models[name].total[metric].pct,
        reference.total[metric].pct,
        `total.${metric}`
      );
    }
  });

  it.each(names)('%s per-file pcts match the reference within 0.1 pct', (name) => {
    for (const file of reference.files) {
      const other = fileByPath(models[name], file.path);
      for (const metric of METRIC_KEYS) {
        expectPctClose(
          other.metrics[metric].pct,
          file.metrics[metric].pct,
          `${file.path}.${metric}`
        );
      }
    }
  });

  it('lcov and v8 agree on uncovered lines (summary fixture carries no line detail)', () => {
    expect(fileByPath(models.lcov, 'src/math.ts').uncoveredLines).toEqual([7, 9]);
    expect(fileByPath(models.v8, 'src/math.ts').uncoveredLines).toEqual([7, 9]);
    expect(fileByPath(models.lcov, 'src/util.ts').uncoveredLines).toBeUndefined();
    expect(fileByPath(models.v8, 'src/util.ts').uncoveredLines).toBeUndefined();
  });

  it('exact expectations for the fixture project', () => {
    for (const name of names) {
      const model = models[name];
      expect(model.total.lines).toMatchObject({ total: 15, covered: 13 });
      expect(model.total.functions).toMatchObject({ total: 3, covered: 3, pct: 100 });
      expect(model.total.branches).toMatchObject({ total: 4, covered: 3, pct: 75 });
      expect(fileByPath(model, 'src/math.ts').metrics.lines.pct).toBe(80);
      expect(fileByPath(model, 'src/util.ts').metrics.lines.pct).toBe(100);
    }
  });
});

describe('auto-detection', () => {
  it('registers parsers in order istanbul-summary, v8, lcov', () => {
    expect(parsers.map((p) => p.name)).toEqual(['istanbul-summary', 'v8', 'lcov']);
  });

  it('each parser detects only its own fixture', () => {
    expect(istanbulSummaryParser.detect(summaryContent)).toBe(true);
    expect(v8Parser.detect(summaryContent)).toBe(false);
    expect(lcovParser.detect(summaryContent)).toBe(false);

    expect(istanbulSummaryParser.detect(finalContent)).toBe(false);
    expect(v8Parser.detect(finalContent)).toBe(true);
    expect(lcovParser.detect(finalContent)).toBe(false);

    expect(istanbulSummaryParser.detect(lcovContent)).toBe(false);
    expect(v8Parser.detect(lcovContent)).toBe(false);
    expect(lcovParser.detect(lcovContent)).toBe(true);
  });

  it('parseCoverage routes each fixture to the right parser', () => {
    expect(parseCoverage(summaryContent)).toEqual(istanbulSummaryParser.parse(summaryContent));
    expect(parseCoverage(finalContent)).toEqual(v8Parser.parse(finalContent));
    expect(parseCoverage(lcovContent)).toEqual(lcovParser.parse(lcovContent));
  });

  it('throws UnknownFormatError naming the supported formats on garbage input', () => {
    for (const garbage of ['hello world', '', '[1,2,3]', '{"foo": "bar"}']) {
      let caught: unknown;
      try {
        parseCoverage(garbage);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(UnknownFormatError);
      const message = (caught as Error).message;
      expect(message).toContain('istanbul');
      expect(message).toContain('lcov');
      expect(message).toContain('v8');
    }
  });
});

describe('lcov edge cases', () => {
  it('handles an empty record (SF immediately followed by end_of_record)', () => {
    const model = lcovParser.parse('TN:\nSF:src/empty.ts\nend_of_record\n');
    expect(model.files).toHaveLength(1);
    const file = model.files[0];
    expect(file.path).toBe('src/empty.ts');
    for (const metric of METRIC_KEYS) {
      expect(file.metrics[metric]).toEqual({ total: 0, covered: 0, skipped: 0, pct: 100 });
    }
    expect(file.uncoveredLines).toBeUndefined();
  });

  it('reports pct 100 for a file with 0 branches (istanbul convention)', () => {
    const model = lcovParser.parse(
      'SF:src/util.ts\nFNF:1\nFNH:1\nDA:1,1\nLF:1\nLH:1\nend_of_record\n'
    );
    expect(model.files[0].metrics.branches).toEqual({
      total: 0,
      covered: 0,
      skipped: 0,
      pct: 100,
    });
  });

  it('merges duplicated DA lines with hits>0 without double counting', () => {
    const model = lcovParser.parse('SF:src/a.ts\nDA:1,1\nDA:1,2\nDA:2,0\nend_of_record\n');
    const file = model.files[0];
    expect(file.metrics.lines).toEqual({ total: 2, covered: 1, skipped: 0, pct: 50 });
    expect(file.uncoveredLines).toEqual([2]);
  });

  it('a duplicated DA line covered on the second pass is not reported uncovered', () => {
    const model = lcovParser.parse('SF:src/a.ts\nDA:1,0\nDA:1,3\nend_of_record\n');
    const file = model.files[0];
    expect(file.metrics.lines).toEqual({ total: 1, covered: 1, skipped: 0, pct: 100 });
    expect(file.uncoveredLines).toBeUndefined();
  });

  it('derives line totals from DA entries when LF/LH are absent', () => {
    const model = lcovParser.parse('SF:src/a.ts\nDA:1,1\nDA:2,0\nDA:3,1\nend_of_record\n');
    expect(model.files[0].metrics.lines).toMatchObject({ total: 3, covered: 2 });
    expect(model.files[0].metrics.statements).toMatchObject({ total: 3, covered: 2 });
  });
});

describe('istanbul-summary edge cases', () => {
  it('coerces the literal pct "Unknown" to 0', () => {
    const content = JSON.stringify({
      total: {
        lines: { total: 0, covered: 0, skipped: 0, pct: 'Unknown' },
        statements: { total: 0, covered: 0, skipped: 0, pct: 'Unknown' },
        functions: { total: 0, covered: 0, skipped: 0, pct: 'Unknown' },
        branches: { total: 0, covered: 0, skipped: 0, pct: 'Unknown' },
      },
    });
    const model = parseCoverage(content);
    for (const metric of METRIC_KEYS) {
      expect(model.total[metric].pct).toBe(0);
    }
    expect(model.files).toEqual([]);
  });
});
