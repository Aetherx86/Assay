import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectUnit, extractAudit, extractRatings, extractStatement, findDepreciation, findPairInText, findSubtotalPair, htmlToLines, latestRatings, toRows } from '../src/statements/document.ts';

const FILED = `
<P>연결 재무상태표</P><P>제 3 기 2025.12.31 현재</P><P>(단위 : 백만원)</P>
<TABLE><THEAD><TR><TH>과목</TH><TH>주 석</TH><TH>제 3 기</TH><TH>제 2 기</TH></TR></THEAD><TBODY>
<TR><TD>유동자산</TD><TD></TD><TD>600</TD><TD>500</TD></TR>
<TR><TD>　현금및현금성자산 (주4,29)</TD><TD>4,29</TD><TD>100</TD><TD>90</TD></TR>
<TR><TD>비유동자산</TD><TD></TD><TD>1,400</TD><TD>1,300</TD></TR>
<TR><TD><P>자 산 총 계</P></TD><TD></TD><TD><P>2,000</P></TD><TD>1,800</TD></TR>
<TR><TD>유동부채</TD><TD></TD><TD>400</TD><TD>350</TD></TR>
<TR><TD>비유동부채</TD><TD></TD><TD>300</TD><TD>250</TD></TR>
<TR><TD>부채총계</TD><TD></TD><TD>700</TD><TD>600</TD></TR>
<TR><TD>자본총계</TD><TD></TD><TD>1,300</TD><TD>1,200</TD></TR>
</TBODY></TABLE>
<P>연결 포괄손익계산서</P>
<TABLE><TBODY><TR><TD>매출액</TD><TD>30</TD><TD>1,000</TD><TD>900</TD></TR>
<TR><TD>영업이익(손실)</TD><TD></TD><TD>(50)</TD><TD>70</TD></TR>
<TR><TD>당기순이익(손실)</TD><TD></TD><TD>(40)</TD><TD>60</TD></TR></TBODY></TABLE>
<TABLE><TBODY><TR><TD>재무활동현금흐름</TD><TD></TD><TD>(10)</TD><TD>(20)</TD></TR></TBODY></TABLE>
<P>연결재무제표 주석</P>
<TABLE><TBODY><TR><TD>매출액</TD><TD>9,999</TD><TD>8,888</TD></TR></TBODY></TABLE>`;

test('reads a filed Korean statement in millions of won', () => {
  const s = extractStatement(htmlToLines(FILED), { fiscalYear: 2025 });
  assert.equal(s.unit, 1_000_000);
  assert.equal(s.basis, 'consolidated');
  assert.equal(s.current.totalAssets, 2_000e6);
  assert.equal(s.prior.totalAssets, 1_800e6);
  assert.equal(s.current.cash, 100e6);
  assert.equal(s.current.operatingIncome, -50e6);
  assert.equal(s.current.currentAssets, 600e6);
  assert.equal(s.current.nonCurrentLiabilities, 300e6);
});

test('does not take figures from the notes', () => {
  const s = extractStatement(htmlToLines(FILED), { fiscalYear: 2025 });
  assert.equal(s.current.revenue, 1_000e6);
});

test('a note reference is not read as an amount', () => {
  const [row] = toRows('| Revenue | 30 | 333,605,938 | 300,870,903 |');
  assert.deepEqual(row!.values, [333605938, 300870903]);
  const [listed] = toRows('| Trade receivables | 4,5,7,29 | 51,127,642 | 43,623,073 |');
  assert.deepEqual(listed!.values, [51127642, 43623073]);
});

test('reads parentheses, dashes and triangle marks', () => {
  const [row] = toRows('<tr><td>x</td><td>(1,234)</td><td>-</td><td>△5,678</td></tr>');
  assert.deepEqual(row!.values, [-1234, 0, -5678]);
});

test('figures merged into the label cell are still read', () => {
  const [row] = toRows('<tr><td>Total assets 566,942,110 514,531,948 398,725,657</td><td>361,866,027</td></tr>');
  assert.equal(row!.label, 'Total assets');
  assert.equal(row!.values[0], 566942110);
});

