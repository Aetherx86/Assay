import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { analyze } from './analyze.ts';
import { CORE_LINES } from './checks/reconcile.ts';
import { coverage, fingerprint } from './report.ts';
import { fetchSecPeriod } from './sources/sec.ts';
import { GRADES } from './statements/grades.ts';
import type { AuditReport, Finding, Line, Period, Report } from './types.ts';

export interface ManifestEntry {
  id: string;
  stockCode: string;
  name: string;
  fiscalYear: number;
  set: 'dev' | 'holdout' | 'holdout2' | 'control';
  /** `event` is the year a professional raised the alarm. `prior` is the year before that. */
  role?: 'event' | 'prior';
  financial?: boolean;
  expected?: { auditOpinion?: AuditReport['opinion']; source?: string };
  /** Figures an auditor or regulator stated in public, in KRW. Used for the report comparison. */
  statedFacts?: { line: string; value: number; source: string }[];
  secCik?: string;
  sites?: string[];
  external?: boolean;
}

export interface EntryResult {
  id: string;
  set: ManifestEntry['set'];
  role?: ManifestEntry['role'];
  name: string;
  fiscalYear: number;
  fingerprint?: string;
  error?: string;
  auditOpinion?: string;
  expectedOpinion?: string;
  goingConcern?: boolean;
  keyAuditMatters?: string[];
  grade?: string;
  altman?: number;
  statuses: Record<string, string>;
  coreMatched: number;
  coreCompared: number;
  mismatches: string[];
  dartMatched?: number;
  dartCompared?: number;
  secMatched?: number;
  secCompared?: number;
  secMismatches?: string[];
  stated?: { line: string; stated: number; assay?: number; agrees: boolean; source: string }[];
  layersRun: number;
  notRun: string[];
  notRunReasons: string[];
  financial: boolean;
}

export type GateStatus = 'pass' | 'fail' | 'not-run';

export interface Gate {
  id: string;
  title: string;
  status: GateStatus;
  measured: string;
  required: string;
}

const ALARMS = ['audit.opinion', 'audit.going-concern', 'solvency.equity', 'quality.altman', 'disclosure.severe'];
const EARLY_WARNINGS = ['quality.altman', 'solvency.equity', 'quality.cash-conversion', 'quality.piotroski', 'quality.beneish'];

const raised = (entry: EntryResult, ids: string[]): boolean => ids.some((id) => entry.statuses[id] === 'flag');

