import type { CoverageReport } from '@coverage-insight/core';
import { escapeHtml, jsonForScript } from './escape';
import {
  METRIC_KEYS,
  METRIC_LABELS,
  covClass,
  deltaClass,
  filesOf,
  fmtDelta,
  fmtPct,
  linesThreshold,
  metricOf,
  shortSha,
  topLevelDir,
} from './util';

/**
 * Stage 4.4 — single self-contained HTML artifact. Zero external requests
 * (inline CSS/JS, CSP meta forbids everything), opens from file://, renders
 * the same schemaVersion-1 JSON the comment used. Deterministic: same report
 * in, byte-identical document out.
 */

const STATE_BADGES: Record<CoverageReport['state'], { label: string; cls: string }> = {
  passed: { label: '✅ Coverage gate passed', cls: 'ok' },
  'threshold-failed': { label: '❌ Coverage gate failed', cls: 'fail' },
  'tests-failed': { label: '🛑 Tests failed', cls: 'fail' },
  regression: { label: '🔻 Coverage regression', cls: 'warn' },
  'no-baseline': { label: 'ℹ️ Baseline recorded', cls: 'info' },
  'invalid-data': { label: '⚠️ Coverage report error', cls: 'warn' },
  'no-change': { label: '✅ Coverage unchanged', cls: 'ok' },
  monorepo: { label: '📦 Monorepo coverage', cls: 'info' },
};

function totalsCards(report: CoverageReport): string {
  if (!report.totals) return '';
  return METRIC_KEYS.map((key) => {
    const m = metricOf(report.totals, key);
    if (!m) return '';
    return `<div class="card ${covClass(m.head)}"><div class="card-label">${METRIC_LABELS[key]}</div><div class="card-value">${fmtPct(m.head)}</div><div class="card-delta ${deltaClass(m.delta)}">${fmtDelta(m.delta)}</div></div>`;
  }).join('');
}

function trendSvg(report: CoverageReport): string {
  const history = report.history ?? [];
  if (history.length < 2) return '';
  const width = 640;
  const height = 120;
  const pad = 8;
  const values = history.map((h) => h.lines);
  const min = Math.min(...values, linesThreshold(report) ?? Infinity);
  const max = Math.max(...values, linesThreshold(report) ?? -Infinity);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (width - 2 * pad)) / (values.length - 1);
  const y = (v: number) => height - pad - ((v - min) * (height - 2 * pad)) / span;
  const points = values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');

  const threshold = linesThreshold(report);
  const thresholdLine =
    threshold !== undefined
      ? `<line x1="${pad}" x2="${width - pad}" y1="${y(threshold).toFixed(2)}" y2="${y(threshold).toFixed(2)}" class="threshold"/><text x="${width - pad}" y="${(y(threshold) - 4).toFixed(2)}" text-anchor="end" class="threshold-label">threshold ${threshold}%</text>`
      : '';

  const labels = `<text x="${pad}" y="${height - 2}" class="axis">${escapeHtml(shortSha(history[0].sha))}</text><text x="${width - pad}" y="${height - 2}" text-anchor="end" class="axis">${escapeHtml(shortSha(history[history.length - 1].sha))}</text>`;

  return `<section><h2>Line coverage trend</h2><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="line coverage trend">${thresholdLine}<polyline points="${points}" fill="none" class="trend"/>${labels}</svg></section>`;
}

function treemap(report: CoverageReport): string {
  const files = filesOf(report);
  if (files.length === 0) return '';
  const dirs = new Map<string, { count: number; linesSum: number }>();
  for (const file of files) {
    const dir = topLevelDir(file.path);
    const entry = dirs.get(dir) ?? { count: 0, linesSum: 0 };
    entry.count += 1;
    entry.linesSum += metricOf(file.metrics, 'lines')?.head ?? 0;
    dirs.set(dir, entry);
  }
  const tiles = [...dirs.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([dir, { count, linesSum }]) => {
      const avg = linesSum / count;
      // tile area ~ file count via grid span
      const span = Math.max(1, Math.min(4, Math.round(Math.sqrt(count))));
      return `<div class="tile ${covClass(avg)}" style="grid-column:span ${span};grid-row:span ${span}" title="${escapeHtml(dir)}: ${count} files, ${fmtPct(avg)} lines"><span class="tile-dir">${escapeHtml(dir)}</span><span class="tile-pct">${fmtPct(avg)}</span><span class="tile-count">${count} file${count === 1 ? '' : 's'}</span></div>`;
    })
    .join('');
  return `<section><h2>Directories</h2><div class="treemap">${tiles}</div></section>`;
}

function fileTable(report: CoverageReport): string {
  const files = filesOf(report);
  if (files.length === 0) return '';
  const rows = files
    .map((file) => {
      const cells = METRIC_KEYS.map((key) => {
        const m = metricOf(file.metrics, key);
        return `<td data-sort="${m?.head ?? -1}" class="${covClass(m?.head ?? null)}">${fmtPct(m?.head ?? null)} <span class="${deltaClass(m?.delta ?? null)}">${fmtDelta(m?.delta ?? null)}</span></td>`;
      }).join('');
      const ranges = (file.uncoveredRanges ?? [])
        .map((r) => (r.start === r.end ? `${r.start}` : `${r.start}–${r.end}`))
        .join(', ');
      return `<tr data-path="${escapeHtml(file.path.toLowerCase())}"><td class="path">${escapeHtml(file.path)}<span class="chg chg-${file.change}">${file.change}</span></td>${cells}<td class="ranges">${escapeHtml(ranges || '—')}</td></tr>`;
    })
    .join('');
  const headers = METRIC_KEYS.map(
    (key, i) => `<th class="sortable" data-col="${i + 1}">${METRIC_LABELS[key]}</th>`
  ).join('');
  return `<section><h2>Files</h2><input id="search" type="search" placeholder="Filter by path…" aria-label="filter files"/><table id="files"><thead><tr><th class="sortable" data-col="0">File</th>${headers}<th>Uncovered lines</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function metaSection(report: CoverageReport): string {
  const bits: string[] = [`generated ${escapeHtml(report.generatedAt)}`];
  if (report.repo) bits.push(escapeHtml(`${report.repo.owner}/${report.repo.repo}`));
  if (report.pr) bits.push(`PR #${report.pr.number}`);
  if (report.baseline) {
    bits.push(
      `baseline ${escapeHtml(shortSha(report.baseline.sha))} via ${report.baseline.source}` +
        (report.baseline.staleness > 0 ? ` (${report.baseline.staleness} commits behind)` : '')
    );
  }
  return `<p class="meta">${bits.join(' · ')}</p>`;
}

