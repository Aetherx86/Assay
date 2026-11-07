import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { inferUnit, parseCorpList, readZipEntry, resolveCorp, statementFromDartRows, type DartRow } from '../src/sources/dart.ts';
import { parseDocumentList, parseFilingRows, refusal, yearlyWindows } from '../src/sources/kind.ts';
import { parseEnvelope } from '../src/sources/mcp.ts';
import { factsToPeriod } from '../src/sources/sec.ts';
import { evaluateGates, spearman, verdict, type EntryResult } from '../src/validate.ts';

function zipOf(name: string, content: string): Buffer {
  const data = deflateRawSync(Buffer.from(content));
  const nameBytes = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(30 + nameBytes.length + data.length, 16);
  return Buffer.concat([local, nameBytes, data, central, nameBytes, end]);
}

test('reads the corporate code list out of its ZIP', () => {
  const xml = '<result><list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name><stock_code>005930</stock_code></list></result>';
  const corps = parseCorpList(readZipEntry(zipOf('CORPCODE.xml', xml), /corpcode\.xml$/i).toString());
  assert.deepEqual(corps, [{ corpCode: '00126380', name: '삼성전자', stockCode: '005930' }]);
});

test('refuses an oversized ZIP entry', () => {
  assert.throws(() => readZipEntry(zipOf('a.xml', 'x'.repeat(5000)), /a\.xml/, 100), /larger than expected/);
});

test('company lookup prefers a listed company and rejects ambiguous names', () => {
  const corps = [
    { corpCode: '1', name: '삼성전자', stockCode: '005930' },
    { corpCode: '2', name: '삼성전자', stockCode: '' },
    { corpCode: '3', name: '동명', stockCode: '' },
    { corpCode: '4', name: '동명', stockCode: '' },
  ];
  assert.equal(resolveCorp(corps, '삼성전자').corpCode, '1');
  assert.equal(resolveCorp(corps, '005930').corpCode, '1');
  assert.throws(() => resolveCorp(corps, '동명'), /matches 2 companies/);
  assert.throws(() => resolveCorp(corps, '없는회사'), /No company named/);
});

const ROWS: DartRow[] = [
  { sj_div: 'BS', account_id: 'ifrs-full_Assets', account_nm: '자산총계', thstrm_amount: '566,942,110,000,000', frmtrm_amount: '514,531,948,000,000' },
  { sj_div: 'BS', account_id: '-표준계정코드 미사용-', account_nm: '재고자산', thstrm_amount: '52,636,828,000,000', frmtrm_amount: '51,754,865,000,000' },
  { sj_div: 'SCE', account_id: 'ifrs-full_Equity', account_nm: '기말자본', thstrm_amount: '999,000,000', frmtrm_amount: '' },
  { sj_div: 'BS', account_id: 'ifrs-full_Equity', account_nm: '자본총계', thstrm_amount: '436,320,337,000,000', frmtrm_amount: '402,192,070,000,000' },
  { sj_div: 'CIS', account_id: 'ifrs-full_ProfitLoss', account_nm: '당기순이익', thstrm_amount: '45,206,805,000,000', frmtrm_amount: '34,451,351,000,000' },
  { sj_div: 'CF', account_id: 'ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities', account_nm: '유형자산의 취득', thstrm_amount: '-47,522,179,000,000', frmtrm_amount: '' },
];

test('maps XBRL tags to lines, with name fallback, in the right statement', () => {
  const s = statementFromDartRows(ROWS, { fiscalYear: 2025, basis: 'consolidated', evidence: { source: 't' } });
  assert.equal(s.current.totalAssets, 566942110e6);
  assert.equal(s.current.inventories, 52636828e6);
  assert.equal(s.current.totalEquity, 436320337e6, 'must not read the equity changes statement');
  assert.equal(s.current.netIncome, 45206805e6);
  assert.equal(s.current.capex, 47522179e6, 'capex is stored as a size');
  assert.equal(s.prior.capex, undefined, 'a blank amount stays missing');
});

