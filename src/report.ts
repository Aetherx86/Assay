import { createHash } from 'node:crypto';
import { summaryMarkdown, type Lang } from './summary.ts';
import type { Finding, Layer, Line, Report, Status } from './types.ts';

const LAYERS: [Layer, string][] = [
  ['integrity', 'Statement arithmetic'],
  ['earnings-quality', 'Earnings quality and solvency'],
  ['reconciliation', 'Reconciliation between sources'],
  ['audit', 'Audit and credit opinions'],
  ['disclosure', 'Filing history'],
  ['ownership', 'Insiders and large holders'],
  ['intangible', 'Intangible assets'],
  ['physical', 'Physical assets'],
  ['legal', 'Legal citations'],
  ['context', 'Regional context'],
];

const STATUS_LABEL: Record<Status, string> = { pass: 'Pass', info: 'Info', watch: 'Watch', flag: 'Flag', unavailable: 'Not run' };

const KEY_LINES: [Line, string][] = [
  ['totalAssets', 'Total assets'], ['totalLiabilities', 'Total liabilities'], ['totalEquity', 'Total equity'],
  ['revenue', 'Revenue'], ['operatingIncome', 'Operating income'], ['netIncome', 'Net income'],
  ['cfo', 'Operating cash flow'], ['ppe', 'Property, plant and equipment'], ['intangibles', 'Intangible assets'],
];

export interface Coverage {
  layersRun: number;
  layers: number;
  missing: string[];
  counts: Record<Status, number>;
}

export function coverage(report: Report): Coverage {
  const counts: Record<Status, number> = { pass: 0, info: 0, watch: 0, flag: 0, unavailable: 0 };
  for (const f of report.findings) counts[f.status]++;
  const missing = LAYERS.filter(([layer]) => !report.findings.some((f) => f.layer === layer && f.status !== 'unavailable')).map(([, label]) => label);
  return { layersRun: LAYERS.length - missing.length, layers: LAYERS.length, missing, counts };
}

const LIVE_LAYERS: Layer[] = ['intangible', 'physical', 'legal', 'context'];

/**
 * Identifies a result by what it concluded, to compare repeated runs. It covers layers derived from
 * filed documents. Live services can have quota limits or outages, which are not a logic change.
 */
