import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { digitFinding } from '../src/checks/digits.ts';
import { extractCitations } from '../src/checks/external.ts';
import { earningsQuality, integrityChecks } from '../src/checks/financial.ts';
import { reconcile, restatementFinding } from '../src/checks/reconcile.ts';
import { parseDartAmount, readZipEntry, statementFromDartRows } from '../src/sources/dart.ts';
import { parseEnvelope, ServiceError } from '../src/sources/mcp.ts';
import { factsToPeriod } from '../src/sources/sec.ts';
import { amountTokens, extractAudit, extractRatings, extractStatement, findSubtotalPair, htmlToLines, stripTags, toRows } from '../src/statements/document.ts';
import { LINES, type Finding, type Statement } from '../src/types.ts';

/** Small deterministic generator (xorshift32), so every failure can be replayed from its seed. */
function rng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x100000000;
  };
}

const pick = <T>(random: () => number, list: readonly T[]): T => list[Math.floor(random() * list.length)]!;

/** The 0.1.0 implementation, kept as the reference for the differential test. */
function legacyHtmlToLines(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/\r?\n/g, ' ')
    .replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_, row: string) => `\u0001${row.replace(/<\/?p\b[^>]*>|<br\s*\/?>/gi, ' ')}\u0001`)
    .replace(/<\/table>|<\/p>|<\/h\d>|<\/div>|<table\b[^>]*>|<br\s*\/?>/gi, '\n')
    .replace(/\u0001/g, '\n');
}

const TOKENS = [
  '<tr>', '<TR class="a">', '</tr>', '</TR>', '<td>', '</td>', '<TD colspan=2>', '</TD>', '<th>', '</th>', '<p>', '</p>', '<P align=center>',
  '<br>', '<BR/>', '<br />', '<script>', '</script>', '<SCRIPT type=x>', '<style>', '</STYLE>', '<table>', '</table>', '<TABLE border=1>',
  '<div>', '</div>', '<h2>', '</h3>', '<tr', '<p', '<', '>', '<<', '\n', '\r\n', ' ', '자산총계', 'Total assets', '1,234', '(5,678)', '△9,012',
  '-', 'x', '<trx>', '<pre>', '<scripts>', '<td', '</t', '&nbsp;', '(단위 : 백만원)',
];

function randomMarkup(random: () => number, length: number): string {
  return Array.from({ length }, () => pick(random, TOKENS)).join('');
}

test('the linear HTML flattener gives exactly what the 0.1.0 one gave, on 3000 random documents', () => {
  for (let seed = 1; seed <= 3000; seed++) {
    const random = rng(seed);
    const html = randomMarkup(random, 1 + Math.floor(random() * 60));
    assert.equal(htmlToLines(html), legacyHtmlToLines(html), `seed ${seed}: ${JSON.stringify(html)}`);
  }
});

test('tag stripping matches the plain regex on random input', () => {
  for (let seed = 1; seed <= 2000; seed++) {
    const random = rng(seed);
    const text = Array.from({ length: Math.floor(random() * 40) }, () => pick(random, ['<', '>', 'a', ' ', '<b>', '</', '<<>', '>>'])).join('');
    assert.equal(stripTags(text), text.replace(/<[^>]+>/g, ''), JSON.stringify(text));
  }
});

/** Each input took tens of seconds in 0.1.0, because the regex engine rescanned it from every tag. */
const HOSTILE: [string, () => unknown][] = [
  ['unclosed table rows', () => htmlToLines('<tr><td>x'.repeat(200_000))],
  ['unclosed scripts', () => htmlToLines('<script>'.repeat(200_000))],
  ['unclosed cells on one line', () => toRows('<td>a'.repeat(200_000))],
  ['angle brackets with no tag end', () => toRows('<'.repeat(400_000))],
  ['a huge label of digits', () => extractStatement(`(단위 : 원)\n| ${'1,'.repeat(200_000)}x | 1,000 | 2,000 |\n| 자산총계 | 1,000 | 2,000 |`, { fiscalYear: 2025 })],
  ['a long run of Hangul', () => extractCitations('가'.repeat(400_000))],
  ['many rows above total assets', () => findSubtotalPair(toRows(Array.from({ length: 20_000 }, (_, i) => `| r${i} | ${(i + 1) * 1000} | ${(i + 2) * 1000} |`).join('\n')), [1, 1])],
];