test('infers the reporting precision of filed figures', () => {
  assert.equal(inferUnit(ROWS.filter((r) => r.sj_div !== 'SCE')), 1e6);
  assert.equal(inferUnit([{ sj_div: 'BS', account_nm: 'x', thstrm_amount: '1,234,567' }]), 1);
  assert.equal(inferUnit([{ sj_div: 'BS', account_nm: 'x', thstrm_amount: '1,234,000' }]), 1e3);
});

test('reads KIND search rows in their real format', () => {
  const html = `<tr><td>1</td><td>2026-03-17 16:03</td><td><img src='/images/common/icn_t_yu.gif' class='vmiddle legend' alt='유가증권'> <a id="companysum" href="#companysum" onclick="companysummary_open('00066'); return false;" title='SK하이닉스'> SK하이닉스</a></td>
    <td><a href="#viewer" onclick="openDisclsViewer('20260317000735','')" title='사업보고서(일반법인)'><font color='#FF8040'>[연결포함]</font>사업보고서(일반법인)<font color='#FF8040'>(2025.12)</font></a></td></tr>`;
  const [row] = parseFilingRows(html);
  assert.equal(row!.rcept_no, '20260317000735');
  assert.equal(row!.report_nm, '[연결포함]사업보고서(일반법인)(2025.12)');
  assert.equal(row!.rcept_dt, '20260317');
  assert.equal(row!.company, 'SK하이닉스');
});

test('reads the document list of a filing', () => {
  const html = `<option value="">본문선택</option><option value='20260317002879|Y'selected="selected">사업보고서(일반법인) (2026.03.17)</option><option>첨부문서선택</option><option value='20260317002886'>연결감사보고서 (2026.03.17)</option>`;
  assert.deepEqual(parseDocumentList(html), [
    { docNo: '20260317002879', title: '사업보고서(일반법인) (2026.03.17)' },
    { docNo: '20260317002886', title: '연결감사보고서 (2026.03.17)' },
  ]);
});

test('parses both JSON and event stream replies', () => {
  assert.equal(parseEnvelope('{"result":{"isError":true}}').result?.isError, true);
  assert.equal(parseEnvelope('event: message\ndata: {"result":{"content":[{"text":"x"}]}}\n\n').result?.content?.[0]?.text, 'x');
  assert.throws(() => parseEnvelope('<html>'), /no JSON-RPC/);
});

test('reads SEC facts for a full year from a 20-F only', () => {
  const facts = { entityName: 'x', facts: { 'ifrs-full': {
    Assets: { units: { KRW: [{ end: '2025-12-31', val: 100, form: '6-K' }, { end: '2025-12-31', val: 200, form: '20-F' }] } },
    Revenue: { units: { KRW: [{ start: '2025-10-01', end: '2025-12-31', val: 1, form: '20-F' }, { start: '2025-01-01', end: '2025-12-31', val: 9, form: '20-F' }] } },
  } } };
  assert.deepEqual(factsToPeriod(facts, 2025), { totalAssets: 200, revenue: 9 });
});

test('Spearman handles perfect, inverse and tied ranks', () => {
  assert.equal(spearman([1, 2, 3], [10, 20, 30]), 1);
  assert.equal(spearman([1, 2, 3], [30, 20, 10]), -1);
  assert.equal(spearman([1, 1, 1], [1, 2, 3]), 0);
});

function entry(partial: Partial<EntryResult>): EntryResult {
  return { id: 'x', set: 'dev', name: 'x', fiscalYear: 2025, statuses: {}, coreMatched: 12, coreCompared: 12, mismatches: [], layersRun: 6, notRun: [], notRunReasons: [], financial: false, ...partial };
}

test('gates that could not run make the verdict incomplete, never a pass', () => {
  const gates = evaluateGates([entry({})], [], { dartKey: false, reviews: 0 });
  assert.equal(gates.find((g) => g.id === 'G8')!.status, 'not-run');
  assert.equal(gates.find((g) => g.id === 'G6')!.status, 'not-run');
  assert.equal(verdict(gates), 'INCOMPLETE');
});

