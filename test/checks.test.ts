import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextCheck, extractCitations, parseRegion, regionFromAddress } from '../src/checks/external.ts';
import { auditChecks, disclosureChecks, opinionFromDart, ownershipChecks } from '../src/checks/filings.ts';
import { altman, beneish, earningsQuality, integrityChecks, piotroski } from '../src/checks/financial.ts';
import { CORE_LINES, reconcile, restatementFinding } from '../src/checks/reconcile.ts';
import { coverage, fingerprint } from '../src/report.ts';
import type { Report, Statement } from '../src/types.ts';

const evidence = { source: 'test' };
const million = (n: number): number => n * 1e6;

/** Samsung Electronics consolidated statements for 2025, typed from the audited PDF. */
const SAMSUNG: Statement = {
  fiscalYear: 2025, basis: 'consolidated', unit: 1e6, evidence,
  current: {
    totalAssets: million(566942110), currentAssets: million(247684612), nonCurrentAssets: million(319257498), cash: million(57856378),
    tradeReceivables: million(51127642), inventories: million(52636828), ppe: million(215304784), intangibles: million(29480565),
    totalLiabilities: million(130621773), currentLiabilities: million(106411348), nonCurrentLiabilities: million(24210425), totalEquity: million(436320337),
    retainedEarnings: million(402135600), revenue: million(333605938), costOfSales: million(202235513), grossProfit: million(131370425), sga: million(87769374),
    operatingIncome: million(43601051), netIncome: million(45206805), cfo: million(85315148), cfi: million(-68512206), cff: million(-13478040),
    capex: million(47522179), fxEffect: million(825897), depreciation: million(43605740),
  },
  prior: {
    totalAssets: million(514531948), currentAssets: million(227062266), nonCurrentAssets: million(287469682), cash: million(53705579),
    tradeReceivables: million(43623073), inventories: million(51754865), ppe: million(205945209), intangibles: million(23738566),
    totalLiabilities: million(112339878), currentLiabilities: million(93326299), nonCurrentLiabilities: million(19013579), totalEquity: million(402192070),
    retainedEarnings: million(370513188), revenue: million(300870903), costOfSales: million(186562268), grossProfit: million(114308635), sga: million(81582674),
    operatingIncome: million(32725961), netIncome: million(34451351), cfo: million(72982621), cfi: million(-85381702), cff: million(-7797243),
    capex: million(51406355), fxEffect: million(4821010), depreciation: million(39649982),
  },
};

function report(findings: Report['findings']): Report {
  return { tool: { name: 'Assay', version: 'test' }, subject: { query: 'x', fiscalYear: 2025 }, generatedAt: 'now', ratings: [], findings };
}

test('published identities hold on real audited figures', () => {
  for (const f of integrityChecks(SAMSUNG)) assert.equal(f.status, 'pass', f.id);
});

test('models match values computed separately in Python', () => {
  assert.equal(beneish(SAMSUNG).value, -2.634);
  assert.equal(altman(SAMSUNG).value, 7.97);
});

test('a broken balance sheet is flagged', () => {
  const broken = { ...SAMSUNG, current: { ...SAMSUNG.current, totalEquity: million(436000000) } };
  const balance = integrityChecks(broken).find((f) => f.id === 'integrity.balance')!;
  assert.equal(balance.status, 'flag');
});

test('a filed reclassification and FX line complete the cash roll, as at Korean Air FY2025', () => {
  const air: Statement = { ...SAMSUNG, current: { cash: 1869988073408, cfo: 4075191178550, cfi: -2340229124924, cff: -2136782876871, fxEffect: 56516842792, cashOther: -332509191 }, prior: { cash: 2215624563052 } };
  const roll = integrityChecks(air).find((f) => f.id === 'integrity.cash-roll')!;
  assert.equal(roll.status, 'pass');
  assert.equal(roll.value, 0);
});

test('a held-for-sale line listed apart completes the asset split', () => {
  const s: Statement = { ...SAMSUNG, current: { ...SAMSUNG.current, currentAssets: SAMSUNG.current.currentAssets! - million(100), assetsHeldForSale: million(100) } };
  assert.equal(integrityChecks(s).find((f) => f.id === 'integrity.assets-split')!.status, 'pass');
});

test('a held-for-sale line already inside current assets is not added twice, as at LG Electronics FY2025', () => {
  const s: Statement = { ...SAMSUNG, current: { ...SAMSUNG.current, assetsHeldForSale: million(100) } };
  assert.equal(integrityChecks(s).find((f) => f.id === 'integrity.assets-split')!.status, 'pass');
});

