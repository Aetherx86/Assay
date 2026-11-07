import type { Line, Period } from '../types.ts';

const USER_AGENT = 'assay-validation/0.1';

const TAGS: Partial<Record<Line, string>> = {
  totalAssets: 'Assets',
  totalLiabilities: 'Liabilities',
  totalEquity: 'Equity',
  currentAssets: 'CurrentAssets',
  currentLiabilities: 'CurrentLiabilities',
  cash: 'CashAndCashEquivalents',
  revenue: 'Revenue',
  netIncome: 'ProfitLoss',
  cfo: 'CashFlowsFromUsedInOperatingActivities',
  cfi: 'CashFlowsFromUsedInInvestingActivities',
  cff: 'CashFlowsFromUsedInFinancingActivities',
};

interface Fact {
  end: string;
  val: number;
  form?: string;
  start?: string;
}

interface CompanyFacts {
  entityName: string;
  facts: Record<string, Record<string, { units: Record<string, Fact[]> }>>;
}

export function factsToPeriod(facts: CompanyFacts, fiscalYear: number): Period {
  const period: Period = {};
  const end = `${fiscalYear}-12-31`;
  const taxonomy = facts.facts['ifrs-full'] ?? {};
  for (const [line, tag] of Object.entries(TAGS) as [Line, string][]) {
    const rows = taxonomy[tag]?.units['KRW']?.filter((f) => f.end === end && f.form?.startsWith('20-F')) ?? [];
    // Flow items also appear for shorter periods, so only a full year counts.
    const annual = rows.filter((f) => !f.start || f.start === `${fiscalYear}-01-01`);
    const latest = annual.at(-1);
    if (latest) period[line] = latest.val;
  }
  return period;
}

/** Reads the XBRL a Korean company filed with the US SEC, which is a separate filing channel. */
export async function fetchSecPeriod(cik: string, fiscalYear: number): Promise<Period> {
  const response = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, '0')}.json`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`SEC returned HTTP ${response.status}.`);
  return factsToPeriod((await response.json()) as CompanyFacts, fiscalYear);
}
