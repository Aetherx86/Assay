import { inflateRawSync } from 'node:zlib';
import { CASH_RECLASSIFIED, HELD_FOR_SALE, matchLine } from '../statements/document.ts';
import type { Evidence, Line, Period, Statement } from '../types.ts';
import { LINES } from '../types.ts';

const BASE = 'https://opendart.fss.or.kr/api';

export interface DartRow {
  sj_div: string;
  account_id?: string;
  account_nm: string;
  thstrm_amount?: string;
  frmtrm_amount?: string;
}

export interface Corp {
  corpCode: string;
  name: string;
  stockCode: string;
}

/** A request that DART itself refused. The message never contains the API key. */
export class DartError extends Error {
  readonly status: string;
  constructor(status: string, message: string) {
    super(`OpenDART ${status}: ${message}`);
    this.status = status;
  }
}

const TAGS: Record<Line, { sheets: string[]; tags: string[] }> = {
  totalAssets: { sheets: ['BS'], tags: ['ifrs-full_Assets'] },
  currentAssets: { sheets: ['BS'], tags: ['ifrs-full_CurrentAssets'] },
  nonCurrentAssets: { sheets: ['BS'], tags: ['ifrs-full_NoncurrentAssets'] },
  assetsHeldForSale: { sheets: [], tags: [] },
  cash: { sheets: ['BS'], tags: ['ifrs-full_CashAndCashEquivalents'] },
  tradeReceivables: { sheets: ['BS'], tags: ['dart_ShortTermTradeReceivable', 'ifrs-full_CurrentTradeReceivables', 'ifrs-full_TradeAndOtherCurrentReceivables'] },
  inventories: { sheets: ['BS'], tags: ['ifrs-full_Inventories'] },
  ppe: { sheets: ['BS'], tags: ['ifrs-full_PropertyPlantAndEquipment'] },
  intangibles: { sheets: ['BS'], tags: ['ifrs-full_IntangibleAssetsOtherThanGoodwill', 'ifrs-full_IntangibleAssetsAndGoodwill'] },
  totalLiabilities: { sheets: ['BS'], tags: ['ifrs-full_Liabilities'] },
  currentLiabilities: { sheets: ['BS'], tags: ['ifrs-full_CurrentLiabilities'] },
  nonCurrentLiabilities: { sheets: ['BS'], tags: ['ifrs-full_NoncurrentLiabilities'] },
  liabilitiesHeldForSale: { sheets: [], tags: [] },
  totalEquity: { sheets: ['BS'], tags: ['ifrs-full_Equity'] },
  retainedEarnings: { sheets: ['BS'], tags: ['ifrs-full_RetainedEarnings'] },
  revenue: { sheets: ['IS', 'CIS'], tags: ['ifrs-full_Revenue'] },
  costOfSales: { sheets: ['IS', 'CIS'], tags: ['ifrs-full_CostOfSales'] },
  grossProfit: { sheets: ['IS', 'CIS'], tags: ['ifrs-full_GrossProfit'] },
  sga: { sheets: ['IS', 'CIS'], tags: ['dart_TotalSellingGeneralAdministrativeExpenses'] },
  operatingIncome: { sheets: ['IS', 'CIS'], tags: ['dart_OperatingIncomeLoss', 'ifrs-full_ProfitLossFromOperatingActivities'] },
  netIncome: { sheets: ['IS', 'CIS'], tags: ['ifrs-full_ProfitLoss'] },
  cfo: { sheets: ['CF'], tags: ['ifrs-full_CashFlowsFromUsedInOperatingActivities'] },
  cfi: { sheets: ['CF'], tags: ['ifrs-full_CashFlowsFromUsedInInvestingActivities'] },
  cff: { sheets: ['CF'], tags: ['ifrs-full_CashFlowsFromUsedInFinancingActivities'] },
  capex: { sheets: ['CF'], tags: ['ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'] },
  fxEffect: { sheets: ['CF'], tags: ['ifrs-full_EffectOfExchangeRateChangesOnCashAndCashEquivalents'] },
  cashOther: { sheets: ['CF'], tags: [] },
  depreciation: { sheets: ['CF'], tags: ['ifrs-full_AdjustmentsForDepreciationExpense'] },
};

function amount(text: string | undefined): number | undefined {
  if (text === undefined || text.trim() === '' || text.trim() === '-') return undefined;
  const value = Number(text.replace(/,/g, ''));
  return Number.isFinite(value) ? value : undefined;
}

export function inferUnit(rows: DartRow[]): number {
  // Income statements include per-share figures in whole won, which say nothing about the rounding.
  const balances = rows.filter((r) => r.sj_div === 'BS');
  const values = (balances.length ? balances : rows).flatMap((r) => [amount(r.thstrm_amount), amount(r.frmtrm_amount)]).filter((v): v is number => v !== undefined && v !== 0);
  if (values.length && values.every((v) => v % 1_000_000 === 0)) return 1_000_000;
  if (values.length && values.every((v) => v % 1_000 === 0)) return 1_000;
  return 1;
}

