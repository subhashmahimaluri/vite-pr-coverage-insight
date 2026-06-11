import {
  evaluatePolicy,
  METRIC_KEYS,
  type Config,
  type CoverageMetric,
  type CoverageModel,
  type MetricKey,
  type PolicyVerdict,
  type ProjectReport,
  type Thresholds,
} from '@coverage-insight/core';
import { buildReport } from './buildReport';

/**
 * Stage 6.3 — monorepo projects: per-project parse → diff → policy, one
 * comment with per-project verdict rows (state 8), worst verdict wins.
 */

export type ProjectInput = {
  name: string;
  /** path prefix that owns this project's files (used to slice the baseline) */
  path: string;
  head: CoverageModel;
  /** explicit per-project base; omit to slice `repoBase` by path prefix */
  base?: CoverageModel | null;
  thresholds?: Thresholds;
};

function emptyMetric(): CoverageMetric {
  return { pct: 100, total: 0, covered: 0, skipped: 0 };
}

/** Recomputes a sub-model containing only files under the given path prefix. */
export function sliceModelByPathPrefix(model: CoverageModel, prefix: string): CoverageModel {
  const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
  const files = model.files.filter(
    (f) => f.path.startsWith(normalized) || f.path.startsWith(prefix)
  );
  const total = {} as Record<MetricKey, CoverageMetric>;
  for (const key of METRIC_KEYS) {
    let covered = 0;
    let totalCount = 0;
    let skipped = 0;
    for (const file of files) {
      covered += file.metrics[key].covered;
      totalCount += file.metrics[key].total;
      skipped += file.metrics[key].skipped;
    }
    total[key] =
      totalCount === 0
        ? emptyMetric()
        : {
            covered,
            total: totalCount,
            skipped,
            pct: Math.round((covered / totalCount) * 10000) / 100,
          };
  }
  return { total, files };
}

export function buildProjectReports(
  projects: ProjectInput[],
  rootConfig: Config,
  repoBase?: CoverageModel | null
): ProjectReport[] {
  return projects.map((project) => {
    const base =
      project.base !== undefined
        ? project.base
        : repoBase
          ? sliceModelByPathPrefix(repoBase, project.path)
          : null;

    const config: Config = project.thresholds
      ? { ...rootConfig, thresholds: { ...rootConfig.thresholds, ...project.thresholds } }
      : rootConfig;

    const policy = evaluatePolicy({ head: project.head, base, config });
    const report = buildReport({
      head: project.head,
      base,
      policy,
      generatedAt: '1970-01-01T00:00:00.000Z', // discarded — only state/totals/files survive
    });

    return {
      name: project.name,
      state: report.state,
      totals: report.totals!,
      files: report.files!,
      policy,
    };
  });
}

const VERDICT_RANK: Record<PolicyVerdict, number> = { pass: 0, warn: 1, fail: 2 };

/** Worst verdict wins — drives the aggregate check-run conclusion/exit code. */
export function aggregateVerdict(projects: ProjectReport[]): PolicyVerdict {
  let worst: PolicyVerdict = 'pass';
  for (const project of projects) {
    if (VERDICT_RANK[project.policy.verdict] > VERDICT_RANK[worst]) {
      worst = project.policy.verdict;
    }
  }
  return worst;
}