for (const [name, run] of HOSTILE) {
  test(`hostile input finishes quickly: ${name}`, () => {
    const start = performance.now();
    run();
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 3000, `${name} took ${elapsed.toFixed(0)} ms`);
  });
}

test('a citation after a long run of Hangul is still found', () => {
  assert.ok(extractCitations(`${'가'.repeat(100_000)} 이는 상법 제449조에 따른다.`).includes('상법 제449조'));
});

test('a figure too large to hold exactly is left out rather than rounded', () => {
  const s = extractStatement('(단위 : 원)\n<tr><td>자산총계</td><td>999,999,999,999,999,999,999</td><td>1,000</td></tr>\n<tr><td>부채총계</td><td>500</td><td>400</td></tr>', { fiscalYear: 2025 });
  assert.equal(s.current.totalAssets, undefined);
  assert.equal(s.prior.totalAssets, undefined);
});

const FIXTURE = readFileSync(new URL('./fixtures/samsung-2025-statements.html', import.meta.url), 'utf8');
const STATUSES = new Set(['pass', 'info', 'watch', 'flag', 'unavailable']);

function assertSound(findings: Finding[], context: string): void {
  for (const f of findings) {
    assert.ok(STATUSES.has(f.status), `${context}: ${f.id} status ${f.status}`);
    if (typeof f.value === 'number') assert.ok(Number.isFinite(f.value), `${context}: ${f.id} value ${f.value}`);
    assert.ok(!/NaN|Infinity/.test(f.detail), `${context}: ${f.id} detail ${f.detail}`);
  }
}

function mutate(random: () => number, text: string): string {
  let out = text;
  for (let k = 0, n = 1 + Math.floor(random() * 6); k < n; k++) {
    const at = Math.floor(random() * out.length);
    const span = Math.floor(random() * 400);
    switch (Math.floor(random() * 5)) {
      case 0: out = out.slice(0, at) + out.slice(at + span); break;
      case 1: out = out.slice(0, at) + out.slice(at, at + span) + out.slice(at); break;
      case 2: out = out.slice(0, at) + pick(random, TOKENS) + out.slice(at); break;
      case 3: out = out.replace(/\d/g, (d) => (random() < 0.05 ? String(Math.floor(random() * 10)) : d)); break;
      default: out = out.slice(0, at) + pick(random, ['0', '-', '(0)', '9,999,999,999,999,999', '<TR><TD>자산총계</TD><TD>0</TD><TD>0</TD></TR>']) + out.slice(at);
    }
  }
  return out;
}

test('mutated filings either parse into sound figures or fail with a stated reason, over 400 seeds', () => {
  let parsed = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const random = rng(seed * 7919);
    const text = htmlToLines(mutate(random, FIXTURE));
    const context = `seed ${seed}`;
    assert.doesNotThrow(() => extractAudit(text), context);
    assert.doesNotThrow(() => extractRatings(text), context);
    let raw: Omit<Statement, 'evidence'>;
    try {
      raw = extractStatement(text, random() < 0.5 ? { fiscalYear: 2025 } : {});
    } catch (error) {
      assert.ok(error instanceof Error && error.constructor === Error, `${context}: ${String(error)}`);
      assert.match(error.message, /reporting unit|fiscal year/, context);
      continue;
    }
    parsed++;
    const s: Statement = { ...raw, evidence: { source: 'fuzz' } };
    assert.ok([1, 1_000, 1_000_000].includes(s.unit), `${context}: unit ${s.unit}`);
    for (const period of [s.current, s.prior]) {
      for (const [line, value] of Object.entries(period)) {
        assert.ok((LINES as readonly string[]).includes(line), `${context}: line ${line}`);
        assert.ok(Number.isSafeInteger(value), `${context}: ${line} = ${value}`);
      }
    }
    assertSound(integrityChecks(s), context);
    assertSound(earningsQuality(s), context);
    assertSound([digitFinding(amountTokens(text), s.evidence), restatementFinding(s, { ...s, current: s.prior })], context);
    assert.equal(reconcile(s, s).mismatches.length, 0, context);
  }
  assert.ok(parsed > 100, `only ${parsed} of 400 mutations parsed, so the test is not exercising the checks`);
});

