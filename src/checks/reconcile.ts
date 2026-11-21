import type { Finding, Line, Statement } from '../types.ts';
import { LINES } from '../types.ts';

/** The lines a reader checks first. Publication gates are measured on these. */
export const CORE_LINES: Line[] = [
  'totalAssets', 'currentAssets', 'totalLiabilities', 'currentLiabilities', 'totalEquity', 'cash',
  'revenue', 'operatingIncome', 'netIncome', 'cfo', 'cfi', 'cff',
];

export interface LineComparison {
  line: Line;
  period: 'current' | 'prior';
  a?: number;
  b?: number;
  difference?: number;
  outcome: 'match' | 'mismatch' | 'missing';
}

export interface Reconciliation {
  comparisons: LineComparison[];
  coreCompared: number;
  coreMatched: number;
  mismatches: LineComparison[];
  missingCore: Line[];
}

export function reconcile(a: Statement, b: Statement): Reconciliation {
  const tolerance = Math.max(a.unit, b.unit) * 1.5;
  const comparisons: LineComparison[] = [];
  for (const period of ['current', 'prior'] as const) {
    for (const line of LINES) {
      // Depreciation is read from notes by position, so it is too loose to compare as a filed figure.
      if (line === 'depreciation') continue;
      const x = a[period][line];
      const y = b[period][line];
      if (x === undefined && y === undefined) continue;
      if (x === undefined || y === undefined) {
        comparisons.push({ line, period, a: x, b: y, outcome: 'missing' });
        continue;
      }
      // Capex sign conventions vary between filers, so only its size is compared.
      const difference = line === 'capex' ? Math.abs(x) - Math.abs(y) : x - y;
      comparisons.push({ line, period, a: x, b: y, difference, outcome: Math.abs(difference) <= tolerance ? 'match' : 'mismatch' });
    }
  }
  const core = comparisons.filter((c) => c.period === 'current' && CORE_LINES.includes(c.line));
  const compared = core.filter((c) => c.outcome !== 'missing');
  return {
    comparisons,
    coreCompared: compared.length,
    coreMatched: compared.filter((c) => c.outcome === 'match').length,
    mismatches: comparisons.filter((c) => c.outcome === 'mismatch'),
    missingCore: CORE_LINES.filter((line) => !compared.some((c) => c.line === line)),
  };
}

export function reconciliationFinding(a: Statement, b: Statement, r: Reconciliation): Finding {
  const list = r.mismatches.slice(0, 8).map((m) => `${m.line} (${m.period})`).join(', ');
  const status = r.mismatches.length ? 'flag' : r.coreCompared === 0 ? 'unavailable' : r.missingCore.length ? 'watch' : 'pass';
  const missingNote = r.missingCore.length ? ` Could not compare: ${r.missingCore.join(', ')}.` : '';
  return {
    id: 'reconciliation.sources',
    layer: 'reconciliation',
    title: 'Filed figures against the company document',
    status,
    detail: `${r.coreMatched} of ${r.coreCompared} core lines agree within rounding.${r.mismatches.length ? ` Differences in ${list}.` : ''}${missingNote}`,
    value: `${r.coreMatched}/${r.coreCompared}`,
    evidence: [a.evidence, b.evidence],
  };
}

/**
 * Lines whose change means the prior year was measured differently, rather than presented differently.
 * IAS 8 restatements (error corrections and retrospective policy changes) and combinations under
 * common control move these. A reclassification under IAS 1.41, or an IFRS 5 re-presentation of
 * discontinued operations, moves line items and subtotals while these stay put.
 */
export const MEASUREMENT_LINES: Line[] = ['totalAssets', 'totalLiabilities', 'totalEquity', 'retainedEarnings', 'netIncome'];

export interface RestatementChange {
  line: Line;
  /** The figure in the prior year's own report. */
  reported: number;
  /** The same figure as the comparative in the next year's report. */
  comparative: number;
  difference: number;
  /** Difference as a share of the originally reported figure. */
  relative: number;
  measurement: boolean;
}

