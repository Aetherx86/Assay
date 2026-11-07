import type { AuditorRow, DisclosureRow, ExecutiveRow, MajorHolderRow } from '../sources/dart.ts';
import { parseDartAmount } from '../sources/dart.ts';
import type { AuditReport, Evidence, Finding } from '../types.ts';

const SEVERE: [RegExp, string][] = [
  [/횡령|배임/, 'embezzlement or breach of duty'],
  [/불성실공시/, 'unfaithful disclosure designation'],
  [/관리종목|상장폐지|상장적격성/, 'delisting or administrative issue'],
  [/회생절차|파산|기업구조조정/, 'insolvency proceedings'],
  [/감사의견\s*(거절|부적정|한정)|비적정/, 'modified audit opinion'],
  [/감사범위\s*제한/, 'audit scope limitation'],
];
const DILUTIVE = /전환사채권발행결정|신주인수권부사채권발행결정|교환사채권발행결정|유상증자결정/;
const AMENDED = /\[(기재정정|첨부정정|첨부추가|변경등재|정정)\]|^\s*\(?정정\)?/;
const PERIODIC = /사업보고서|반기보고서|분기보고서|감사보고서/;

export function disclosureChecks(rows: DisclosureRow[], evidence: Evidence): Finding[] {
  // A listed company always files something, so an empty list means the search failed.
  if (rows.length === 0) {
    return [{ id: 'disclosure.all', layer: 'disclosure', title: 'Filing history', status: 'unavailable', detail: 'The search returned no filings, so this was not checked.', evidence: [evidence] }];
  }
  const out: Finding[] = [];
  const finding = (id: string, title: string, status: Finding['status'], detail: string, value?: number): void => {
    out.push({ id, layer: 'disclosure', title, status, detail, value, evidence: [evidence] });
  };

  // A company leaving a foreign exchange by choice, such as ending an ADR program, is routine.
  const hits = SEVERE.flatMap(([pattern, label]) => rows.filter((r) => pattern.test(r.report_nm) && !/해외증권시장/.test(r.report_nm)).map((r) => ({ label, row: r })));
  const severeDetail = hits.slice(0, 6).map((h) => `${h.row.rcept_dt} ${h.row.report_nm.trim()}`).join('; ');
  finding('disclosure.severe', 'Filings about severe events', hits.length ? 'flag' : 'pass', hits.length ? `${hits.length} filing(s) match: ${severeDetail}. A filing title alone does not establish wrongdoing, so read the filing.` : `None among ${rows.length} filings.`, hits.length);

  const periodic = rows.filter((r) => PERIODIC.test(r.report_nm));
  const amended = periodic.filter((r) => AMENDED.test(r.report_nm));
  const share = periodic.length ? amended.length / periodic.length : 0;
  finding('disclosure.amendments', 'Amended periodic reports', share > 0.4 ? 'flag' : share > 0.2 ? 'watch' : 'pass', `${amended.length} of ${periodic.length} periodic reports were amended.`, Number(share.toFixed(3)));

  const dilutive = rows.filter((r) => DILUTIVE.test(r.report_nm) && !AMENDED.test(r.report_nm));
  finding('disclosure.dilution', 'Convertible, warrant and rights issuance', dilutive.length >= 6 ? 'flag' : dilutive.length >= 3 ? 'watch' : 'pass', `${dilutive.length} issuance decision(s) in the period.`, dilutive.length);
  return out;
}

const OPINIONS: [RegExp, AuditReport['opinion']][] = [
  [/의견\s*거절/, 'disclaimer'],
  [/부적정/, 'adverse'],
  [/한정/, 'qualified'],
  [/적정/, 'unqualified'],
];

export function opinionFromDart(text: string | undefined): AuditReport['opinion'] {
  if (!text) return 'not-found';
  return OPINIONS.find(([pattern]) => pattern.test(text))?.[1] ?? 'not-found';
}

