// src/utils/github.ts
import type { GitHub } from "@actions/github/lib/utils";

export async function upsertCoverageComment({
  octokit,
  owner,
  repo,
  prNumber,
  body,
  botTag = "vite-pr-coverage-insight",
}: {
  octokit: InstanceType<typeof GitHub>;
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
  botTag?: string;
}) {
  const { data: comments } = await octokit.rest.issues.listComments({
    issue_number: prNumber,
    owner,
    repo,
  });

  const existing = comments.find((c) =>
    c.body?.includes(`Reported by **${botTag}**`)
  );

  const taggedBody = `${body}\n\n_Reported by **${botTag}**_`;

  if (existing) {
    await octokit.rest.issues.updateComment({
      comment_id: existing.id,
      owner,
      repo,
      body: taggedBody,
    });
  } else {
    await octokit.rest.issues.createComment({
      issue_number: prNumber,
      owner,
      repo,
      body: taggedBody,
    });
  }
}

// src/utils/formatMarkdown.ts
export function formatCoverageMarkdown(rows: {
  metric: string;
  base: number;
  pr: number;
  delta: number;
  symbol: string;
}[], reducedFiles?: { file: string; delta: number }[]) {
  const header = `### 📊 Vite Coverage Report\n\n| Metric     | Base     | PR       | ∆        |\n|------------|----------|----------|----------|`;

  const lines = rows.map(
    ({ metric, base, pr, delta, symbol }) => {
      let coloredSymbol = symbol;
      if (symbol === '⬆️') coloredSymbol = '🟢⬆️';
      else if (symbol === '⬇️') coloredSymbol = '🟠⬇️';
      return `| ${metric} | ${base.toFixed(2)}% | ${pr.toFixed(2)}% | ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}% ${coloredSymbol} |`;
    }
  );

  const fileDetails = reducedFiles?.length
    ? [
        "\n<details><summary>📉 Files with Reduced Coverage</summary>\n",
        "\n| File | Coverage Drop |\n|------|----------------|",
        ...reducedFiles.map(
          ({ file, delta }) => `| \`${file}\` | ${delta.toFixed(2)}% 🟠⬇️ |`
        ),
        "</details>"
      ].join("\n")
    : "";

  return [header, ...lines, fileDetails].join("\n");
}

// src/utils/compareCoverage.ts
export type CoverageSummary = {
  total: {
    lines: { pct: number };
    statements: { pct: number };
    functions: { pct: number };
    branches: { pct: number };
  };
};

export function compareCoverage(base: CoverageSummary, pr: CoverageSummary) {
  const metrics = ['statements', 'branches', 'functions', 'lines'] as const;

  return metrics.map((metric) => {
    const basePct = base.total[metric].pct ?? 0;
    const prPct = pr.total[metric].pct ?? 0;
    const delta = parseFloat((prPct - basePct).toFixed(2));

    return {
      metric,
      base: basePct,
      pr: prPct,
      delta,
      symbol: delta > 0 ? '⬆️' : delta < 0 ? '⬇️' : '➖',
    };
  });
}