test('any failed gate fails the verdict', () => {
  const gates = evaluateGates([entry({ coreMatched: 5 })], [], { dartKey: false, reviews: 0 });
  assert.equal(gates.find((g) => g.id === 'G1')!.status, 'fail');
  assert.equal(verdict(gates), 'FAIL');
});

test('a company that crashes fails G0 and is not counted as clean', () => {
  const gates = evaluateGates([entry({ id: 'bad', error: 'boom' })], [], { dartKey: false, reviews: 0 });
  assert.equal(gates.find((g) => g.id === 'G0')!.status, 'fail');
});

test('a changed conclusion between rounds fails repeatability', () => {
  const round = (fingerprint: string): EntryResult[] => [entry({ fingerprint })];
  const same = evaluateGates(round('a'), [round('a'), round('a')], { dartKey: false, reviews: 0 });
  assert.equal(same.find((g) => g.id === 'G6')!.status, 'pass');
  const drift = evaluateGates(round('b'), [round('a'), round('a')], { dartKey: false, reviews: 0 });
  assert.equal(drift.find((g) => g.id === 'G6')!.status, 'fail');
});

test('cost lines filed as negatives are stored as sizes', () => {
  const s = statementFromDartRows([{ sj_div: 'IS', account_id: 'ifrs-full_CostOfSales', account_nm: '매출원가', thstrm_amount: '-100', frmtrm_amount: '-90' }], { fiscalYear: 2025, basis: 'consolidated', evidence: { source: 't' } });
  assert.equal(s.current.costOfSales, 100);
});

test('held-for-sale lines are read by name, whatever the row order, and equity lines are ignored', () => {
  const s = statementFromDartRows([
    { sj_div: 'BS', account_id: 'ifrs-full_Assets', account_nm: '자산총계', thstrm_amount: '100', frmtrm_amount: '90' },
    { sj_div: 'BS', account_nm: '매각예정분류 기타포괄손익누계액', thstrm_amount: '1', frmtrm_amount: '1' },
    { sj_div: 'BS', account_nm: '매각예정비유동자산', thstrm_amount: '10', frmtrm_amount: '1' },
    { sj_div: 'BS', account_nm: '매각예정 처분자산집단에 포함된 부채', thstrm_amount: '5', frmtrm_amount: '' },
  ], { fiscalYear: 2025, basis: 'consolidated', evidence: { source: 't' } });
  assert.equal(s.current.assetsHeldForSale, 10);
  assert.equal(s.current.liabilitiesHeldForSale, 5);
});

test('selling a held-for-sale asset is not a cash reclassification, as at SK hynix FY2025', () => {
  const s = statementFromDartRows([
    { sj_div: 'CF', account_nm: '매각예정자산의 처분', thstrm_amount: '85', frmtrm_amount: '0' },
    { sj_div: 'CF', account_nm: '처분집단으로 분류된 현금및현금성자산의 증감', thstrm_amount: '-3', frmtrm_amount: '0' },
    { sj_div: 'CF', account_nm: '매각예정자산으로의 대체', thstrm_amount: '-1', frmtrm_amount: '0' },
  ], { fiscalYear: 2025, basis: 'consolidated', evidence: { source: 't' } });
  assert.equal(s.current.cashOther, -4);
});

test('a long KIND range becomes yearly queries that cover it exactly', () => {
  assert.deepEqual(yearlyWindows('2023-01-01', '2025-06-30'), [['2023-01-01', '2023-12-31'], ['2024-01-01', '2024-12-31'], ['2025-01-01', '2025-06-30']]);
  assert.deepEqual(yearlyWindows('2026-03-01', '2026-11-07'), [['2026-03-01', '2026-11-07']]);
});

test('a refused KIND search is recognised', () => {
  assert.equal(refusal('<script>alert("조회기간은 3년 이내만 가능합니다.");</script> 조회된 결과값이 없습니다.'), '조회기간은 3년 이내만 가능합니다.');
  assert.equal(refusal('<td>목록</td>'), undefined);
});
