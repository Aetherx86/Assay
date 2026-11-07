import { auditChecks, disclosureChecks, ownershipChecks } from './checks/filings.ts';
import { contextCheck, legalCheck, patentChecks, propertyCheck, regionFromAddress } from './checks/external.ts';
import { earningsQuality, integrityChecks } from './checks/financial.ts';
import { reconcile, reconciliationFinding, restatementFinding } from './checks/reconcile.ts';
import { DartClient, type AuditorRow } from './sources/dart.ts';
import { fetchDocument, findAnnualFiling, searchFilings } from './sources/kind.ts';
import { extractAudit, extractRatings, extractStatement, latestRatings } from './statements/document.ts';
import { statementFromDocument } from './statements/file.ts';
import type { AuditReport, CreditRating, Evidence, Finding, Layer, Report, Statement } from './types.ts';

export const VERSION = '0.1.0';

export interface AnalyzeOptions {
  /** Stock code, or a registered company name when a DART key is set. */
  query: string;
  fiscalYear: number;
  dartKey?: string;
  /** A company-published statement to reconcile against, such as a PDF from its IR site. */
  documentPath?: string;
  /** Addresses of sites to look up in the building register. */
  sites?: string[];
  /** Skip every source that needs the network. Used by tests and offline runs. */
  offline?: boolean;
  /** Skip the patent, register, law and statistics services. */
  skipExternal?: boolean;
}

function skipped(id: string, layer: Layer, title: string, detail: string): Finding {
  return { id, layer, title, status: 'unavailable', detail, evidence: [] };
}