export function statementFromDartRows(rows: DartRow[], meta: { fiscalYear: number; basis: Statement['basis']; company?: string; evidence: Evidence }): Statement {
  const current: Period = {};
  const prior: Period = {};
  for (const line of LINES) {
    const { sheets, tags } = TAGS[line];
    const pool = rows.filter((r) => sheets.includes(r.sj_div));
    let row: DartRow | undefined;
    for (const tag of tags) {
      row = pool.find((r) => r.account_id === tag);
      if (row) break;
    }
    // Filers can use their own tags, so fall back to the Korean account name.
    row ??= pool.find((r) => matchLine(r.account_nm, line));
    if (!row) continue;
    const a = amount(row.thstrm_amount);
    const b = amount(row.frmtrm_amount);
    if (a !== undefined) current[line] = a;
    if (b !== undefined) prior[line] = b;
  }
  for (const period of [current, prior]) {
    for (const line of ['capex', 'depreciation', 'costOfSales', 'sga'] as const) {
      if (period[line] !== undefined) period[line] = Math.abs(period[line]!);
    }
  }
  // Held-for-sale lines are found by name. Rows are not in statement order, and equity has similar names.
  const balance = rows.filter((r) => r.sj_div === 'BS' && HELD_FOR_SALE.test(r.account_nm.replace(/\s+/g, '')));
  for (const [line, word] of [['assetsHeldForSale', /자산|assets/i], ['liabilitiesHeldForSale', /부채|liabilit/i]] as const) {
    const row = balance.find((r) => word.test(r.account_nm) && !/포괄|자본|부채.*자산/.test(r.account_nm));
    if (row) {
      current[line] = amount(row.thstrm_amount) ?? 0;
      prior[line] = amount(row.frmtrm_amount) ?? 0;
    }
  }

  // Sales of held-for-sale assets are investing flows. Only cash moved into or out of that category counts.
  const reclassified = rows.filter((r) => r.sj_div === 'CF' && CASH_RECLASSIFIED.test(r.account_nm) && /현금|대체/.test(r.account_nm) && !/처분(?!\s*(자산)?집단)|취득/.test(r.account_nm));
  if (reclassified.length) {
    current.cashOther = reclassified.reduce((sum, r) => sum + (amount(r.thstrm_amount) ?? 0), 0);
    prior.cashOther = reclassified.reduce((sum, r) => sum + (amount(r.frmtrm_amount) ?? 0), 0);
  }
  return { ...meta, unit: inferUnit(rows), current, prior };
}

/** Reads one stored or deflated file from a ZIP archive using its central directory. */
export function readZipEntry(zip: Buffer, name: RegExp, maxBytes = 200 * 1024 * 1024): Buffer {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Not a ZIP archive.');
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(offset + 10);
    const compressed = zip.readUInt32LE(offset + 20);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const entry = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (name.test(entry)) {
      if (size > maxBytes) throw new Error('ZIP entry is larger than expected.');
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + compressed);
      return method === 0 ? Buffer.from(data) : inflateRawSync(data, { maxOutputLength: maxBytes });
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error('ZIP entry not found.');
}

export function parseCorpList(xml: string): Corp[] {
  const corps: Corp[] = [];
  for (const m of xml.matchAll(/<list>([\s\S]*?)<\/list>/g)) {
    const field = (tag: string): string => m[1]!.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1]?.trim() ?? '';
    corps.push({ corpCode: field('corp_code'), name: field('corp_name'), stockCode: field('stock_code') });
  }
  return corps;
}

export function resolveCorp(corps: Corp[], query: string): Corp {
  const q = query.trim();
  const byCode = corps.find((c) => c.stockCode === q || c.corpCode === q);
  if (byCode) return byCode;
  const named = corps.filter((c) => c.name === q);
  // Unlisted companies can share a name with a listed one. The listed one is the subject here.
  const listed = named.filter((c) => c.stockCode);
  if (listed.length === 1) return listed[0]!;
  if (named.length === 1) return named[0]!;
  if (named.length > 1) throw new Error(`"${q}" matches ${named.length} companies. Use the stock code instead.`);
  throw new Error(`No company named "${q}" in the OpenDART list. Use the exact registered name or a stock code.`);
}

export class DartClient {
  private readonly key: string;
  private corps?: Corp[];

  constructor(key: string) {
    this.key = key;
  }