export function auditChecks(rows: AuditorRow[], fiscalYear: number, document: AuditReport | undefined, evidence: Evidence[]): Finding[] {
  const out: Finding[] = [];
  const finding = (id: string, title: string, status: Finding['status'], detail: string, value?: string | number): void => {
    out.push({ id, layer: 'audit', title, status, detail, value, evidence });
  };
  // Annual reports list the current term and earlier ones. Blank rows carry no opinion.
  const row = rows.find((r) => /당기/.test(r.bsns_year) && r.adt_opinion?.trim()) ?? rows.find((r) => r.bsns_year.includes(String(fiscalYear)) && r.adt_opinion?.trim()) ?? rows.find((r) => r.adt_opinion?.trim());
  const filed = opinionFromDart(row?.adt_opinion);
  const opinion = filed !== 'not-found' ? filed : document?.opinion ?? 'not-found';

  if (opinion === 'not-found') finding('audit.opinion', 'Auditor opinion', 'unavailable', 'No opinion found. Supply the audit report or an OpenDART key.');
  else finding('audit.opinion', 'Auditor opinion', opinion === 'unqualified' ? 'pass' : 'flag', `${opinion}${row?.adtor ? `, from ${row.adtor}` : ''}.`, opinion);

  if (filed !== 'not-found' && document && document.opinion !== 'not-found') {
    finding('audit.opinion-match', 'Filed opinion matches the audit report', filed === document.opinion ? 'pass' : 'flag', `OpenDART says ${filed}, the document says ${document.opinion}.`);
  }
  const goingConcern = document?.goingConcernUncertainty || /계속기업/.test(row?.emphs_matter ?? '');
  if (document || row) {
    finding('audit.going-concern', 'Going concern uncertainty', goingConcern ? 'flag' : 'pass', goingConcern ? 'The auditor reports a material uncertainty about going concern.' : 'None reported.');
  }
  if (document?.keyAuditMatters.length) {
    finding('audit.kam', 'Key audit matters', 'info', document.keyAuditMatters.join('; '), document.keyAuditMatters.length);
  }
  return out;
}

export function ownershipChecks(executives: ExecutiveRow[], holders: MajorHolderRow[], asOf: Date, evidence: Evidence): Finding[] {
  const out: Finding[] = [];
  const since = new Date(asOf);
  since.setFullYear(since.getFullYear() - 1);
  const cutoff = since.toISOString().slice(0, 10);
  const recent = executives.filter((r) => r.rcept_dt >= cutoff);
  const net = new Map<string, number>();
  for (const row of recent) net.set(row.repror, (net.get(row.repror) ?? 0) + (parseDartAmount(row.sp_stock_lmp_irds_cnt) ?? 0));
  const buyers = [...net.values()].filter((v) => v > 0).length;
  const sellers = [...net.values()].filter((v) => v < 0).length;
  const decided = buyers + sellers;
  const sellCluster = sellers >= 3 && sellers / decided >= 0.7;
  const buyCluster = buyers >= 3 && buyers / decided >= 0.7;
  out.push({
    id: 'ownership.insiders',
    layer: 'ownership',
    title: 'Insider buying and selling, last 12 months',
    status: sellCluster ? 'watch' : 'info',
    detail: `${buyers} net buyer(s) and ${sellers} net seller(s) across ${recent.length} filings.${sellCluster ? ' Selling is clustered.' : buyCluster ? ' Buying is clustered, though share-based pay can look like buying.' : ''}`,
    value: `${buyers}/${sellers}`,
    evidence: [evidence],
  });

  const recentHolders = holders.filter((r) => r.rcept_dt >= cutoff);
  const moves = recentHolders
    .map((r) => ({ who: r.repror, change: parseDartAmount(r.stkrt_irds) ?? 0 }))
    .filter((m) => m.change !== 0)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  out.push({
    id: 'ownership.large-holders',
    layer: 'ownership',
    title: '5% holder changes, last 12 months',
    status: moves.some((m) => m.change <= -5) ? 'watch' : 'info',
    detail: moves.length ? moves.slice(0, 4).map((m) => `${m.who} ${m.change > 0 ? '+' : ''}${m.change}pt`).join(', ') : 'No reported change in stake.',
    value: recentHolders.length,
    evidence: [evidence],
  });
  return out;
}