function failure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function analyze(options: AnalyzeOptions): Promise<Report> {
  const { query, fiscalYear } = options;
  const findings: Finding[] = [];
  const dart = options.dartKey ? new DartClient(options.dartKey) : undefined;
  const stockFromQuery = /^\d{6}$/.test(query) ? query : undefined;
  let name: string | undefined;
  let stockCode = stockFromQuery;
  let address: string | undefined;
  let corpCode: string | undefined;

  const sources: Statement[] = [];
  let auditorRows: AuditorRow[] = [];
  let earlier: Statement | undefined;

  if (dart) {
    try {
      const corp = await dart.corp(query);
      corpCode = corp.corpCode;
      name = corp.name;
      stockCode = corp.stockCode || stockCode;
      address = (await dart.company(corp.corpCode)).adres;
      const statement = await dart.statement(corp, fiscalYear);
      const [now, before] = await Promise.all([dart.sharesIssued(corp.corpCode, fiscalYear), dart.sharesIssued(corp.corpCode, fiscalYear - 1)]);
      statement.shares = { current: now, prior: before };
      sources.push(statement);
      auditorRows = await dart.auditors(corp.corpCode, fiscalYear);
      earlier = await dart.statement(corp, fiscalYear - 1).catch(() => undefined);
    } catch (error) {
      findings.push(skipped('source.dart', 'reconciliation', 'OpenDART filing data', failure(error)));
    }
  }

  let audit: AuditReport | undefined;
  let ratings: CreditRating[] = [];
  let filingText = '';
  let filingEvidence: Evidence | undefined;
  const auditEvidence: Evidence[] = [];

  if (stockCode && !options.offline) {
    try {
      const filing = await findAnnualFiling(stockCode, fiscalYear);
      name ??= filing.company || undefined;
      const main = await fetchDocument(filing.main);
      filingText = main.lines;
      filingEvidence = main.evidence;
      sources.push({ ...extractStatement(main.lines, { fiscalYear }), company: name, evidence: main.evidence });
      ratings = latestRatings(extractRatings(main.lines));
      if (filing.auditReport) {
        const report = await fetchDocument(filing.auditReport);
        audit = extractAudit(report.lines);
        auditEvidence.push(report.evidence);
        // The auditor's attachment repeats the statements, which gives a second copy to compare.
        try {
          sources.push({ ...extractStatement(report.lines, { fiscalYear }), company: name, evidence: report.evidence });
        } catch (error) {
          findings.push(skipped('source.audit-statements', 'reconciliation', 'Statements in the audit report', failure(error)));
        }
      }
      if (!earlier) {
        const before = await findAnnualFiling(stockCode, fiscalYear - 1);
        const prior = await fetchDocument(before.main);
        earlier = { ...extractStatement(prior.lines, { fiscalYear: fiscalYear - 1 }), evidence: prior.evidence };
      }
    } catch (error) {
      findings.push(skipped('source.kind', 'reconciliation', 'Annual report from KIND', failure(error)));
    }
  } else if (!stockCode && !dart) {
    throw new Error('Give a six digit stock code, or set DART_API_KEY to search by company name.');
  }

  if (options.documentPath) {
    const parsed = await statementFromDocument(options.documentPath, { fiscalYear, company: name });
    sources.push(parsed.statement);
    if (!audit && parsed.audit.opinion !== 'not-found') {
      audit = parsed.audit;
      auditEvidence.push(parsed.statement.evidence);
    }
    if (!ratings.length) ratings = latestRatings(parsed.ratings);
  }

  const statement = sources[0];
  if (statement) {
    findings.push(...integrityChecks(statement), ...earningsQuality(statement));
    for (const other of sources.slice(1)) {
      const result = reconciliationFinding(statement, other, reconcile(statement, other));
      findings.push({ ...result, id: `reconciliation.sources:${other.evidence.source}`, title: `Against ${other.evidence.source}` });
    }
    if (sources.length < 2) findings.push(skipped('reconciliation.sources', 'reconciliation', 'Second source for the figures', 'Only one source of statements was available.'));
    if (earlier) findings.push(restatementFinding(statement, earlier));
  } else {
    findings.push(skipped('integrity.all', 'integrity', 'Statement arithmetic', 'No statements could be read.'));
    findings.push(skipped('quality.all', 'earnings-quality', 'Earnings quality', 'No statements could be read.'));
  }

  findings.push(...auditChecks(auditorRows, fiscalYear, audit, auditEvidence));
  if (ratings.length) {
    const latest = ratings.map((r) => `${r.agency} ${r.grade}${r.date ? ` (${r.date})` : ''}`).join(', ');
    findings.push({ id: 'audit.ratings', layer: 'audit', title: 'Credit ratings stated in the filing', status: 'info', detail: latest, value: ratings[0]!.grade, evidence: filingEvidence ? [filingEvidence] : [] });
  }

  const to = `${fiscalYear + 1}1231`;
  const from = `${fiscalYear - 2}0101`;
  if (dart && corpCode) {
    const evidence: Evidence = { source: 'OpenDART', locator: `corp_code=${corpCode}`, retrievedAt: new Date().toISOString() };
    try {
      findings.push(...disclosureChecks(await dart.disclosures(corpCode, from, to), evidence));
      findings.push(...ownershipChecks(await dart.executiveHoldings(corpCode), await dart.majorHoldings(corpCode), new Date(fiscalYear + 1, 11, 31), evidence));
    } catch (error) {
      findings.push(skipped('disclosure.all', 'disclosure', 'Filing history', failure(error)));
    }
  } else {
    if (stockCode && !options.offline) {
      try {
        const rows = await searchFilings(stockCode, `${fiscalYear - 2}-01-01`, `${fiscalYear + 1}-12-31`);
        findings.push(...disclosureChecks(rows, { source: 'KIND filing search', locator: `repIsuSrtCd=A${stockCode}`, retrievedAt: new Date().toISOString() }));
      } catch (error) {
        findings.push(skipped('disclosure.all', 'disclosure', 'Filing history', failure(error)));
      }
    } else {
      findings.push(skipped('disclosure.all', 'disclosure', 'Filing history', 'Needs network access.'));
    }
    findings.push(skipped('ownership.all', 'ownership', 'Insider and 5% holder changes', 'Needs an OpenDART key. Set DART_API_KEY.'));
  }

  if (options.offline || options.skipExternal) {
    for (const [id, layer, title] of [['intangible.patents', 'intangible', 'Registered IP'], ['physical.sites', 'physical', 'Building register'], ['legal.citations', 'legal', 'Statute citations'], ['context.region', 'context', 'Regional statistics']] as const) {
      findings.push(skipped(id, layer, title, 'External services were turned off for this run.'));
    }
  } else {
    if (name) findings.push(...await patentChecks(name, statement));
    else findings.push(skipped('intangible.patents', 'intangible', 'Registered IP', 'The company name is not known.'));

    if (options.sites?.length) {
      for (const site of options.sites) findings.push(await propertyCheck(site, name));
    } else {
      findings.push(skipped('physical.sites', 'physical', 'Building register', 'Name a site with --site, as district, neighbourhood and lot number. Filings rarely give lot numbers.'));
    }

    if (filingText && filingEvidence) findings.push(await legalCheck(filingText.slice(0, 600_000), filingEvidence));
    else findings.push(skipped('legal.citations', 'legal', 'Statute citations', 'No filing text to read.'));

    const region = options.sites?.[0] ? regionFromAddress(options.sites[0]) : address ? regionFromAddress(address) : undefined;
    if (region) findings.push(await contextCheck(region));
    else findings.push(skipped('context.region', 'context', 'Regional statistics', 'No address or site is known for this company.'));
  }

  return {
    tool: { name: 'Assay', version: VERSION },
    subject: { query, name, stockCode, fiscalYear, address },
    generatedAt: new Date().toISOString(),
    statement,
    audit,
    ratings,
    findings,
  };
}