  private async get(path: string, params: Record<string, string> = {}): Promise<Response> {
    const url = new URL(`${BASE}/${path}`);
    url.searchParams.set('crtfc_key', this.key);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    } catch (error) {
      throw new DartError('network', `${path} did not respond (${(error as Error).name}).`);
    }
    if (!response.ok) throw new DartError(String(response.status), `${path} returned HTTP ${response.status}.`);
    return response;
  }

  /** Returns an empty list for status 013, which is how DART says "no data for this query". */
  async list<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const body = (await (await this.get(path, params)).json()) as { status: string; message: string; list?: T[] };
    if (body.status === '013') return [];
    if (body.status !== '000') throw new DartError(body.status, body.message);
    return body.list ?? [];
  }

  async corp(query: string): Promise<Corp> {
    if (!this.corps) {
      const bytes = Buffer.from(await (await this.get('corpCode.xml')).arrayBuffer());
      if (bytes.subarray(0, 2).toString() !== 'PK') {
        const message = bytes.toString('utf8').match(/<message>([^<]*)/)?.[1] ?? 'unexpected response';
        throw new DartError('corpCode', message);
      }
      this.corps = parseCorpList(readZipEntry(bytes, /corpcode\.xml$/i).toString('utf8'));
    }
    return resolveCorp(this.corps, query);
  }

  async company(corpCode: string): Promise<{ corp_name: string; stock_code: string; adres: string; induty_code: string }> {
    const body = (await (await this.get('company.json', { corp_code: corpCode })).json()) as { status: string; message: string; corp_name: string; stock_code: string; adres: string; induty_code: string };
    if (body.status !== '000') throw new DartError(body.status, body.message);
    return body;
  }

  /** Audited annual figures, consolidated when the company files them and separate otherwise. */
  async statement(corp: Corp, fiscalYear: number): Promise<Statement> {
    const params = { corp_code: corp.corpCode, bsns_year: String(fiscalYear), reprt_code: '11011' };
    let rows = await this.list<DartRow>('fnlttSinglAcntAll.json', { ...params, fs_div: 'CFS' });
    let basis: Statement['basis'] = 'consolidated';
    if (rows.length === 0) {
      rows = await this.list<DartRow>('fnlttSinglAcntAll.json', { ...params, fs_div: 'OFS' });
      basis = 'separate';
    }
    if (rows.length === 0) throw new DartError('013', `No annual statements for ${corp.name} in ${fiscalYear}.`);
    const evidence: Evidence = {
      source: 'OpenDART full financial statements (XBRL)',
      locator: `fnlttSinglAcntAll corp_code=${corp.corpCode} bsns_year=${fiscalYear} reprt_code=11011`,
      retrievedAt: new Date().toISOString(),
    };
    return statementFromDartRows(rows, { fiscalYear, basis, company: corp.name, evidence });
  }

  async disclosures(corpCode: string, from: string, to: string): Promise<DisclosureRow[]> {
    const all: DisclosureRow[] = [];
    for (let page = 1; page <= 20; page++) {
      const response = (await (await this.get('list.json', { corp_code: corpCode, bgn_de: from, end_de: to, page_no: String(page), page_count: '100' })).json()) as { status: string; message: string; list?: DisclosureRow[]; total_page?: number };
      if (response.status === '013') break;
      if (response.status !== '000') throw new DartError(response.status, response.message);
      all.push(...(response.list ?? []));
      if (page >= (response.total_page ?? 1)) break;
    }
    return all;
  }

  auditors(corpCode: string, fiscalYear: number): Promise<AuditorRow[]> {
    return this.list<AuditorRow>('accnutAdtorNmNdAdtOpinion.json', { corp_code: corpCode, bsns_year: String(fiscalYear), reprt_code: '11011' });
  }

  executiveHoldings(corpCode: string): Promise<ExecutiveRow[]> {
    return this.list<ExecutiveRow>('elestock.json', { corp_code: corpCode });
  }

  majorHoldings(corpCode: string): Promise<MajorHolderRow[]> {
    return this.list<MajorHolderRow>('majorstock.json', { corp_code: corpCode });
  }

  async sharesIssued(corpCode: string, fiscalYear: number): Promise<number | undefined> {
    const rows = await this.list<{ se: string; istc_totqy?: string }>('stockTotqySttus.json', { corp_code: corpCode, bsns_year: String(fiscalYear), reprt_code: '11011' });
    const total = rows.find((r) => /합계|총계/.test(r.se)) ?? rows.find((r) => /보통주/.test(r.se));
    return amount(total?.istc_totqy);
  }
}

export interface DisclosureRow {
  report_nm: string;
  rcept_no: string;
  rcept_dt: string;
  flr_nm: string;
  rm?: string;
}

export interface AuditorRow {
  bsns_year: string;
  adtor?: string;
  adt_opinion?: string;
  emphs_matter?: string;
  core_adt_matter?: string;
}

export interface ExecutiveRow {
  rcept_dt: string;
  repror: string;
  sp_stock_lmp_irds_cnt?: string;
}

export interface MajorHolderRow {
  rcept_dt: string;
  repror: string;
  stkrt?: string;
  stkrt_irds?: string;
  report_resn?: string;
}

export { amount as parseDartAmount };