export interface Restatement {
  compared: number;
  changes: RestatementChange[];
  kind: 'none' | 'presentation' | 'measurement' | 'not-compared';
  /** Largest absolute difference as a share of the originally reported total assets, when known. */
  shareOfAssets?: number;
}

/**
 * Compares this year's prior-period column with the prior year's own statement, line by line, within
 * rounding. Depreciation is skipped because it is read from the notes by position, as in `reconcile`.
 */
export function compareRestatement(later: Statement, earlier: Statement): Restatement {
  const tolerance = Math.max(later.unit, earlier.unit) * 1.5;
  let compared = 0;
  const changes: RestatementChange[] = [];
  for (const line of LINES) {
    if (line === 'depreciation') continue;
    const comparative = later.prior[line];
    const reported = earlier.current[line];
    if (comparative === undefined || reported === undefined) continue;
    compared++;
    const difference = comparative - reported;
    if (Math.abs(difference) <= tolerance) continue;
    changes.push({ line, reported, comparative, difference, relative: reported === 0 ? Infinity : difference / Math.abs(reported), measurement: MEASUREMENT_LINES.includes(line) });
  }
  const kind = compared === 0 ? 'not-compared' : changes.length === 0 ? 'none' : changes.some((c) => c.measurement) ? 'measurement' : 'presentation';
  const assets = earlier.current.totalAssets;
  const largest = Math.max(0, ...changes.map((c) => Math.abs(c.difference)));
  return { compared, changes, kind, ...(assets && changes.length ? { shareOfAssets: largest / Math.abs(assets) } : {}) };
}

/** A share as a percentage with enough digits to be non-zero, or undefined below 0.001%. */
function percent(share: number): string | undefined {
  const size = Math.abs(share * 100);
  if (size < 0.001) return undefined;
  return `${size >= 1 ? size.toFixed(1) : Number(size.toPrecision(2))}%`;
}

function describeChange(c: RestatementChange): string {
  const bn = `KRW ${(c.difference / 1e9).toFixed(1)} bn`;
  if (!Number.isFinite(c.relative)) return `${c.line} from zero (${bn})`;
  const pct = percent(c.relative);
  return pct ? `${c.line} ${c.relative > 0 ? '+' : '-'}${pct} (${bn})` : `${c.line} ${bn} (under 0.001%)`;
}

export function restatementFinding(later: Statement, earlier: Statement): Finding {
  const r = compareRestatement(later, earlier);
  const year = later.fiscalYear - 1;
  const base = { id: 'reconciliation.restatement', layer: 'reconciliation' as const, title: 'Prior-year figures unchanged in the next report', evidence: [later.evidence, earlier.evidence] };
  if (r.kind === 'not-compared') {
    return { ...base, status: 'unavailable', detail: `No line was available both in the ${year} report and as a comparative in the ${later.fiscalYear} report.` };
  }
  if (r.kind === 'none') {
    return { ...base, status: 'pass', detail: `Comparatives for ${year} match that year's report on all ${r.compared} lines compared.`, value: 0 };
  }
  const measured = r.changes.filter((c) => c.measurement);
  const presented = r.changes.filter((c) => !c.measurement);
  const scale = r.shareOfAssets === undefined ? '' : ` The largest change is ${percent(r.shareOfAssets) ?? 'under 0.001%'} of that year's total assets.`;
  const lines = (list: RestatementChange[]): string => list.slice(0, 8).map(describeChange).join(', ');
  if (r.kind === 'presentation') {
    return {
      ...base, status: 'info', value: r.changes.length,
      detail: `Comparatives for ${year} differ from that year's report on ${lines(presented)}, while total assets, liabilities, equity, retained earnings and net income agree where both reports give them. That pattern fits a reclassification or a re-presented discontinued operation.${scale}`,
    };
  }
  return {
    ...base, status: 'watch', value: r.changes.length,
    detail: `Comparatives for ${year} differ from that year's report on ${lines(measured)}${presented.length ? `, and on line items ${lines(presented)}` : ''}. A change in these totals usually means a restatement under IAS 8, a change of accounting policy or a combination under common control, which the notes explain.${scale}`,
  };
}
