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

/** Compares this year's prior-period column with the prior year's own statement. */
export function restatementFinding(later: Statement, earlier: Statement): Finding {
  const tolerance = Math.max(later.unit, earlier.unit) * 1.5;
  const changed = LINES.filter((line) => {
    const x = later.prior[line];
    const y = earlier.current[line];
    return x !== undefined && y !== undefined && Math.abs(x - y) > tolerance;
  });
  return {
    id: 'reconciliation.restatement',
    layer: 'reconciliation',
    title: 'Prior-year figures unchanged in the next report',
    status: changed.length ? 'watch' : 'pass',
    detail: changed.length ? `Comparatives for ${later.fiscalYear - 1} differ from that year's report on: ${changed.join(', ')}. Reclassification and restatement both cause this.` : `Comparatives for ${later.fiscalYear - 1} match that year's report.`,
    value: changed.length,
    evidence: [later.evidence, earlier.evidence],
  };
}