test('subtotals are found by arithmetic in both years, whatever the label says', () => {
  const rows = toRows('| Non-current assets | 247,684,612 | 227,062,266 |\n| Other | 1,000 | 2,000 |\n|  | 319,257,498 | 287,469,682 |');
  const pair = findSubtotalPair(rows, [566942110, 514531948]);
  assert.equal(pair?.[0].values[0], 247684612);
  assert.equal(pair?.[1].values[0], 319257498);
});

test('a pair that adds up in only one year is rejected', () => {
  const rows = toRows('| a | 1,000 | 5,000 |\n| b | 2,000 | 5,000 |');
  assert.equal(findSubtotalPair(rows, [3000, 9000]), undefined);
});

test('refuses to guess the reporting unit', () => {
  assert.throws(() => detectUnit('자산총계 1,000 900'), /Refusing to guess/);
  assert.equal(detectUnit('(In millions of Korean won) Total assets'), 1_000_000);
  assert.equal(detectUnit('(단위 : 원) 자산총계'), 1);
});

test('reads each kind of audit opinion', () => {
  assert.equal(extractAudit('In our opinion, the accompanying statements present fairly, in all material respects').opinion, 'unqualified');
  assert.equal(extractAudit('우리의 의견으로는 별첨된 재무제표는 공정하게 표시하고 있습니다.').opinion, 'unqualified');
  assert.equal(extractAudit('의견거절\n우리는 첨부된 재무제표에 대하여 의견을 표명하지 않습니다.').opinion, 'disclaimer');
  assert.equal(extractAudit('부적정의견\n내용').opinion, 'adverse');
  assert.equal(extractAudit('한정의견\n내용').opinion, 'qualified');
  assert.equal(extractAudit('nothing relevant').opinion, 'not-found');
});

test('audit boilerplate about going concern is not a finding', () => {
  const boilerplate = '경영진이 사용한 회계의 계속기업전제의 적절성과 존속능력에 대하여 유의적 의문을 초래할 수 있는 사건이나 상황과 관련된 불확실성';
  assert.equal(extractAudit(boilerplate).goingConcernUncertainty, false);
  assert.equal(extractAudit('계속기업 관련 중요한 불확실성\n내용').goingConcernUncertainty, true);
});

test('key audit matters stop at the next section', () => {
  const letter = '핵심감사사항\n설명\n(1) 수익인식의 적정성\n연결재무제표에 대한 경영진과 지배기구의 책임\n(2) 회사의 개요';
  assert.deepEqual(extractAudit(letter).keyAuditMatters, ['수익인식의 적정성']);
});

test('reads ratings, skips commercial paper, and keeps the latest per agency', () => {
  const text = htmlToLines(`<P>사. 신용평가에 관한 사항</P><TABLE>
    <TR><TD>회사채</TD><TD>AA</TD><TD>한기평</TD><TD>2023.02.01</TD></TR>
    <TR><TD>회사채</TD><TD>AA+</TD><TD>한국기업평가</TD><TD>2026.01.29</TD></TR>
    <TR><TD>기업어음</TD><TD>A1</TD><TD>NICE신용평가</TD><TD>2026.01.29</TD></TR></TABLE>`);
  const latest = latestRatings(extractRatings(text));
  assert.deepEqual(latest, [{ agency: '한국기업평가', grade: 'AA+', date: '2026.01.29' }]);
});

test('finds a rounded prior and current pair on one line of a deck', () => {
  const deck = '| 6.5 | 12.2 | 32.7 | 10.9% | 43.6 | 13.1% |\n| 14.1% only |';
  assert.equal(findPairInText(deck, 43.601e12, 32.726e12, 1e12, 1), true);
  assert.equal(findPairInText(deck, 43.601e12, 99e12, 1e12, 1), false);
});

test('depreciation skips small tables in the notes, as in Samsung FY2025', () => {
  const rows = toRows('| 감가상각비 | (1) | (2) | (3) | (436,100) |\n| 감가상각비 | (48,917) | (4,622,802) | (37,251,068) | (43,605,740) |\n| 감가상각비 | (50,029) | (4,268,335) | (33,744,595) | (39,649,982) |');
  assert.deepEqual(findDepreciation([], rows, 215304784e6, 205945209e6, 1e6), [43605740e6, 39649982e6]);
});