export function fingerprint(report: Report): string {
  const canonical = report.findings
    .filter((f) => !LIVE_LAYERS.includes(f.layer))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((f) => [f.id, f.status, f.value ?? null]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function formatWon(value: number | undefined): string {
  if (value === undefined) return 'n/a';
  const trillions = value / 1e12;
  return Math.abs(trillions) >= 1 ? `${trillions.toFixed(2)} tn` : `${(value / 1e9).toFixed(1)} bn`;
}

function title(report: Report): string {
  const { name, stockCode, query, fiscalYear } = report.subject;
  return `${name ?? query}${stockCode ? ` (${stockCode})` : ''}, fiscal ${fiscalYear}`;
}

export function toMarkdown(report: Report, lang: Lang = 'ko'): string {
  const c = coverage(report);
  const lines: string[] = [`# Assay report: ${title(report)}`, '', summaryMarkdown(report, lang), lang === 'ko' ? '---\n\n아래는 전문가용 세부 점검 결과입니다.\n' : '---\n\nDetailed checks follow.\n'];
  lines.push(`Generated ${report.generatedAt} by Assay ${report.tool.version}.`, '');
  lines.push(`**Coverage:** ${c.layersRun} of ${c.layers} layers ran.${c.missing.length ? ` Not run: ${c.missing.join(', ')}.` : ''}`, '');
  lines.push(`**Results:** ${c.counts.flag} flag, ${c.counts.watch} watch, ${c.counts.pass} pass, ${c.counts.info} info, ${c.counts.unavailable} not run.`, '');
  if (report.statement) {
    const s = report.statement;
    lines.push(`## Key figures (KRW, ${s.basis})`, '', `| Line | ${s.fiscalYear} | ${s.fiscalYear - 1} |`, '| --- | ---: | ---: |');
    for (const [line, label] of KEY_LINES) lines.push(`| ${label} | ${formatWon(s.current[line])} | ${formatWon(s.prior[line])} |`);
    lines.push('', `Source: ${s.evidence.source}${s.evidence.locator ? `, ${s.evidence.locator}` : ''}.`, '');
  }
  for (const [layer, label] of LAYERS) {
    const findings = report.findings.filter((f) => f.layer === layer);
    if (!findings.length) continue;
    lines.push(`## ${label}`, '', '| Status | Check | Result |', '| --- | --- | --- |');
    for (const f of findings) lines.push(`| ${STATUS_LABEL[f.status]} | ${f.title.replace(/\|/g, '/')} | ${f.detail.replace(/\|/g, '/')} |`);
    lines.push('');
  }
  const sources = new Map<string, string>();
  for (const f of report.findings) for (const e of f.evidence) sources.set(`${e.source}|${e.locator ?? ''}`, `- ${e.source}${e.locator ? `: ${e.locator}` : ''}${e.sha256 ? ` (sha256 ${e.sha256.slice(0, 16)})` : ''}`);
  if (sources.size) lines.push('## Sources', '', ...sources.values(), '');
  return lines.join('\n');
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function toHtml(report: Report): string {
  const c = coverage(report);
  const row = (f: Finding): string => `<tr class="${f.status}"><td class="status">${STATUS_LABEL[f.status]}</td><td>${escape(f.title)}</td><td>${escape(f.detail)}</td></tr>`;
  const sections = LAYERS.map(([layer, label]) => {
    const findings = report.findings.filter((f) => f.layer === layer);
    return findings.length ? `<h2>${label}</h2><table><thead><tr><th>Status</th><th>Check</th><th>Result</th></tr></thead><tbody>${findings.map(row).join('')}</tbody></table>` : '';
  }).join('');
  const s = report.statement;
  const figures = s ? `<h2>Key figures (KRW, ${s.basis})</h2><table class="num"><thead><tr><th>Line</th><th>${s.fiscalYear}</th><th>${s.fiscalYear - 1}</th></tr></thead><tbody>${KEY_LINES.map(([l, label]) => `<tr><td>${label}</td><td>${formatWon(s.current[l])}</td><td>${formatWon(s.prior[l])}</td></tr>`).join('')}</tbody></table>` : '';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Assay report: ${escape(title(report))}</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
table{border-collapse:collapse;width:100%;margin:.5rem 0 1.5rem}th,td{border-bottom:1px solid #ddd;padding:.4rem .6rem;text-align:left;vertical-align:top}
.num td:not(:first-child),.num th:not(:first-child){text-align:right}.status{font-weight:600;white-space:nowrap}
.flag .status{color:#b42318}.watch .status{color:#b54708}.pass .status{color:#067647}.unavailable{color:#667085}
@media(prefers-color-scheme:dark){body{background:#111;color:#eee}th,td{border-color:#333}.flag .status{color:#f97066}.watch .status{color:#fdb022}.pass .status{color:#47cd89}.unavailable{color:#98a2b3}}
</style></head><body>
<h1>${escape(title(report))}</h1>
<p>Generated ${escape(report.generatedAt)} by Assay ${escape(report.tool.version)}.</p>
<p><strong>Coverage:</strong> ${c.layersRun} of ${c.layers} layers ran.${c.missing.length ? ` Not run: ${escape(c.missing.join(', '))}.` : ''} <strong>Results:</strong> ${c.counts.flag} flag, ${c.counts.watch} watch, ${c.counts.pass} pass, ${c.counts.info} info, ${c.counts.unavailable} not run.</p>
${figures}${sections}
</body></html>
`;
}

/** Writes the report as HWPX, the format Korean public institutions and many firms work in. */
export async function toHwpx(report: Report): Promise<Buffer> {
  const { markdownToHwpx } = await import('kordoc');
  return Buffer.from(await markdownToHwpx(toMarkdown(report)));
}
