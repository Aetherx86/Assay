import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarize, summaryMarkdown } from '../src/summary.ts';
import type { Finding, Report } from '../src/types.ts';

function report(findings: Finding[], overrides: Partial<Report> = {}): Report {
  return {
    tool: { name: 'Assay', version: 't' }, subject: { query: '005930', name: '삼성전자', fiscalYear: 2025 }, generatedAt: 'now', ratings: [], findings,
    statement: {
      fiscalYear: 2025, basis: 'consolidated', unit: 1e6, evidence: { source: 't' },
      current: { totalAssets: 566.9e12, cash: 57.9e12, tradeReceivables: 51.1e12, inventories: 52.6e12, ppe: 215.3e12, intangibles: 29.5e12, totalLiabilities: 130.6e12, totalEquity: 436.3e12, revenue: 333.6e12, operatingIncome: 43.6e12, netIncome: 45.2e12, cfo: 85.3e12, currentAssets: 247.7e12, currentLiabilities: 106.4e12 },
      prior: { totalAssets: 514.5e12, ppe: 205.9e12, revenue: 300.9e12 },
    },
    ...overrides,
  };
}
const flag = (id: string, status: Finding['status'] = 'flag'): Finding => ({ id, layer: 'earnings-quality', title: id, status, detail: '', evidence: [] });

test('the asset view adds up to total assets and is largest first', () => {
  const { assets } = summarize(report([]));
  assert.equal(assets[0]!.label, '공장·설비·토지 등 유형자산');
  assert.ok(Math.abs(assets.reduce((s, a) => s + a.amount, 0) - 566.9e12) < 1e6);
  assert.ok(Math.abs(assets.reduce((s, a) => s + a.share, 0) - 1) < 1e-9);
  assert.ok(assets[0]!.change! > 0.04 && assets[0]!.change! < 0.05);
});

test('the headline gives size in plain units and says when nothing stands out', () => {
  const s = summarize(report([]));
  assert.match(s.headline, /삼성전자의 2025년 말 총자산은 566\.9조원/);
  assert.match(s.headline, /자세히 볼 항목이 없습니다/);
});

test('a clean summary never advises buying or selling', () => {
  for (const lang of ['ko', 'en'] as const) {
    const text = summaryMarkdown(report([flag('audit.opinion'), flag('quality.altman')]), lang);
    assert.doesNotMatch(text, /매수하|매도하|사세요|파세요|추천합니다|\bbuy\b|\bsell\b|recommend/i);
  }
});

test('auditor problems are serious, while scoring models are only worth a look', () => {
  const s = summarize(report([flag('audit.going-concern'), flag('quality.beneish')]));
  assert.equal(s.serious.length, 1);
  assert.match(s.serious[0]!, /계속 영업/);
  assert.equal(s.caution.length, 1);
  assert.match(s.headline, /꼭 확인할 항목이 1건/);
});

test('Altman distress on a well rated company is shown as a disagreement, not an alarm', () => {
  const s = summarize(report([flag('quality.altman')], { ratings: [{ agency: 'NICE', grade: 'AA-' }] }));
  assert.equal(s.serious.length, 0);
  assert.match(s.caution[0]!, /판단이 갈리니/);
});

test('Altman distress without a strong rating stays a plain caution', () => {
  const s = summarize(report([flag('quality.altman')], { ratings: [{ agency: 'NICE', grade: 'BB' }] }));
  assert.doesNotMatch(s.caution[0]!, /판단이 갈리니/);
});

test('negative equity is serious, and high leverage alone is not', () => {
  const negative = report([flag('solvency.equity')]);
  negative.statement!.current.totalEquity = -1e9;
  assert.equal(summarize(negative).serious.length, 1);
  assert.equal(summarize(report([flag('solvency.equity')])).serious.length, 0);
});

test('checks that did not run are listed, so silence is not read as good news', () => {
  const s = summarize(report([{ id: 'intangible.patents', layer: 'intangible', title: 'Registered IP', status: 'unavailable', detail: '', evidence: [] }]));
  assert.equal(s.notChecked.length, 1);
  assert.match(s.notChecked[0]!, /확인하지 못했습니다/);
});

test('register findings appear with their limit stated', () => {
  const s = summarize(report([{ id: 'physical.site:수원시 영통구 매탄동 416', layer: 'physical', title: 'x', status: 'pass', detail: '', value: 79, evidence: [] }]));
  assert.match(s.registers[0]!, /79개 동.*소유자 확인은 아님/);
});

test('an empty report still produces a summary instead of failing', () => {
  const s = summarize(report([], { statement: undefined }));
  assert.deepEqual(s.assets, []);
  assert.ok(s.headline.length > 0);
});