/** Average ranks, so tied values do not depend on input order. */
function ranks(values: number[]): number[] {
  const sorted = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length);
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1]![0] === sorted[i]![0]) j++;
    for (let k = i; k <= j; k++) out[sorted[k]![1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

export function spearman(x: number[], y: number[]): number {
  const a = ranks(x);
  const b = ranks(y);
  const mean = (v: number[]): number => v.reduce((s, n) => s + n, 0) / v.length;
  const ma = mean(a);
  const mb = mean(b);
  let top = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    top += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da && db ? top / Math.sqrt(da * db) : 0;
}

function gradeScore(grade: string | undefined): number | undefined {
  if (!grade) return undefined;
  const index = GRADES.indexOf(grade);
  return index < 0 ? undefined : GRADES.length - index;
}

/** The lowest current domestic grade, because that is the more cautious professional view. */
function lowestGrade(report: Report): string | undefined {
  return [...report.ratings].map((r) => r.grade).filter((g) => GRADES.includes(g)).sort((a, b) => GRADES.indexOf(b) - GRADES.indexOf(a))[0];
}

function fraction(value: Finding['value']): [number, number] {
  const m = String(value ?? '').match(/^(\d+)\/(\d+)$/);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

const SEC_LINES: Line[] = ['totalAssets', 'totalLiabilities', 'totalEquity', 'currentAssets', 'currentLiabilities', 'cash', 'revenue', 'netIncome', 'cfo', 'cfi', 'cff'];

function compareSec(sec: Period, report: Report): { matched: number; compared: number; mismatches: string[] } {
  const s = report.statement;
  let matched = 0;
  let compared = 0;
  const mismatches: string[] = [];
  if (!s) return { matched, compared, mismatches };
  for (const line of SEC_LINES) {
    const a = s.current[line];
    const b = sec[line];
    if (a === undefined || b === undefined) continue;
    compared++;
    // SEC filings report in millions of won, so one unit of rounding is allowed on either side.
    if (Math.abs(a - b) <= 1.5e6) matched++;
    else mismatches.push(`${line}: ${a} against SEC ${b}`);
  }
  return { matched, compared, mismatches };
}

function statedValue(report: Report, line: string): number | undefined {
  const c = report.statement?.current;
  if (!c) return undefined;
  if (line === 'currentDeficit') {
    return c.currentLiabilities !== undefined && c.currentAssets !== undefined ? c.currentLiabilities - c.currentAssets : undefined;
  }
  return c[line as Line];
}

async function runEntry(entry: ManifestEntry, dartKey: string | undefined, noExternal: boolean): Promise<EntryResult> {
  const blank: EntryResult = {
    id: entry.id, set: entry.set, role: entry.role, name: entry.name, fiscalYear: entry.fiscalYear,
    statuses: {}, coreMatched: 0, coreCompared: 0, mismatches: [], layersRun: 0, notRun: [], notRunReasons: [], financial: entry.financial ?? false,
    expectedOpinion: entry.expected?.auditOpinion,
  };
  let report: Report;
  try {
    report = await analyze({ query: entry.stockCode, fiscalYear: entry.fiscalYear, dartKey, sites: entry.sites, skipExternal: noExternal || !entry.external });
  } catch (error) {
    return { ...blank, error: (error as Error).message };
  }
  const statuses: Record<string, string> = {};
  for (const f of report.findings) statuses[f.id] = f.status;
  const opinion = report.findings.find((f) => f.id === 'audit.opinion');
  const altman = report.findings.find((f) => f.id === 'quality.altman');

  const auditCopy = report.findings.find((f) => f.id.startsWith('reconciliation.sources:KIND') && /감사보고서/.test(f.id));
  const [coreMatched, coreCompared] = fraction(auditCopy?.value);
  const dartCopy = dartKey ? report.findings.find((f) => f.id.startsWith('reconciliation.sources:KIND') && !/감사보고서/.test(f.id)) : undefined;
  const [dartMatched, dartCompared] = fraction(dartCopy?.value);

  const result: EntryResult = {
    ...blank,
    fingerprint: fingerprint(report),
    auditOpinion: report.audit?.opinion ?? (opinion?.value as string | undefined),
    goingConcern: report.audit?.goingConcernUncertainty,
    keyAuditMatters: report.audit?.keyAuditMatters,
    grade: lowestGrade(report),
    altman: typeof altman?.value === 'number' ? altman.value : undefined,
    statuses,
    coreMatched,
    coreCompared,
    mismatches: auditCopy?.status === 'flag' ? [auditCopy.detail] : [],
    layersRun: coverage(report).layersRun,
    notRun: coverage(report).missing,
    notRunReasons: report.findings.filter((f) => f.status === 'unavailable').map((f) => `${f.id}: ${f.detail}`),
    ...(dartKey ? { dartMatched, dartCompared } : {}),
  };

  if (entry.secCik) {
    try {
      const sec = compareSec(await fetchSecPeriod(entry.secCik, entry.fiscalYear), report);
      result.secMatched = sec.matched;
      result.secCompared = sec.compared;
      result.secMismatches = sec.mismatches;
    } catch (error) {
      result.secMismatches = [`SEC data unavailable: ${(error as Error).message}`];
    }
  }
  if (entry.statedFacts) {
    result.stated = entry.statedFacts.map((fact) => {
      const assay = statedValue(report, fact.line);
      // Public statements are rounded to a hundred million won, or 0.1% for large totals.
      const agrees = assay !== undefined && Math.abs(assay - fact.value) <= Math.max(1e8, Math.abs(fact.value) * 0.001);
      return { line: fact.line, stated: fact.value, assay, agrees, source: fact.source };
    });
  }
  return result;
}

function pct(a: number, b: number): string {
  return b ? `${((a / b) * 100).toFixed(1)}% (${a}/${b})` : 'nothing compared';
}

/** The gates, fixed in validation/PROTOCOL.md before any validation result existed. */
export function evaluateGates(entries: EntryResult[], priorRounds: EntryResult[][], options: { dartKey: boolean; reviews: number }): Gate[] {
  const ok = entries.filter((e) => !e.error);
  const gates: Gate[] = [];
  const add = (id: string, title: string, status: GateStatus, measured: string, required: string): void => {
    gates.push({ id, title, status, measured, required });
  };

  const crashed = entries.filter((e) => e.error);
  add('G0', 'Every company ran', crashed.length ? 'fail' : 'pass', crashed.length ? `Failed: ${crashed.map((e) => e.id).join(', ')}` : `${entries.length} of ${entries.length}`, 'No company fails to run');

  const compared = ok.filter((e) => !e.financial);
  const matched = compared.reduce((s, e) => s + e.coreMatched, 0);
  const total = compared.reduce((s, e) => s + e.coreCompared, 0);
  const thin = compared.filter((e) => e.coreCompared < 10);
  add('G1', 'Primary figures agree with the audit report copy', total === 0 ? 'not-run' : matched / total >= 0.98 && thin.length === 0 ? 'pass' : 'fail', `${pct(matched, total)}${thin.length ? `; under 10 lines: ${thin.map((e) => e.id).join(', ')}` : ''}`, 'At least 98%, with 10 of 12 core lines compared per company');

  const integrity = compared.flatMap((e) => Object.entries(e.statuses).filter(([id, s]) => id.startsWith('integrity.') && s === 'flag').map(([id]) => `${e.id}:${id}`));
  add('G2', 'Statement arithmetic holds', ok.length === 0 ? 'not-run' : integrity.length ? 'fail' : 'pass', integrity.length ? integrity.join(', ') : 'No failures', 'No identity fails on a non-financial company');

  const labelled = ok.filter((e) => e.expectedOpinion);
  const wrong = labelled.filter((e) => e.auditOpinion !== e.expectedOpinion);
  add('G3', 'Audit opinion read correctly', labelled.length === 0 ? 'not-run' : wrong.length ? 'fail' : 'pass', `${labelled.length - wrong.length} of ${labelled.length}${wrong.length ? `; wrong: ${wrong.map((e) => `${e.id} read ${e.auditOpinion}, expected ${e.expectedOpinion}`).join('; ')}` : ''}`, 'All labelled opinions match');

  const rated = ok.filter((e) => !e.financial && e.altman !== undefined && gradeScore(e.grade) !== undefined && e.role !== 'prior');
  const rho = spearman(rated.map((e) => e.altman!), rated.map((e) => gradeScore(e.grade)!));
  const strongInDistress = rated.filter((e) => e.altman! < 1.1 && GRADES.indexOf(e.grade!) <= GRADES.indexOf('AA-'));
  add('G4', "Altman Z'' ranks companies like credit agencies do", rated.length < 10 ? 'not-run' : rho >= 0.5 && strongInDistress.length === 0 ? 'pass' : 'fail', `Spearman ${rho.toFixed(2)} on ${rated.length} companies${strongInDistress.length ? `; AA- or better in distress: ${strongInDistress.map((e) => e.id).join(', ')}` : ''}`, 'Spearman at least 0.5 on at least 10 rated companies, no AA- or better in distress');

  const events = ok.filter((e) => e.set === 'control' && e.role === 'event');
  const caught = events.filter((e) => raised(e, ALARMS));
  add('G5a', 'Known problem years raise an alarm', events.length < 3 ? 'not-run' : caught.length / events.length >= 0.8 ? 'pass' : 'fail', pct(caught.length, events.length), 'At least 80% on at least 3 control companies');

  const healthy = ok.filter((e) => e.set !== 'control' && e.auditOpinion === 'unqualified' && e.grade && GRADES.indexOf(e.grade) <= GRADES.indexOf('A-'));
  const falseAlarms = healthy.filter((e) => raised(e, ALARMS));
  add('G5b', 'Healthy rated companies stay quiet', healthy.length < 5 ? 'not-run' : falseAlarms.length / healthy.length <= 0.2 ? 'pass' : 'fail', `${pct(falseAlarms.length, healthy.length)}${falseAlarms.length ? `: ${falseAlarms.map((e) => e.id).join(', ')}` : ''}`, 'At most 20% on at least 5 companies rated A- or better');

  const prior = ok.filter((e) => e.set === 'control' && e.role === 'prior');
  const warned = prior.filter((e) => raised(e, EARLY_WARNINGS));
  add('G5c', 'Financial signals warn a year early', prior.length < 3 ? 'not-run' : warned.length / prior.length >= 0.6 ? 'pass' : 'fail', pct(warned.length, prior.length), 'At least 60% on at least 3 control companies');

  if (priorRounds.length < 2) {
    add('G6', 'Repeated runs agree', 'not-run', `${priorRounds.length + 1} round(s) so far`, 'Three rounds with identical conclusions');
  } else {
    const drift: string[] = [];
    for (const entry of ok) {
      for (const round of priorRounds) {
        const earlier = round.find((e) => e.id === entry.id);
        if (earlier?.fingerprint && earlier.fingerprint !== entry.fingerprint) drift.push(entry.id);
      }
    }
    add('G6', 'Repeated runs agree', drift.length ? 'fail' : 'pass', drift.length ? `Changed: ${[...new Set(drift)].join(', ')}` : `${priorRounds.length + 1} rounds identical`, 'Three rounds with identical conclusions');
  }

  const sec = ok.filter((e) => e.secCompared);
  const secMatched = sec.reduce((s, e) => s + (e.secMatched ?? 0), 0);
  const secTotal = sec.reduce((s, e) => s + (e.secCompared ?? 0), 0);
  add('G7', 'Figures agree with SEC filings', sec.length < 3 ? 'not-run' : secMatched / secTotal >= 0.98 ? 'pass' : 'fail', `${pct(secMatched, secTotal)} over ${sec.length} companies`, 'At least 98% over at least 3 dual-listed companies');

  const dart = ok.filter((e) => e.dartCompared);
  const dartMatched = dart.reduce((s, e) => s + (e.dartMatched ?? 0), 0);
  const dartTotal = dart.reduce((s, e) => s + (e.dartCompared ?? 0), 0);
  add('G8', 'Figures agree with OpenDART XBRL', !options.dartKey || dart.length < 5 ? 'not-run' : dartMatched / dartTotal >= 0.98 ? 'pass' : 'fail', options.dartKey ? `${pct(dartMatched, dartTotal)} over ${dart.length} companies` : 'No OpenDART key was available', 'At least 98% over at least 5 companies');

  const layerRan = (prefix: string): string[] => ok.filter((e) => Object.entries(e.statuses).some(([id, s]) => id.startsWith(prefix) && s !== 'unavailable')).map((e) => e.id);
  const layers = { 'intangible.': layerRan('intangible.'), 'physical.': layerRan('physical.'), 'legal.': layerRan('legal.'), 'context.': layerRan('context.') };
  const shortfall = Object.entries(layers).filter(([, ran]) => ran.length < 3).map(([layer, ran]) => `${layer.replace('.', '')} on ${ran.length}`);
  add('G9', 'Every external layer returned real data', shortfall.length ? 'not-run' : 'pass', shortfall.length ? `Short: ${shortfall.join(', ')}` : 'All four on at least 3 companies', 'Each of the four layers on at least 3 companies');

  const stated = ok.flatMap((e) => e.stated ?? []);
  const agreeing = stated.filter((s) => s.agrees);
  const enough = stated.length >= 6 && options.reviews >= 3;
  add('G10', 'Reports match what professionals stated', !enough ? 'not-run' : agreeing.length / stated.length >= 0.9 ? 'pass' : 'fail', `${pct(agreeing.length, stated.length)} of stated figures, ${options.reviews} written review(s)`, 'At least 90% of 6 stated figures, plus 3 written reviews');
  return gates;
}

export function verdict(gates: Gate[]): 'PASS' | 'FAIL' | 'INCOMPLETE' {
  if (gates.some((g) => g.status === 'fail')) return 'FAIL';
  return gates.some((g) => g.status === 'not-run') ? 'INCOMPLETE' : 'PASS';
}

function resultsMarkdown(round: number, set: string, entries: EntryResult[], gates: Gate[]): string {
  const lines = [`# Validation round ${round} (${set})`, '', `Run ${new Date().toISOString()}. Verdict: **${verdict(gates)}**.`, '', '## Gates', '', '| Gate | Check | Status | Measured | Required |', '| --- | --- | --- | --- | --- |'];
  for (const g of gates) lines.push(`| ${g.id} | ${g.title} | ${g.status} | ${g.measured.replace(/\|/g, '/')} | ${g.required} |`);
  lines.push('', '## Companies', '', '| Company | FY | Set | Audit opinion | Lowest grade | Z\'\' | Core lines | Flags |', '| --- | --- | --- | --- | --- | ---: | ---: | --- |');
  for (const e of entries) {
    const flags = Object.entries(e.statuses).filter(([, s]) => s === 'flag').map(([id]) => id).join(', ');
    lines.push(`| ${e.name} | ${e.fiscalYear} | ${e.set}${e.role ? `/${e.role}` : ''} | ${e.error ? `error: ${e.error.replace(/\|/g, '/')}` : e.auditOpinion ?? 'n/a'} | ${e.grade ?? 'n/a'} | ${e.altman ?? 'n/a'} | ${e.coreMatched}/${e.coreCompared} | ${flags || 'none'} |`);
  }
  const stated = entries.filter((e) => e.stated?.length);
  if (stated.length) {
    lines.push('', '## Figures professionals stated in public', '', '| Company | Line | Stated (KRW bn) | Assay (KRW bn) | Agrees | Source |', '| --- | --- | ---: | ---: | --- | --- |');
    for (const e of stated) for (const s of e.stated!) lines.push(`| ${e.name} | ${s.line} | ${(s.stated / 1e9).toFixed(1)} | ${s.assay === undefined ? 'n/a' : (s.assay / 1e9).toFixed(1)} | ${s.agrees ? 'yes' : 'NO'} | ${s.source} |`);
  }
  return `${lines.join('\n')}\n`;
}

export async function runRound(options: { manifest: string; round: number; set: string; out: string; dartKey?: string; noExternal?: boolean }): Promise<number> {
  const manifest = JSON.parse(readFileSync(options.manifest, 'utf8')) as { companies: ManifestEntry[] };
  const sets = options.set.split(',');
  const selected = manifest.companies.filter((c) => options.set === 'all' || sets.includes(c.set));
  await mkdir(options.out, { recursive: true });
  const entries: EntryResult[] = [];
  for (const entry of selected) {
    console.error(`[${entries.length + 1}/${selected.length}] ${entry.id}`);
    entries.push(await runEntry(entry, options.dartKey, options.noExternal ?? false));
  }
  const stem = `${sets.join('+')}-round`;
  const previous = existsSync(options.out)
    ? readdirSync(options.out).filter((f) => f.startsWith(stem) && f.endsWith('.json') && f !== `${stem}-${options.round}.json`).sort().map((f) => (JSON.parse(readFileSync(join(options.out, f), 'utf8')) as { entries: EntryResult[] }).entries)
    : [];
  const reviewsDir = join(options.out, '..', 'reviews');
  const reviews = existsSync(reviewsDir) ? readdirSync(reviewsDir).filter((f) => f.endsWith('.md')).length : 0;
  const gates = evaluateGates(entries, previous, { dartKey: Boolean(options.dartKey), reviews });
  await writeFile(join(options.out, `${stem}-${options.round}.json`), `${JSON.stringify({ round: options.round, set: options.set, verdict: verdict(gates), gates, entries, coreLines: CORE_LINES }, null, 2)}\n`);
  await writeFile(join(options.out, `${stem}-${options.round}.md`), resultsMarkdown(options.round, options.set, entries, gates));
  console.log(`Round ${options.round} (${options.set}): ${verdict(gates)}`);
  for (const g of gates) console.log(`  ${g.id.padEnd(4)} ${g.status.padEnd(8)} ${g.title}: ${g.measured}`);
  return verdict(gates) === 'PASS' ? 0 : 1;
}
