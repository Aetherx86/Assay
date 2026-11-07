export const LINES = [
  'totalAssets', 'currentAssets', 'nonCurrentAssets', 'assetsHeldForSale', 'cash', 'tradeReceivables', 'inventories', 'ppe', 'intangibles',
  'totalLiabilities', 'currentLiabilities', 'nonCurrentLiabilities', 'liabilitiesHeldForSale', 'totalEquity', 'retainedEarnings',
  'revenue', 'costOfSales', 'grossProfit', 'sga', 'operatingIncome', 'netIncome',
  'cfo', 'cfi', 'cff', 'capex', 'fxEffect', 'cashOther', 'depreciation',
] as const;

export type Line = (typeof LINES)[number];
export type Period = Partial<Record<Line, number>>;

/** Figures are always whole KRW, whatever unit the source printed them in. */
export interface Statement {
  company?: string;
  fiscalYear: number;
  basis: 'consolidated' | 'separate' | 'unknown';
  /** Size in KRW of the smallest unit the source reports (1_000_000 for "in millions of won"). */
  unit: number;
  current: Period;
  prior: Period;
  shares?: { current?: number; prior?: number };
  evidence: Evidence;
}

export interface Evidence {
  source: string;
  locator?: string;
  retrievedAt?: string;
  sha256?: string;
}

export type Layer =
  | 'integrity' | 'earnings-quality' | 'reconciliation' | 'audit' | 'disclosure'
  | 'ownership' | 'intangible' | 'physical' | 'legal' | 'context';

/**
 * `unavailable` means the check did not run. It must never be read as a pass, and the
 * report counts it against coverage rather than leaving it out.
 */
export type Status = 'pass' | 'info' | 'watch' | 'flag' | 'unavailable';

export interface Finding {
  id: string;
  layer: Layer;
  title: string;
  status: Status;
  detail: string;
  value?: number | string | null;
  evidence: Evidence[];
}

export interface AuditReport {
  opinion: 'unqualified' | 'qualified' | 'adverse' | 'disclaimer' | 'not-found';
  goingConcernUncertainty: boolean;
  keyAuditMatters: string[];
}

export interface CreditRating {
  agency: string;
  grade: string;
  date?: string;
}

export interface Report {
  tool: { name: string; version: string };
  subject: { query: string; name?: string; stockCode?: string; fiscalYear: number; address?: string };
  generatedAt: string;
  statement?: Statement;
  audit?: AuditReport;
  ratings: CreditRating[];
  findings: Finding[];
}
