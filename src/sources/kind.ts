import { createHash } from 'node:crypto';
import { htmlToLines } from '../statements/document.ts';
import type { Evidence } from '../types.ts';
import type { DisclosureRow } from './dart.ts';

const BASE = 'https://kind.krx.co.kr';
const USER_AGENT = 'Mozilla/5.0 (compatible; assay/0.1; +https://github.com/Aetherx86/Assay)';
/** One request at a time with a pause in between, because this is a public site and not an API. */
const PAUSE_MS = 1200;

let last = 0;

async function request(path: string, init?: RequestInit): Promise<string> {
  const wait = last + PAUSE_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  last = Date.now();
  const response = await fetch(`${BASE}${path}`, { ...init, headers: { 'User-Agent': USER_AGENT, ...init?.headers }, signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`KIND returned HTTP ${response.status} for ${path.split('?')[0]}.`);
  return response.text();
}

export interface FilingRow extends DisclosureRow {
  company: string;
}

export function parseFilingRows(html: string): FilingRow[] {
  const rows: FilingRow[] = [];
  for (const chunk of html.split(/<tr\b/i).slice(1)) {
    const viewer = chunk.match(/openDisclsViewer\('(\d{14})'/);
    if (!viewer) continue;
    const anchor = chunk.match(/<a[^>]*openDisclsViewer[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? '';
    const date = chunk.match(/(20\d\d)-(\d\d)-(\d\d)\s+\d\d:\d\d/);
    const company = chunk.match(/companysummary_open\([^)]*\)[^>]*title=['"]([^'"]+)['"]/)?.[1]?.trim() ?? '';
    rows.push({
      rcept_no: viewer[1]!,
      report_nm: anchor.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
      rcept_dt: date ? `${date[1]}${date[2]}${date[3]}` : '',
      flr_nm: company,
      company,
    });
  }
  return rows;
}

/** KIND accepts at most three years per query, so a longer range becomes one query per year. */
export function yearlyWindows(from: string, to: string): [string, string][] {
  const windows: [string, string][] = [];
  const last = Number(to.slice(0, 4));
  for (let year = Number(from.slice(0, 4)); year <= last; year++) {
    const start = year === Number(from.slice(0, 4)) ? from : `${year}-01-01`;
    const end = year === last ? to : `${year}-12-31`;
    windows.push([start, end]);
  }
  return windows;
}

/** A refused query comes back as a normal page with an alert, which must not read as "no filings". */
export function refusal(html: string): string | undefined {
  return html.match(/alert\("([^"]+)"\)/)?.[1];
}

export async function searchFilings(stockCode: string, from: string, to: string, title = '', maxPages = 10): Promise<FilingRow[]> {
  const rows: FilingRow[] = [];
  for (const [start, end] of yearlyWindows(from, to)) {
    for (let page = 1; page <= maxPages; page++) {
      const body = new URLSearchParams({
        method: 'searchDetailsSub', currentPageSize: '100', pageIndex: String(page), orderMode: '1', orderStat: 'D',
        forward: 'details_sub', fromDate: start, toDate: end, reportNm: title, reportNmTemp: title, repIsuSrtCd: `A${stockCode}`,
      });
      const html = await request('/disclosure/details.do', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      const refused = refusal(html);
      if (refused) throw new Error(`KIND refused the search: ${refused}`);
      const found = parseFilingRows(html);
      rows.push(...found);
      if (found.length < 100) break;
    }
  }
  return rows;
}

export interface FilingDocument {
  docNo: string;
  title: string;
}

export function parseDocumentList(html: string): FilingDocument[] {
  return [...html.matchAll(/<option value='(\d{14})(?:\|[A-Z])?'[^>]*>([^<]+)<\/option>/g)].map((m) => ({ docNo: m[1]!, title: m[2]!.trim() }));
}

export async function filingDocuments(acceptanceNo: string): Promise<FilingDocument[]> {
  return parseDocumentList(await request(`/common/disclsviewer.do?method=search&acptno=${acceptanceNo}&docno=&viewerhost=&viewerport=`));
}

export interface FetchedDocument {
  lines: string;
  evidence: Evidence;
}

export async function fetchDocument(document: FilingDocument): Promise<FetchedDocument> {
  const contents = await request(`/common/disclsviewer.do?method=searchContents&docNo=${document.docNo}`);
  const path = contents.match(/external\/[^'"]+?(?<!_toc)\.htm/)?.[0];
  if (!path) throw new Error(`KIND gave no document path for ${document.title}.`);
  const html = await request(`/${path}`);
  return {
    lines: htmlToLines(html),
    evidence: {
      source: `KIND filing: ${document.title}`,
      locator: `${BASE}/${path}`,
      retrievedAt: new Date().toISOString(),
      sha256: createHash('sha256').update(html).digest('hex'),
    },
  };
}

export interface AnnualFiling {
  acceptanceNo: string;
  title: string;
  company: string;
  main: FilingDocument;
  auditReport?: FilingDocument;
}

/** Finds the annual report for a fiscal year. If it was amended, the latest version wins. */
export async function findAnnualFiling(stockCode: string, fiscalYear: number): Promise<AnnualFiling> {
  const rows = await searchFilings(stockCode, `${fiscalYear + 1}-01-01`, `${fiscalYear + 1}-12-31`, '사업보고서', 2);
  const annual = rows.filter((r) => r.report_nm.includes('사업보고서') && (r.report_nm.includes(`(${fiscalYear}.`) || !/\(20\d\d\.\d\d\)/.test(r.report_nm)));
  // Companies listed abroad also file a copy of their foreign report under a similar title.
  const filing = annual.find((r) => !r.report_nm.includes('해외증권')) ?? annual[0];
  if (!filing) throw new Error(`KIND has no annual report for ${stockCode}, fiscal ${fiscalYear}.`);
  const documents = await filingDocuments(filing.rcept_no);
  const main = documents.find((d) => d.title.includes('사업보고서')) ?? documents[0];
  if (!main) throw new Error(`KIND listed no documents for filing ${filing.rcept_no}.`);
  const auditReport = documents.find((d) => /연결감사보고서/.test(d.title)) ?? documents.find((d) => /감사보고서/.test(d.title));
  return { acceptanceNo: filing.rcept_no, title: filing.report_nm, company: filing.company, main, auditReport };
}