test('depreciation stays unknown when no row is plausible', () => {
  const rows = toRows('| 감가상각비 | 1 | 2 | 3 | 4,000 |\n| 감가상각비 | 1 | 2 | 3 | 3,000 |');
  assert.equal(findDepreciation([], rows, 900000e6, 800000e6, 1e6), undefined);
});

test('a zero in the statement falls through to the notes', () => {
  const statement = toRows('| 감가상각비 | 12,663,500 | - |');
  const notes = toRows('| 감가상각비 | (1) | (2) | (3) | (12,663,500) |\n| 감가상각비 | (1) | (2) | (3) | (11,535,635) |');
  assert.deepEqual(findDepreciation(statement, notes, 77502704e6, 60157474e6, 1e6), [12663500e6, 11535635e6]);
});

test('key audit matters are found by the heading that follows the title', () => {
  const letter = '핵심감사사항\n설명 문장입니다.\n건설중인자산의 감가상각개시시점 평가\n핵심감사사항으로 결정한 이유\n본문\n핵심감사사항이 감사에서 다루어진 방법\n연결재무제표에 대한 경영진과 지배기구의 책임';
  assert.deepEqual(extractAudit(letter).keyAuditMatters, ['건설중인자산의 감가상각개시시점 평가']);
});

test('ratings written with a zero and under a short heading are read', () => {
  const text = htmlToLines('<P>(1) 신용평가</P><TABLE><TR><TD>회사채</TD><TD>AA0</TD><TD>한국신용평가</TD><TD>2026-01-05</TD></TR></TABLE>');
  assert.deepEqual(extractRatings(text), [{ agency: '한국신용평가', grade: 'AA', date: '2026-01-05' }]);
});

test('a balance sheet line named held for sale is not a cash movement', () => {
  const html = `<P>연결 재무상태표</P><P>(단위 : 백만원)</P><TABLE>
    <TR><TD>매각예정분류자산</TD><TD>67,588</TD><TD>1,000</TD></TR>
    <TR><TD>자산총계</TD><TD>2,000</TD><TD>1,800</TD></TR>
    <TR><TD>재무활동현금흐름</TD><TD>(319,476)</TD><TD>(704,675)</TD></TR>
    <TR><TD>처분집단으로 분류된 현금및현금성자산의 증감</TD><TD>(641)</TD><TD>(663)</TD></TR>
    <TR><TD>기말현금및현금성자산</TD><TD>8,769,841</TD><TD>7,573,036</TD></TR>
    </TABLE>`;
  const s = extractStatement(htmlToLines(html), { fiscalYear: 2025 });
  assert.equal(s.current.cashOther, -641e6);
});

test('subordinated grades are not the company grade, and a long heading still counts', () => {
  const text = htmlToLines(`<P>(7) 신용평가에 관한 사항(최근 3사업연도)</P><TABLE>
    <TR><TD>2023.06.07</TD><TD>회사채</TD><TD>A-(안정적)</TD><TD>한국신용평가(AAA~D)</TD></TR>
    <TR><TD>2023.06.08</TD><TD>전환사채(후순위)</TD><TD>BBB+(안정적)</TD><TD>한국신용평가(AAA~D)</TD></TR></TABLE>`);
  assert.deepEqual(extractRatings(text), [{ agency: '한국신용평가', grade: 'A-', date: '2023.06.07' }]);
});