test('a real gap still fails with a held-for-sale line present', () => {
  const s: Statement = { ...SAMSUNG, current: { ...SAMSUNG.current, currentAssets: SAMSUNG.current.currentAssets! - million(500), assetsHeldForSale: million(100) } };
  assert.equal(integrityChecks(s).find((f) => f.id === 'integrity.assets-split')!.status, 'flag');
});

test('an empty filing list is not checked, rather than clean', () => {
  const findings = disclosureChecks([], evidence);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.status, 'unavailable');
});

test('leaving a foreign exchange by choice is not a severe filing', () => {
  const row = (report_nm: string) => ({ report_nm, rcept_no: '1', rcept_dt: '20240101', flr_nm: 'x' });
  assert.equal(disclosureChecks([row('주요사항보고서(해외증권시장주권등상장폐지결정)')], evidence).find((f) => f.id === 'disclosure.severe')!.status, 'pass');
  assert.equal(disclosureChecks([row('상장폐지결정')], evidence).find((f) => f.id === 'disclosure.severe')!.status, 'flag');
});

test('rounding alone does not break an identity', () => {
  const rounded = { ...SAMSUNG, current: { ...SAMSUNG.current, totalEquity: SAMSUNG.current.totalEquity! + 1e6 } };
  assert.equal(integrityChecks(rounded).find((f) => f.id === 'integrity.balance')!.status, 'pass');
});

test('missing inputs are reported as not run rather than passing', () => {
  const bank: Statement = { ...SAMSUNG, current: { totalAssets: 100, totalLiabilities: 90, totalEquity: 10 }, prior: {} };
  assert.equal(beneish(bank).status, 'unavailable');
  assert.equal(altman(bank).status, 'unavailable');
  assert.equal(piotroski(bank).status, 'unavailable');
});

test('Piotroski drops the share test when counts are missing and scores it when they exist', () => {
  assert.equal(piotroski(SAMSUNG).value, '6/8');
  assert.equal(piotroski({ ...SAMSUNG, shares: { current: 100, prior: 100 } }).value, '7/9');
});

test('distress shows up on Altman and equity', () => {
  const distressed: Statement = { ...SAMSUNG, current: { ...SAMSUNG.current, totalEquity: -million(1000), retainedEarnings: -million(5000), currentAssets: million(100), currentLiabilities: million(900), operatingIncome: -million(100) } };
  assert.equal(altman(distressed).status, 'flag');
  assert.equal(earningsQuality(distressed).find((f) => f.id === 'solvency.equity')!.status, 'flag');
});

test('reconciliation allows rounding and reports real differences', () => {
  const same = reconcile(SAMSUNG, SAMSUNG);
  assert.equal(same.coreMatched, CORE_LINES.length);
  assert.equal(same.mismatches.length, 0);
  const off = reconcile(SAMSUNG, { ...SAMSUNG, current: { ...SAMSUNG.current, revenue: SAMSUNG.current.revenue! + 1e6, netIncome: SAMSUNG.current.netIncome! + 5e6 } });
  assert.deepEqual(off.mismatches.map((m) => m.line), ['netIncome']);
});

test('a line only one source has is missing, not matched', () => {
  const { cash: _dropped, ...current } = SAMSUNG.current;
  const result = reconcile(SAMSUNG, { ...SAMSUNG, current });
  assert.ok(result.missingCore.includes('cash'));
  assert.equal(result.coreCompared, CORE_LINES.length - 1);
});

test('capex sign conventions do not create differences', () => {
  const negative = { ...SAMSUNG, current: { ...SAMSUNG.current, capex: -SAMSUNG.current.capex! } };
  assert.equal(reconcile(SAMSUNG, negative).mismatches.length, 0);
});

test('changed comparatives are noticed', () => {
  const earlier = { ...SAMSUNG, fiscalYear: 2024, current: SAMSUNG.prior, prior: {} };
  assert.equal(restatementFinding(SAMSUNG, earlier).status, 'pass');
  const restated = { ...SAMSUNG, prior: { ...SAMSUNG.prior, revenue: SAMSUNG.prior.revenue! - million(500) } };
  const finding = restatementFinding(restated, earlier);
  assert.equal(finding.status, 'watch');
  assert.match(finding.detail, /revenue/);
});

