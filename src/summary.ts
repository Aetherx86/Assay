import { GRADES } from './statements/grades.ts';
import type { Finding, Period, Report } from './types.ts';

export type Lang = 'ko' | 'en';

export interface AssetRow {
  label: string;
  amount: number;
  share: number;
  /** Change from the prior year as a ratio, when both years are known. */
  change?: number;
}

export interface Summary {
  /** One or two sentences a reader can stop at. */
  headline: string;
  /** What the company owns, largest first. */
  assets: AssetRow[];
  /** Assets outside the balance sheet figures, from public registers. */
  registers: string[];
  /** Short facts about size, profit, debt and outside opinions. */
  facts: string[];
  /** Serious items: an auditor or a filing raised them, or the figures do not add up. */
  serious: string[];
  /** Items to read more closely, which often have innocent explanations. */
  caution: string[];
  /** Checks that did not run, so nobody reads silence as good news. */
  notChecked: string[];
  disclaimer: string;
}

const TEXT = {
  ko: {
    cash: '현금', receivables: '매출채권', inventories: '재고', ppe: '공장·설비·토지 등 유형자산', intangibles: '특허·영업권 등 무형자산', other: '기타(금융상품·투자자산 등)',
    disclaimer: '공개 자료를 자동으로 점검한 결과입니다. 감사나 투자 권유가 아니며, 위 내용만으로 투자를 결정하면 안 됩니다.',
    none: '자세히 볼 항목이 없습니다.',
    seriousCount: (n: number) => `꼭 확인할 항목이 ${n}건 있습니다.`,
    cautionCount: (n: number) => `자세히 볼 항목이 ${n}건 있습니다.`,
    size: (name: string, year: number, assets: string) => `${name}의 ${year}년 말 총자산은 ${assets}입니다.`,
    funding: (debt: string, equity: string) => `이 중 부채가 ${debt}, 자기자본이 ${equity}입니다.`,
    debtRatio: (r: string) => `부채비율은 ${r}입니다. 낮을수록 빚 부담이 적지만 적정 수준은 업종마다 다릅니다.`,
    deficit: '자기자본이 0 이하입니다. 빚이 자산보다 많다는 뜻입니다.',
    sales: (now: string, change: string) => `매출은 ${now}이고 전년보다 ${change}.`,
    profit: (op: string, net: string) => `영업이익은 ${op}, 순이익은 ${net}입니다.`,
    cashBacking: (ratio: string) => `순이익 대비 영업현금흐름은 ${ratio}배입니다. 1배 근처 이상이면 이익이 실제 현금으로 들어온다는 뜻입니다.`,
    current: (ratio: string) => `1년 안에 갚을 빚 대비 1년 안에 현금화할 자산은 ${ratio}배입니다. 1배 미만이면 단기 자금 사정을 살펴야 합니다.`,
    opinion: { unqualified: '회계법인 감사의견은 적정입니다. 재무제표가 기준에 맞게 작성됐다는 뜻이며, 회사가 좋다는 뜻은 아닙니다.', qualified: '회계법인 감사의견이 한정입니다.', adverse: '회계법인 감사의견이 부적정입니다.', disclaimer: '회계법인이 감사의견을 거절했습니다.', 'not-found': '' },
    rating: (grade: string) => `신용평가사 등급은 ${grade}입니다.`,
    up: (p: string) => `${p} 늘었습니다`, down: (p: string) => `${p} 줄었습니다`, flat: '비슷합니다',
    patents: (n: string) => `회사 이름으로 보유한 특허·실용신안 ${n}건`,
    building: (site: string, n: string) => `${site}: 건축물대장에 건물 ${n}개 동 등록 (소유자 확인은 아님)`,
    notRun: (name: string) => `${name}: 이번에 확인하지 못했습니다.`,
    split: (grade: string) => `재무 점수(Altman)는 위험 구간이지만 신용평가사 등급은 ${grade}입니다. 판단이 갈리니 빚 구조와 계열사 지원 여부를 확인하세요.`,
    meaning: {
      'audit.opinion': '회계법인이 재무제표에 문제를 제기했습니다.',
      'audit.going-concern': '회계법인이 회사가 계속 영업할 수 있을지 불확실하다고 밝혔습니다.',
      'audit.opinion-match': '공시된 감사의견과 감사보고서 내용이 다릅니다.',
      'disclosure.severe': '횡령, 상장폐지, 회생절차 같은 심각한 내용의 공시가 있었습니다. 제목만 본 것이니 원문을 확인하세요.',
      integrity: '재무제표 숫자끼리 서로 맞지 않습니다.',
      reconciliation: '같은 회사의 서류끼리 숫자가 다릅니다.',
      'solvency.equity': '자기자본에 비해 빚이 많습니다.',
      'solvency.current': '단기에 갚을 빚이 현금화할 자산보다 많습니다.',
      'solvency.intangibles': '자기자본에 비해 무형자산 비중이 큽니다. 가치가 떨어지면 자본이 크게 줄 수 있습니다.',
      'quality.altman': '재무 점수(Altman)가 재무 위험 구간입니다.',
      'quality.beneish': '이익 조작 가능성을 재는 점수(Beneish)가 높습니다. 빠르게 성장하는 회사도 높게 나옵니다.',
      'quality.piotroski': '재무 체력 점수(Piotroski)가 낮습니다.',
      'quality.accruals': '이익에서 현금으로 뒷받침되지 않는 부분이 큽니다. 투자가 많은 회사도 높게 나옵니다.',
      'quality.cash-conversion': '이익만큼 현금이 들어오지 않았습니다.',
      'quality.receivables': '매출보다 받을 돈이 훨씬 빠르게 늘었습니다.',
      'quality.inventory': '매출보다 재고가 훨씬 빠르게 늘었습니다.',
      'quality.ppe-roll': '투자액으로 설명되지 않는 유형자산 변동이 있습니다.',
      'disclosure.amendments': '정기보고서를 정정한 비율이 높습니다.',
      'disclosure.dilution': '전환사채나 유상증자가 잦아 주식 가치가 희석될 수 있습니다.',
      'ownership.insiders': '임원 여러 명이 주식을 팔았습니다.',
      'ownership.large-holders': '대주주 지분이 크게 줄었습니다.',
      'reconciliation.restatement': '작년 숫자가 올해 보고서에서 바뀌었습니다.',
      'intangible.patents': '무형자산은 큰데 회사 이름으로 등록된 특허가 없습니다.',
      'legal.citations': '공시에 인용된 법 조문 중 확인되지 않는 것이 있습니다.',
    } as Record<string, string>,
  },
  en: {
    cash: 'Cash', receivables: 'Receivables', inventories: 'Inventory', ppe: 'Factories, equipment and land', intangibles: 'Patents, goodwill and other intangibles', other: 'Other (financial instruments, investments)',
    disclaimer: 'This is an automated check of public records. It is not an audit or investment advice, and it is not enough to base an investment on.',
    none: 'Nothing needs a closer look.',
    seriousCount: (n: number) => `${n} serious item(s) to check.`,
    cautionCount: (n: number) => `${n} item(s) to read more closely.`,
    size: (name: string, year: number, assets: string) => `${name} held ${assets} in total assets at the end of ${year}.`,
    funding: (debt: string, equity: string) => `Of that, ${debt} is debt and ${equity} is equity.`,
    debtRatio: (r: string) => `Liabilities are ${r} of equity. Lower means less debt burden, though normal levels differ by industry.`,
    deficit: 'Equity is zero or negative, meaning debts exceed assets.',
    sales: (now: string, change: string) => `Revenue was ${now} and ${change} on the prior year.`,
    profit: (op: string, net: string) => `Operating income was ${op} and net income ${net}.`,
    cashBacking: (ratio: string) => `Operating cash flow was ${ratio} times net income. Around 1 or more means profit is arriving as cash.`,
    current: (ratio: string) => `Assets due within a year cover ${ratio} times the debts due within a year. Below 1 means short-term funding needs a look.`,
    opinion: { unqualified: 'The auditor gave a clean opinion. That means the statements follow the rules, not that the business is good.', qualified: 'The auditor gave a qualified opinion.', adverse: 'The auditor gave an adverse opinion.', disclaimer: 'The auditor refused to give an opinion.', 'not-found': '' },
    rating: (grade: string) => `Credit agencies rate it ${grade}.`,
    up: (p: string) => `up ${p}`, down: (p: string) => `down ${p}`, flat: 'about flat',
    patents: (n: string) => `${n} patents and utility models held under the company name`,
    building: (site: string, n: string) => `${site}: ${n} building(s) on the national register, which does not prove ownership`,
    notRun: (name: string) => `${name}: not checked this time.`,
    split: (grade: string) => `The Altman score is in its distress zone, but credit agencies rate the company ${grade}. The two disagree, so look at its debt structure and any group support.`,
    meaning: {
      'audit.opinion': 'The auditor raised a problem with the statements.',
      'audit.going-concern': 'The auditor says it is uncertain whether the company can keep operating.',
      'audit.opinion-match': 'The filed audit opinion differs from the audit report.',
      'disclosure.severe': 'A filing mentions something severe, such as embezzlement, delisting or insolvency. Only the title was read, so check the filing.',
      integrity: 'The figures in the statements do not add up.',
      reconciliation: "The company's own documents disagree on a figure.",
      'solvency.equity': 'Debt is high compared with equity.',
      'solvency.current': 'Short-term debts exceed assets due within a year.',
      'solvency.intangibles': 'Intangibles are large compared with equity, so a write-down could hurt.',
      'quality.altman': 'The Altman score is in its distress zone.',
      'quality.beneish': 'The Beneish earnings manipulation score is high. Fast-growing firms also score high.',
      'quality.piotroski': 'The Piotroski financial strength score is low.',
      'quality.accruals': 'Much of the profit is not backed by cash. Heavy investment also raises this.',
      'quality.cash-conversion': 'Less cash came in than profit suggests.',
      'quality.receivables': 'Money owed to the company grew much faster than revenue.',
      'quality.inventory': 'Inventory grew much faster than revenue.',
      'quality.ppe-roll': 'Fixed assets moved by more than investment explains.',
      'disclosure.amendments': 'Many periodic reports were amended.',
      'disclosure.dilution': 'Frequent convertible or share issuance can dilute shareholders.',
      'ownership.insiders': 'Several executives sold shares.',
      'ownership.large-holders': "A large holder's stake fell sharply.",
      'reconciliation.restatement': "Last year's figures changed in this year's report.",
      'intangible.patents': 'Intangibles are large, yet no patents are registered under this name.',
      'legal.citations': 'Some statutes cited in the filing could not be confirmed.',
    } as Record<string, string>,
  },
};