test('a reclassification far below the financing total is found near closing cash', () => {
  const filler = Array.from({ length: 20 }, (_, i) => `<TR><TD>재무 세부 ${i}</TD><TD>1,000</TD><TD>2,000</TD></TR>`).join('');
  const html = `<P>연결 재무상태표</P><P>(단위 : 원)</P><TABLE><TR><TD>자산총계</TD><TD>2,000</TD><TD>1,800</TD></TR>
    <TR><TD>재무활동현금흐름</TD><TD>(5,000)</TD><TD>(4,000)</TD></TR>${filler}
    <TR><TD>매각예정자산으로의 대체</TD><TD>(332)</TD><TD>0</TD></TR>
    <TR><TD>기말현금및현금성자산</TD><TD>9,000</TD><TD>8,000</TD></TR></TABLE>`;
  assert.equal(extractStatement(htmlToLines(html), { fiscalYear: 2025 }).current.cashOther, -332);
});

test('selling and administrative wording variants are read', () => {
  const html = '<P>연결 재무상태표</P><P>(단위 : 원)</P><TABLE><TR><TD>자산총계</TD><TD>2,000</TD><TD>1,800</TD></TR><TR><TD>판매 및 일반관리비</TD><TD>700</TD><TD>600</TD></TR></TABLE>';
  assert.equal(extractStatement(htmlToLines(html), { fiscalYear: 2025 }).current.sga, 700);
});

const CASH_TAIL = (rows: string): string => `<P>연결 재무상태표</P><P>(단위 : 원)</P><TABLE><TR><TD>자산총계</TD><TD>2,000</TD><TD>1,800</TD></TR>
  <TR><TD>재무활동현금흐름</TD><TD>(5,000)</TD><TD>(4,000)</TD></TR>${rows}</TABLE>`;

test('blank years in reclassification rows keep their columns, as at E-MART FY2025', () => {
  const html = CASH_TAIL(`<TR><TD>처분집단 현금의 순증감</TD><TD>139,370</TD><TD></TD></TR>
    <TR><TD>처분집단으로 분류된 현금</TD><TD></TD><TD>(433,080)</TD></TR>
    <TR><TD>기말현금및현금성자산</TD><TD>1,303,370</TD><TD>1,775,060</TD></TR>`);
  const s = extractStatement(htmlToLines(html), { fiscalYear: 2025 });
  assert.equal(s.current.cashOther, 139370);
  assert.equal(s.prior.cashOther, -433080);
});

test('opening and closing held-for-sale cash both count, as at LG Chem FY2025', () => {
  const html = CASH_TAIL(`<TR><TD>기초 매각예정자산집단에 포함된 현금</TD><TD>23,880</TD><TD>-</TD></TR>
    <TR><TD>기말 매각예정자산집단에 포함된 현금</TD><TD>(1,160)</TD><TD>-</TD></TR>
    <TR><TD>기말 현금및현금성자산</TD><TD>9,899,930</TD><TD>7,854,880</TD></TR>`);
  assert.equal(extractStatement(htmlToLines(html), { fiscalYear: 2025 }).current.cashOther, 22720);
});

test('the net change before FX is not the FX effect', () => {
  const html = CASH_TAIL(`<TR><TD>환율변동효과 반영전 현금및현금성자산의 순증가(감소)</TD><TD>40,650</TD><TD>27,440</TD></TR>
    <TR><TD>현금및현금성자산에 대한 환율변동효과</TD><TD>(5)</TD><TD>(10)</TD></TR>`);
  assert.equal(extractStatement(htmlToLines(html), { fiscalYear: 2025 }).current.fxEffect, -5);
});

test('a line labelled only as a loss is negative whatever its printed sign', () => {
  const html = `<P>연결 재무상태표</P><P>(단위 : 원)</P><TABLE><TR><TD>자산총계</TD><TD>2,000</TD><TD>1,800</TD></TR>
    <TR><TD>영업손실</TD><TD>780</TD><TD>6,650</TD></TR><TR><TD>당기순손실</TD><TD>(8,510)</TD><TD>(10,460)</TD></TR></TABLE>`;
  const s = extractStatement(htmlToLines(html), { fiscalYear: 2025 });
  assert.equal(s.current.operatingIncome, -780);
  assert.equal(s.prior.netIncome, -10460);
});