test('disclosure rules catch severe titles, amendments and repeated issuance', () => {
  const row = (report_nm: string) => ({ report_nm, rcept_no: '1', rcept_dt: '20250101', flr_nm: 'x' });
  const clean = disclosureChecks([row('사업보고서 (2024.12)'), row('분기보고서 (2025.03)')], evidence);
  for (const f of clean) assert.equal(f.status, 'pass', f.id);
  const bad = disclosureChecks([row('횡령ㆍ배임혐의발생'), row('사업보고서'), row('[기재정정]사업보고서'), ...Array.from({ length: 6 }, () => row('주요사항보고서(전환사채권발행결정)'))], evidence);
  assert.equal(bad.find((f) => f.id === 'disclosure.severe')!.status, 'flag');
  assert.equal(bad.find((f) => f.id === 'disclosure.amendments')!.status, 'flag');
  assert.equal(bad.find((f) => f.id === 'disclosure.dilution')!.status, 'flag');
});

test('Korean opinion labels map correctly, and adverse is not read as clean', () => {
  assert.equal(opinionFromDart('적정'), 'unqualified');
  assert.equal(opinionFromDart('부적정'), 'adverse');
  assert.equal(opinionFromDart('한정'), 'qualified');
  assert.equal(opinionFromDart('의견거절'), 'disclaimer');
  assert.equal(opinionFromDart(undefined), 'not-found');
});

test('a missing audit opinion is not a pass', () => {
  assert.equal(auditChecks([], 2025, undefined, [])[0]!.status, 'unavailable');
});

test('a disagreement between filed and letter opinions is flagged', () => {
  const findings = auditChecks([{ bsns_year: '2025', adt_opinion: '적정' }], 2025, { opinion: 'disclaimer', goingConcernUncertainty: false, keyAuditMatters: [] }, []);
  assert.equal(findings.find((f) => f.id === 'audit.opinion-match')!.status, 'flag');
});

test('the current term is used when OpenDART labels years by term number', () => {
  const rows = [{ bsns_year: '제56기 (전기)', adt_opinion: '한정의견' }, { bsns_year: '제57기 \n(당기)', adt_opinion: '적정의견' }];
  assert.equal(auditChecks(rows, 2025, undefined, [])[0]!.value, 'unqualified');
});

test('clustered insider selling is a watch, and a single seller is not', () => {
  const seller = (repror: string, change: string) => ({ rcept_dt: '2025-06-01', repror, sp_stock_lmp_irds_cnt: change });
  const asOf = new Date('2025-12-31');
  assert.equal(ownershipChecks([seller('a', '-10'), seller('b', '-1,000'), seller('c', '-5')], [], asOf, evidence)[0]!.status, 'watch');
  assert.equal(ownershipChecks([seller('a', '-10')], [], asOf, evidence)[0]!.status, 'info');
});

test('reads region codes in the format the building service returns', () => {
  const text = '총 1건\n입력의 번지는 bun=416 로 전달하세요.\n시도명 시군구명 읍면동명 sigungu_code bdong_code\n경기도 수원시 영통구 매탄동 41117 10100';
  assert.deepEqual(parseRegion(text), { sigungu: '41117', bdong: '10100', bun: '416', ji: undefined });
  assert.equal(parseRegion('no codes'), undefined);
});

test('extracts statute citations and removes leading noise', () => {
  const found = extractCitations('이는 상법 제449조의2 및 주식회사 등의 외부감사에 관한 법률 제23조에 따른다.');
  assert.ok(found.includes('상법 제449조의2'), found.join());
  assert.ok(found.some((c) => c.endsWith('외부감사에 관한 법률 제23조')), found.join());
});

test('finds the region in an address', () => {
  assert.equal(regionFromAddress('경기도 수원시 영통구 삼성로 129'), '영통구');
  assert.equal(regionFromAddress('서울특별시 강남구 테헤란로 152'), '강남구');
});

test('coverage counts not-run layers against the total', () => {
  const c = coverage(report([
    { id: 'a', layer: 'integrity', title: 'a', status: 'pass', detail: '', evidence: [] },
    { id: 'b', layer: 'intangible', title: 'b', status: 'unavailable', detail: '', evidence: [] },
  ]));
  assert.equal(c.layersRun, 1);
  assert.ok(c.missing.includes('Intangible assets'));
  assert.equal(c.counts.unavailable, 1);
});

test('fingerprints ignore timestamps and live services, but not conclusions', () => {
  const base = [{ id: 'a', layer: 'integrity' as const, title: 'a', status: 'pass' as const, detail: 'one', evidence: [], value: 1 }];
  const live = { id: 'p', layer: 'intangible' as const, title: 'p', status: 'unavailable' as const, detail: '', evidence: [] };
  assert.equal(fingerprint(report(base)), fingerprint({ ...report([...base, live]), generatedAt: 'later' }));
  assert.notEqual(fingerprint(report(base)), fingerprint(report([{ ...base[0]!, status: 'flag' }])));
});

test('contextCheck is exported for live use', () => {
  assert.equal(typeof contextCheck, 'function');
});