function money(value: number, lang: Lang): string {
  const size = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (lang === 'ko') {
    if (size >= 1e12) return `${sign}${(size / 1e12).toFixed(1)}조원`;
    return `${sign}${Math.round(size / 1e8).toLocaleString('en-US')}억원`;
  }
  if (size >= 1e12) return `${sign}KRW ${(size / 1e12).toFixed(1)} tn`;
  return `${sign}KRW ${(size / 1e9).toFixed(1)} bn`;
}

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(ratio >= 10 ? 0 : 1)}%`;
}

function assetRows(c: Period, p: Period, lang: Lang): AssetRow[] {
  const t = TEXT[lang];
  const total = c.totalAssets;
  if (!total) return [];
  const named = [
    [t.cash, c.cash, p.cash], [t.receivables, c.tradeReceivables, p.tradeReceivables], [t.inventories, c.inventories, p.inventories],
    [t.ppe, c.ppe, p.ppe], [t.intangibles, c.intangibles, p.intangibles],
  ] as const;
  const rows: AssetRow[] = named.filter(([, value]) => value !== undefined).map(([label, value, prior]) => ({
    label, amount: value!, share: value! / total, ...(prior ? { change: value! / prior - 1 } : {}),
  }));
  const other = total - rows.reduce((sum, r) => sum + r.amount, 0);
  if (other > 0) rows.push({ label: t.other, amount: other, share: other / total });
  return rows.sort((a, b) => b.amount - a.amount);
}

function bestGrade(report: Report): string | undefined {
  return report.ratings.map((r) => r.grade).filter((g) => GRADES.includes(g)).sort((a, b) => GRADES.indexOf(b) - GRADES.indexOf(a))[0];
}

function meaningOf(f: Finding, lang: Lang): string {
  const meanings = TEXT[lang].meaning;
  return meanings[f.id] ?? meanings[f.id.split(/[.:]/)[0]!] ?? f.title;
}

const SERIOUS_IDS = /^(audit\.|disclosure\.severe|integrity\.|reconciliation\.sources)/;

/**
 * Turns a report into what an individual investor needs first: what the company owns, whether it
 * makes money, how much it owes, and what to look at. It never says to buy or sell.
 */
export function summarize(report: Report, lang: Lang = 'ko'): Summary {
  const t = TEXT[lang];
  const name = report.subject.name ?? report.subject.query;
  const s = report.statement;
  const c = s?.current ?? {};
  const p = s?.prior ?? {};
  const facts: string[] = [];
  const headline: string[] = [];

  if (c.totalAssets !== undefined) headline.push(t.size(name, report.subject.fiscalYear, money(c.totalAssets, lang)));
  if (c.totalLiabilities !== undefined && c.totalEquity !== undefined) {
    facts.push(t.funding(money(c.totalLiabilities, lang), money(c.totalEquity, lang)));
    facts.push(c.totalEquity > 0 ? t.debtRatio(percent(c.totalLiabilities / c.totalEquity)) : t.deficit);
  }
  if (c.revenue !== undefined) {
    const growth = p.revenue ? c.revenue / p.revenue - 1 : undefined;
    const change = growth === undefined ? '' : Math.abs(growth) < 0.005 ? t.flat : growth > 0 ? t.up(percent(growth)) : t.down(percent(-growth));
    facts.push(t.sales(money(c.revenue, lang), change).replace(/\s+\.$/, '.'));
  }
  if (c.operatingIncome !== undefined && c.netIncome !== undefined) facts.push(t.profit(money(c.operatingIncome, lang), money(c.netIncome, lang)));
  if (c.cfo !== undefined && c.netIncome !== undefined && c.netIncome > 0) facts.push(t.cashBacking((c.cfo / c.netIncome).toFixed(1)));
  if (c.currentAssets !== undefined && c.currentLiabilities) facts.push(t.current((c.currentAssets / c.currentLiabilities).toFixed(1)));
  const opinion = report.audit?.opinion ?? (report.findings.find((f) => f.id === 'audit.opinion')?.value as keyof typeof t.opinion | undefined);
  if (opinion && t.opinion[opinion]) facts.push(t.opinion[opinion]);
  const grade = bestGrade(report);
  if (grade) facts.push(t.rating(grade));

  const registers: string[] = [];
  for (const f of report.findings) {
    if (f.status === 'unavailable') continue;
    if (f.id === 'intangible.patents' && f.value !== null && f.value !== undefined) registers.push(t.patents(String(f.value)));
    if (f.id.startsWith('physical.site:')) registers.push(t.building(f.id.slice('physical.site:'.length), String(f.value ?? 0)));
  }

  const serious: string[] = [];
  const caution: string[] = [];
  const split = grade !== undefined && GRADES.indexOf(grade) <= GRADES.indexOf('A-');
  for (const f of report.findings) {
    if (f.status !== 'flag' && f.status !== 'watch') continue;
    if (f.id === 'quality.altman' && f.status === 'flag' && split) {
      caution.push(t.split(grade!));
      continue;
    }
    const zeroEquity = f.id === 'solvency.equity' && c.totalEquity !== undefined && c.totalEquity <= 0;
    const text = meaningOf(f, lang);
    if (f.status === 'flag' && (SERIOUS_IDS.test(f.id) || zeroEquity)) serious.push(text);
    else caution.push(text);
  }
  const unique = (items: string[]): string[] => [...new Set(items)];

  const seriousList = unique(serious);
  const cautionList = unique(caution);
  headline.push(seriousList.length ? t.seriousCount(seriousList.length) : cautionList.length ? t.cautionCount(cautionList.length) : t.none);

  const notChecked = unique(report.findings.filter((f) => f.status === 'unavailable' && !/^(quality|source)\./.test(f.id)).map((f) => t.notRun(f.title)));

  return {
    headline: headline.join(' '),
    assets: assetRows(c, p, lang),
    registers,
    facts,
    serious: seriousList,
    caution: cautionList,
    notChecked,
    disclaimer: t.disclaimer,
  };
}

export function summaryMarkdown(report: Report, lang: Lang = 'ko'): string {
  const s = summarize(report, lang);
  const ko = lang === 'ko';
  const out = [ko ? '## 한눈에 보기' : '## At a glance', '', s.headline, ''];
  if (s.assets.length) {
    out.push(ko ? '### 이 회사가 가진 것' : '### What the company owns', '', ko ? '| 자산 | 금액 | 비중 | 전년 대비 |' : '| Asset | Amount | Share | Change |', '| --- | ---: | ---: | ---: |');
    for (const a of s.assets) out.push(`| ${a.label} | ${money(a.amount, lang)} | ${percent(a.share)} | ${a.change === undefined ? '-' : `${a.change >= 0 ? '+' : ''}${percent(a.change)}`} |`);
    out.push('');
  }
  if (s.registers.length) out.push(ko ? '### 공공 기록에서 확인한 자산' : '### Found in public registers', '', ...s.registers.map((r) => `- ${r}`), '');
  if (s.facts.length) out.push(ko ? '### 핵심 내용' : '### Key facts', '', ...s.facts.map((f) => `- ${f}`), '');
  if (s.serious.length) out.push(ko ? '### 꼭 확인할 항목' : '### Serious items', '', ...s.serious.map((f) => `- ${f}`), '');
  if (s.caution.length) out.push(ko ? '### 자세히 볼 항목' : '### Worth a closer look', '', ...s.caution.map((f) => `- ${f}`), '');
  if (s.notChecked.length) out.push(ko ? '### 확인하지 못한 항목' : '### Not checked', '', ...s.notChecked.map((f) => `- ${f}`), '');
  out.push(`*${s.disclaimer}*`, '');
  return out.join('\n');
}