test('zero denominators are reported as not run, never as a score', () => {
  const zero: Statement = {
    fiscalYear: 2025, basis: 'consolidated', unit: 1, evidence: { source: 't' },
    current: Object.fromEntries(LINES.map((l) => [l, 0])),
    prior: Object.fromEntries(LINES.map((l) => [l, 0])),
  };
  const findings = [...integrityChecks(zero), ...earningsQuality(zero)];
  assertSound(findings, 'all zero');
  for (const id of ['quality.beneish', 'quality.altman', 'quality.piotroski']) assert.equal(findings.find((f) => f.id === id)!.status, 'unavailable', id);
});

function zipOf(name: string, content: string, method = 8, flags = 0): Buffer {
  const data = method === 8 ? deflateRawSync(Buffer.from(content)) : Buffer.from(content);
  const nameBytes = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(flags, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(30 + nameBytes.length + data.length, 16);
  return Buffer.concat([local, nameBytes, data, central, nameBytes, end]);
}

const XML = '<result><list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name><stock_code>005930</stock_code></list></result>'.repeat(20);

test('stored ZIP entries are read, and unsupported or encrypted entries are refused', () => {
  assert.equal(readZipEntry(zipOf('a.xml', XML, 0), /a\.xml/).toString(), XML);
  assert.throws(() => readZipEntry(zipOf('a.xml', XML, 12), /a\.xml/), /unsupported compression method 12/);
  assert.throws(() => readZipEntry(zipOf('a.xml', XML, 8, 1), /a\.xml/), /encrypted/);
});

test('every truncation of a ZIP fails with a plain error, never an out-of-range read', () => {
  const zip = zipOf('CORPCODE.xml', XML);
  for (let length = 0; length < zip.length; length++) {
    try {
      readZipEntry(zip.subarray(0, length), /corpcode\.xml$/i);
      assert.fail(`a ${length}-byte prefix was accepted`);
    } catch (error) {
      assert.equal((error as Error).constructor, Error, `${length} bytes: ${String(error)}`);
    }
  }
});

test('random byte corruption of a ZIP never escapes as a RangeError or TypeError', () => {
  const zip = zipOf('CORPCODE.xml', XML);
  for (let seed = 1; seed <= 1500; seed++) {
    const random = rng(seed);
    const bad = Buffer.from(zip);
    for (let k = 0, n = 1 + Math.floor(random() * 4); k < n; k++) bad[Math.floor(random() * bad.length)] = Math.floor(random() * 256);
    try {
      assert.ok(Buffer.isBuffer(readZipEntry(bad, /corpcode\.xml$/i, 1 << 20)));
    } catch (error) {
      assert.equal((error as Error).constructor, Error, `seed ${seed}: ${String(error)}`);
    }
  }
});

test('OpenDART amounts accept plain figures only', () => {
  assert.equal(parseDartAmount('-47,522,179,000,000'), -47522179000000);
  assert.equal(parseDartAmount(' 1,234 '), 1234);
  for (const bad of ['0x10', '1e3', 'Infinity', '12,34a', '', ' ', '-', '--5', '99999999999999999999']) assert.equal(parseDartAmount(bad), undefined, bad);
  const s = statementFromDartRows([{ sj_div: 'BS', account_id: 'ifrs-full_Assets', account_nm: '자산총계', thstrm_amount: '0x10', frmtrm_amount: '1e3' }], { fiscalYear: 2025, basis: 'consolidated', evidence: { source: 't' } });
  assert.deepEqual([s.current.totalAssets, s.prior.totalAssets], [undefined, undefined]);
});

test('malformed service replies are service errors', () => {
  for (const raw of ['{"jsonrpc":', 'data: {not json}', '{} trailing']) {
    assert.throws(() => parseEnvelope(raw), (error: unknown) => error instanceof ServiceError && error.kind === 'upstream', raw);
  }
});

test('malformed SEC company facts read as no facts', () => {
  const shapes: unknown[] = [{}, { facts: null }, { facts: { 'ifrs-full': { Assets: { units: { KRW: 'x' } } } } }, { facts: { 'ifrs-full': { Assets: { units: { KRW: [null, { end: '2025-12-31', val: 'NaN', form: '20-F' }] } } } } }];
  for (const shape of shapes) assert.deepEqual(factsToPeriod(shape as Parameters<typeof factsToPeriod>[0], 2025), {});
});