test('a line labelled profit or loss keeps its printed sign', () => {
  const html = `<P>연결 재무상태표</P><P>(단위 : 원)</P><TABLE><TR><TD>자산총계</TD><TD>2,000</TD><TD>1,800</TD></TR><TR><TD>영업이익(손실)</TD><TD>780</TD><TD>(650)</TD></TR></TABLE>`;
  const s = extractStatement(htmlToLines(html), { fiscalYear: 2025 });
  assert.equal(s.current.operatingIncome, 780);
  assert.equal(s.prior.operatingIncome, -650);
});

test('a summary balance sheet is not mistaken for the statements', () => {
  const html = `<P>요약연결재무상태표</P><TABLE><TR><TD>자산총계</TD><TD>9</TD><TD>8</TD></TR></TABLE>
    <P>연결 재무상태표</P><P>(단위 : 백만원)</P><TABLE><TR><TD>자산총계</TD><TD>2,000</TD><TD>1,800</TD></TR></TABLE>`;
  assert.equal(extractStatement(htmlToLines(html), { fiscalYear: 2025 }).current.totalAssets, 2000e6);
});

test('a cash flow line about receivables is not the receivables balance', () => {
  const html = `<P>연결 재무상태표</P><P>(단위 : 원)</P><TABLE><TR><TD>자산총계</TD><TD>2,000</TD><TD>1,800</TD></TR><TR><TD>매출채권의 증감</TD><TD>500</TD><TD>400</TD></TR></TABLE>`;
  assert.equal(extractStatement(htmlToLines(html), { fiscalYear: 2025 }).current.tradeReceivables, undefined);
});

test('subtotals exclude a held-for-sale line, as at CJ CheilJedang FY2025', () => {
  const html = `<P>연결 재무상태표</P><P>(단위 : 천원)</P><TABLE>
    <TR><TD>유동자산</TD><TD>7,578,773,538</TD><TD>8,954,370,527</TD></TR>
    <TR><TD>매각예정 또는 분배예정으로 분류된 자산</TD><TD>1,290,319,071</TD><TD>45,594,593</TD></TR>
    <TR><TD>비유동자산</TD><TD>20,875,697,925</TD><TD>21,133,711,121</TD></TR>
    <TR><TD>자산총계</TD><TD>29,744,790,534</TD><TD>30,133,676,241</TD></TR></TABLE>`;
  const s = extractStatement(htmlToLines(html), { fiscalYear: 2025 });
  assert.equal(s.current.currentAssets, 7578773538e3);
  assert.equal(s.current.nonCurrentAssets, 20875697925e3);
  assert.equal(s.current.assetsHeldForSale, 1290319071e3);
});

test('totals worded with 합계 are read, and sentences are not headings, as at Samsung SDI FY2025', () => {
  const html = `<P>입출고내역 확인을 통해 재무상태표일 기준 재고자산의 실재성을 확인합니다.</P>
    <P>2-1. 연결 재무상태표</P><P>(단위 : 원)</P><TABLE><TR><TD>자산 합계</TD><TD>42,255,338,580,919</TD><TD>40,597,344,536,357</TD></TR>
    <TR><TD>부채 합계</TD><TD>18,685,225,421,089</TD><TD>19,030,107,423,830</TD></TR></TABLE>`;
  const s = extractStatement(htmlToLines(html), { fiscalYear: 2025 });
  assert.equal(s.basis, 'consolidated');
  assert.equal(s.current.totalAssets, 42255338580919);
  assert.equal(s.current.totalLiabilities, 18685225421089);
});

test('a held-for-sale line inside current assets does not hide the subtotals', () => {
  const html = `<P>연결 재무상태표</P><P>(단위 : 백만원)</P><TABLE>
    <TR><TD>유동자산</TD><TD>34,869,900</TD><TD>30,000,000</TD></TR>
    <TR><TD>매각예정분류자산</TD><TD>67,588</TD><TD>1,000</TD></TR>
    <TR><TD>비유동자산</TD><TD>33,750,300</TD><TD>31,000,000</TD></TR>
    <TR><TD>자산총계</TD><TD>68,620,200</TD><TD>61,000,000</TD></TR></TABLE>`;
  assert.equal(extractStatement(htmlToLines(html), { fiscalYear: 2025 }).current.currentAssets, 34869900e6);
});
