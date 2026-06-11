import { describe, expect, it } from 'vitest';
import { relativizeModel, relativizePath, summaryToModel } from '../src';
import { loadFixturePair } from './helpers';

const RUNNER_ROOT = '/home/runner/work/demo/demo';

describe('relativizePath', () => {
  it('strips the workspace prefix', () => {
    expect(relativizePath(`${RUNNER_ROOT}/app/error.tsx`, RUNNER_ROOT)).toBe('app/error.tsx');
    expect(relativizePath(`${RUNNER_ROOT}/app/error.tsx`, `${RUNNER_ROOT}/`)).toBe('app/error.tsx');
  });

  it('leaves non-matching and empty-root paths alone', () => {
    expect(relativizePath('src/x.ts', RUNNER_ROOT)).toBe('src/x.ts');
    expect(relativizePath('/other/place/x.ts', RUNNER_ROOT)).toBe('/other/place/x.ts');
    expect(relativizePath('/abs/x.ts', '')).toBe('/abs/x.ts');
  });
});

describe('relativizeModel', () => {
  it('rewrites file paths and keeps metrics and totals intact', () => {
    const { head } = loadFixturePair('improvement');
    const model = summaryToModel(head);
    const prefixed = {
      total: model.total,
      files: model.files.map((f) => ({ ...f, path: `${RUNNER_ROOT}${f.path}` })),
    };

    const relative = relativizeModel(prefixed, RUNNER_ROOT);
    expect(relative.files.map((f) => f.path)).toEqual(model.files.map((f) => f.path.slice(1)));
    expect(relative.total).toEqual(model.total);
    expect(relative.files[0].metrics).toEqual(model.files[0].metrics);
  });
});