const CSS = `
:root{color-scheme:light dark;--ok:#1a7f37;--warn:#9a6700;--fail:#cf222e;--bg:#fff;--fg:#1f2328;--muted:#656d76;--line:#d0d7de;--card:#f6f8fa}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#8b949e;--line:#30363d;--card:#161b22;--ok:#3fb950;--warn:#d29922;--fail:#f85149}}
body{font:14px/1.5 system-ui,sans-serif;margin:0 auto;max-width:980px;padding:24px;background:var(--bg);color:var(--fg)}
h1{font-size:20px}h2{font-size:16px;margin:24px 0 8px}
.badge{display:inline-block;padding:4px 10px;border-radius:6px;font-weight:600}
.badge.ok{color:var(--ok)}.badge.fail{color:var(--fail)}.badge.warn{color:var(--warn)}.badge.info{color:var(--muted)}
.meta{color:var(--muted)}
.cards{display:flex;gap:12px;flex-wrap:wrap}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 14px;min-width:120px}
.card-label{color:var(--muted);font-size:12px}.card-value{font-size:22px;font-weight:700}
.cov-good .card-value{color:var(--ok)}.cov-mid .card-value{color:var(--warn)}.cov-bad .card-value{color:var(--fail)}
.delta-up{color:var(--ok)}.delta-down{color:var(--fail)}.delta-flat{color:var(--muted)}
svg{width:100%;height:auto;background:var(--card);border:1px solid var(--line);border-radius:8px}
.trend{stroke:var(--ok);stroke-width:2}.threshold{stroke:var(--fail);stroke-dasharray:4 4;stroke-width:1}
.threshold-label,.axis{font-size:10px;fill:var(--muted)}
.treemap{display:grid;grid-template-columns:repeat(8,1fr);gap:6px;grid-auto-rows:56px}
.tile{border-radius:6px;padding:6px;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;border:1px solid var(--line)}
.tile.cov-good{background:color-mix(in srgb,var(--ok) 18%,var(--card))}.tile.cov-mid{background:color-mix(in srgb,var(--warn) 18%,var(--card))}.tile.cov-bad{background:color-mix(in srgb,var(--fail) 18%,var(--card))}
.tile-dir{font-weight:600;font-size:12px}.tile-pct{font-size:14px}.tile-count{color:var(--muted);font-size:11px}
#search{margin:8px 0;padding:6px 10px;width:280px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg)}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;font-size:13px}
th.sortable{cursor:pointer}th.sortable:after{content:' ↕';color:var(--muted)}
td.cov-good{color:var(--ok)}td.cov-mid{color:var(--warn)}td.cov-bad{color:var(--fail)}
.path{font-family:ui-monospace,monospace;font-size:12px}
.chg{margin-left:6px;font-size:10px;border:1px solid var(--line);border-radius:4px;padding:1px 4px;color:var(--muted)}
.chg-new{color:var(--ok)}.chg-modified{color:var(--warn)}
.ranges{font-family:ui-monospace,monospace;font-size:12px;color:var(--fail)}
`.trim();

const JS = `
(function(){
  var search=document.getElementById('search');
  var table=document.getElementById('files');
  if(search&&table){
    search.addEventListener('input',function(){
      var q=search.value.toLowerCase();
      table.tBodies[0].querySelectorAll('tr').forEach(function(tr){
        tr.style.display=tr.getAttribute('data-path').indexOf(q)>=0?'':'none';
      });
    });
    var dir=1;
    table.tHead.querySelectorAll('th.sortable').forEach(function(th){
      th.addEventListener('click',function(){
        var col=parseInt(th.getAttribute('data-col'),10);
        var rows=Array.prototype.slice.call(table.tBodies[0].rows);
        rows.sort(function(a,b){
          var ka=a.cells[col].getAttribute('data-sort')||a.cells[col].textContent;
          var kb=b.cells[col].getAttribute('data-sort')||b.cells[col].textContent;
          var na=parseFloat(ka),nb=parseFloat(kb);
          if(!isNaN(na)&&!isNaN(nb))return (na-nb)*dir;
          return ka<kb?-dir:ka>kb?dir:0;
        });
        dir=-dir;
        rows.forEach(function(r){table.tBodies[0].appendChild(r)});
      });
    });
  }
})();
`.trim();

export function renderHtml(report: CoverageReport): string {
  const badge = STATE_BADGES[report.state];
  const title = report.repo
    ? `Coverage — ${report.repo.owner}/${report.repo.repo}`
    : 'Coverage report';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<h1>${escapeHtml(title)} <span class="badge ${badge.cls}">${badge.label}</span></h1>
${metaSection(report)}
<div class="cards">${totalsCards(report)}</div>
${trendSvg(report)}
${treemap(report)}
${fileTable(report)}
<script type="application/json" id="report-data">${jsonForScript(report)}</script>
<script>${JS}</script>
</body>
</html>`;
}
