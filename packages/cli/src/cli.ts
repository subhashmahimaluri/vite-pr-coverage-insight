import fs from 'fs';
import path from 'path';
import { parseArgs } from 'node:util';
import {
  applyInputOverrides,
  evaluatePolicy,
  loadConfig,
  parseCoverage,
  type CoverageModel,
  type PolicyResult,
} from '@coverage-insight/core';
import { buildReport, renderHtml, renderMarkdown } from '@coverage-insight/reporters';

/**
 * Stage 3.3 — `covins`: the non-GitHub story (GitLab, Jenkins, Azure, local).
 * Thin arg-parsing layer only; every drop of logic lives in core/reporters.
 * Exit codes for `check`: 0 pass, 1 warn, 2 fail.
 */

export type CliIo = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

const USAGE = `covins — coverage compare / gate / report

Usage:
  covins compare --base <file> --head <file>
  covins check   --head <file> [--base <file>]
  covins report  --head <file> [--base <file>] --format md|json|html [--out <path>]

Coverage files may be istanbul coverage-summary.json, lcov.info, or v8/c8
coverage-final.json (auto-detected). Thresholds/ratchet come from
coverage-insight.config.{ts,mjs,json} or the package.json "coverage-insight" key.`;

function readModel(file: string): CoverageModel {
  return parseCoverage(fs.readFileSync(path.resolve(file), 'utf-8'));
}

const VERDICT_EXIT: Record<PolicyResult['verdict'], number> = { pass: 0, warn: 1, fail: 2 };

function compareTable(base: CoverageModel, head: CoverageModel): string {
  const rows = (['statements', 'branches', 'functions', 'lines'] as const).map((metric) => {
    const b = base.total[metric].pct;
    const h = head.total[metric].pct;
    const delta = Math.round((h - b) * 100) / 100;
    const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '=';
    return `${metric.padEnd(10)} ${b.toFixed(2).padStart(7)}% ${h.toFixed(2).padStart(7)}%  ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}% ${arrow}`;
  });
  return [
    `${'metric'.padEnd(10)} ${'base'.padStart(8)} ${'head'.padStart(8)}  delta`,
    ...rows,
  ].join('\n');
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === 'help' || command === '--help') {
    io.stdout(USAGE);
    return 0;
  }

  const { values } = parseArgs({
    args: rest,
    options: {
      base: { type: 'string' },
      head: { type: 'string' },
      format: { type: 'string' },
      out: { type: 'string' },
      cwd: { type: 'string' },
    },
  });

  try {
    switch (command) {
      case 'compare': {
        if (!values.base || !values.head) throw new Error('compare requires --base and --head');
        io.stdout(compareTable(readModel(values.base), readModel(values.head)));
        return 0;
      }

      case 'check': {
        if (!values.head) throw new Error('check requires --head');
        const head = readModel(values.head);
        const base = values.base ? readModel(values.base) : null;
        const loaded = await loadConfig(values.cwd ?? process.cwd());
        const config = applyInputOverrides(loaded.config, {});
        const result = evaluatePolicy({ head, base, config });
        io.stdout(`verdict: ${result.verdict} (config: ${loaded.source})`);
        for (const v of result.violations) {
          io.stdout(
            `  ${v.rule} ${v.metric} @ ${v.scope}: ${v.actual}% (required ${v.required}%, gap ${v.gap})`
          );
        }
        return VERDICT_EXIT[result.verdict];
      }

      case 'report': {
        if (!values.head) throw new Error('report requires --head');
        const format = values.format ?? 'md';
        if (!['md', 'json', 'html'].includes(format)) {
          throw new Error(`unknown --format '${format}' — expected md, json or html`);
        }
        const head = readModel(values.head);
        const base = values.base ? readModel(values.base) : null;
        const loaded = await loadConfig(values.cwd ?? process.cwd());
        const policy = evaluatePolicy({ head, base, config: loaded.config });
        const report = buildReport({
          head,
          base,
          policy,
          generatedAt: new Date().toISOString(),
        });
        const output =
          format === 'md'
            ? renderMarkdown(report)
            : format === 'html'
              ? renderHtml(report)
              : JSON.stringify(report, null, 2);
        if (values.out) {
          fs.writeFileSync(path.resolve(values.out), output);
          io.stdout(`wrote ${values.out} (${format}, state: ${report.state})`);
        } else {
          io.stdout(output);
        }
        return 0;
      }

      default:
        io.stderr(`unknown command '${command}'\n\n${USAGE}`);
        return 2;
    }
  } catch (error) {
    io.stderr(`covins ${command}: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}
