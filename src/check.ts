import { VERSION } from './analyze.ts';
import { digitFinding } from './checks/digits.ts';
import { auditChecks } from './checks/filings.ts';
import { earningsQuality, integrityChecks } from './checks/financial.ts';
import { amountTokens, extractAudit, extractRatings, extractStatement, latestRatings } from './statements/document.ts';
import { parseDocument } from './statements/file.ts';
import type { Evidence, Finding, Report, Status } from './types.ts';

export interface CheckOptions {
  /** Read from the document when left out. */
  fiscalYear?: number;
  company?: string;
}

/**
 * Runs every check that needs nothing but the document itself: statement arithmetic, earnings
 * quality and solvency, the leading-digit test, and the audit opinion and ratings if the document
 * carries them. Nothing here touches the network, so the result depends only on the text.
 */
export function checkText(markdown: string, evidence: Evidence, options: CheckOptions = {}): Report {
  const statement = { ...extractStatement(markdown, { fiscalYear: options.fiscalYear }), company: options.company, evidence };
  const audit = extractAudit(markdown);
  const ratings = latestRatings(extractRatings(markdown));
  const findings: Finding[] = [
    ...integrityChecks(statement),
    ...earningsQuality(statement),
    digitFinding(amountTokens(markdown), evidence),
    // A document without an auditor's letter says nothing about going concern, so it is not passed in.
    ...auditChecks([], statement.fiscalYear, audit.opinion === 'not-found' ? undefined : audit, [evidence]),
  ];
  if (ratings.length) {
    const latest = ratings.map((r) => `${r.agency} ${r.grade}${r.date ? ` (${r.date})` : ''}`).join(', ');
    findings.push({ id: 'audit.ratings', layer: 'audit', title: 'Credit ratings stated in the filing', status: 'info', detail: latest, value: ratings[0]!.grade, evidence: [evidence] });
  }
  return {
    tool: { name: 'Assay', version: VERSION },
    subject: { query: evidence.locator ?? evidence.source, name: options.company, fiscalYear: statement.fiscalYear },
    generatedAt: new Date().toISOString(),
    statement,
    audit: audit.opinion === 'not-found' ? undefined : audit,
    ratings,
    findings,
  };
}

/** Reads a local PDF, HWP, HWPX, DOCX, XLSX, HTML or text file and checks it offline. */
export async function checkDocument(path: string, options: CheckOptions = {}): Promise<Report> {
  const document = await parseDocument(path);
  const evidence: Evidence = { source: 'Company document', locator: path, sha256: document.sha256, retrievedAt: new Date().toISOString() };
  return checkText(document.markdown, evidence, options);
}

const SEVERITY: Record<Status, number> = { unavailable: 0, pass: 0, info: 0, watch: 1, flag: 2 };

/** True when any finding is at least as severe as `threshold`, for use as a pipeline gate. */
export function exceeds(report: Report, threshold: 'watch' | 'flag'): boolean {
  return report.findings.some((f) => SEVERITY[f.status] >= SEVERITY[threshold]);
}
