import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { VERSION } from '../src/analyze.ts';
import { checkDocument, checkText, exceeds } from '../src/check.ts';
import { BENFORD_FIRST, benfordTest, chiSquare8Survival, digitFinding, expectedMad, leadingDigit, MIN_AMOUNTS } from '../src/checks/digits.ts';
import { amountTokens } from '../src/statements/document.ts';
import type { Report } from '../src/types.ts';

const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/samsung-2025-statements.html', import.meta.url));
const EVIDENCE = { source: 'test' };

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === 'number' ? e.code : 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

test('leadingDigit extracts first significant digit for finite amounts >= 1', () => {
  assert.equal(leadingDigit(1), 1);
  assert.equal(leadingDigit(987_654), 9);
  assert.equal(leadingDigit(42.9), 4);
  assert.equal(leadingDigit(3.5e25), 3);
  for (const bad of [0, -5, 0.99, Number.NaN, Infinity, -Infinity]) {
    assert.equal(leadingDigit(bad), undefined, String(bad));
  }
});

test('chiSquare8Survival and expectedMad match closed-form properties', () => {
  assert.equal(chiSquare8Survival(0), 1);
  assert.equal(chiSquare8Survival(-1), 1);
  // At x = 8, h = 4: exp(-4) * (1 + 4 + 8 + 32/3) = exp(-4) * 71/3
  const expectedAt8 = Math.exp(-4) * (71 / 3);
  assert.ok(Math.abs(chiSquare8Survival(8) - expectedAt8) < 1e-12);
  assert.ok(chiSquare8Survival(8) > chiSquare8Survival(20));
  assert.ok(chiSquare8Survival(100) < 1e-15);

  assert.equal(expectedMad(0), Infinity);
  assert.equal(expectedMad(-10), Infinity);
  const mad1000 = expectedMad(1000);
  assert.ok(mad1000 > 0.007 && mad1000 < 0.008, `expectedMad(1000) = ${mad1000}`);
  assert.ok(expectedMad(10_000) < mad1000);
  assert.ok(Math.abs(BENFORD_FIRST.reduce((s, p) => s + p, 0) - 1) < 1e-12);
});

test('benfordTest distinguishes Benford-conforming and skewed distributions', () => {
  assert.equal(benfordTest([]), undefined);
  assert.equal(benfordTest([0, -10, 0.5]), undefined);

  // Logarithmically spaced integers follow Benford's law closely.
  const conforming = Array.from({ length: 3000 }, (_, i) => Math.round(10 ** (3 + (i / 3000) * 6)));
  const good = benfordTest(conforming)!;
  assert.equal(good.n, 3000);
  assert.equal(good.conformity, 'close conformity');
  assert.ok(good.mad < 0.006, `MAD ${good.mad}`);
  assert.ok(good.pValue > 0.9, `pValue ${good.pValue}`);

  // Values concentrated on leading digits 7-9 fail conformity.
  const skewed = Array.from({ length: 1500 }, (_, i) => 7_000_000 + i * 1_900);
  const bad = benfordTest(skewed)!;
  assert.equal(bad.conformity, 'nonconformity');
  assert.ok(bad.mad > 0.015, `MAD ${bad.mad}`);
  assert.ok(bad.pValue < 1e-6, `pValue ${bad.pValue}`);
});

test('digitFinding requires MIN_AMOUNTS distinct values and deduplicates repeated amounts', () => {
  const small = digitFinding(Array.from({ length: MIN_AMOUNTS - 1 }, (_, i) => i + 1000), EVIDENCE);
  assert.equal(small.status, 'unavailable');
  assert.match(small.detail, /Needs at least 1000 distinct/);

  // 1500 distinct Benford-distributed values plus one commercial-paper figure repeated 1500 times.
  const distinct = Array.from({ length: 1500 }, (_, i) => Math.round(10 ** (4 + (i / 1500) * 5)));
  const repeated = [...distinct, ...Array.from({ length: 1500 }, () => 90_000_000)];
  const finding = digitFinding(repeated, EVIDENCE);
  assert.equal(finding.status, 'info');
  assert.equal(typeof finding.value, 'number');
  assert.ok((finding.value as number) <= 0.006, `deduplicated MAD should stay in close conformity: ${finding.value}`);
  assert.match(finding.detail, /Most repeated amount: 90,000,000, printed 1500 times/);

  const nonconforming = Array.from({ length: 1200 }, (_, i) => 8_000_000 + i * 13);
  const watch = digitFinding(nonconforming, EVIDENCE);
  assert.equal(watch.status, 'watch');
  assert.ok(typeof watch.value === 'number' && watch.value > 0.015);
});

test('amountTokens extracts comma-grouped figures cell by cell without merging adjacent cells', () => {
  const html = '<tr><td>매출액</td><td>1,234</td><td>(5,678)</td><td>주석 12</td><td>2025</td></tr>';
  const tokens = amountTokens(html);
  assert.deepEqual(tokens, [1234, 5678]);
});

test('checkDocument checks a local HTML filing offline and exceeds evaluates severity gates', async () => {
  const report = await checkDocument(FIXTURE);
  assert.equal(report.tool.version, VERSION);
  assert.equal(report.subject.fiscalYear, 2025);
  assert.equal(report.audit?.opinion, 'unqualified');
  assert.equal(exceeds(report, 'flag'), false);
  assert.equal(exceeds(report, 'watch'), false);
  assert.equal(report.findings.find((f) => f.id === 'integrity.balance')?.status, 'pass');
  assert.equal(report.findings.find((f) => f.id === 'quality.digits')?.status, 'unavailable');

  const broken = checkText('(단위 : 백만원)\n| 자산총계 | 200,000 | 100,000 |\n| 부채총계 | 50,000 | 50,000 |\n| 자본총계 | 100,000 | 50,000 |', EVIDENCE, { fiscalYear: 2025 });
  assert.equal(exceeds(broken, 'flag'), true);
  assert.equal(exceeds(broken, 'watch'), true);
});

test('CLI supports --version, check (--json and --fail-on), and reconcile --json', async () => {
  const ver = await runCli(['--version']);
  assert.equal(ver.code, 0);
  assert.equal(ver.stdout.trim(), VERSION);

  const ok = await runCli(['check', FIXTURE, '--json', '--fail-on', 'flag']);
  assert.equal(ok.code, 0, ok.stderr);
  const parsed = JSON.parse(ok.stdout) as Report;
  assert.equal(parsed.tool.version, VERSION);
  assert.equal(parsed.subject.fiscalYear, 2025);
  assert.equal(parsed.findings.find((f) => f.id === 'integrity.balance')?.status, 'pass');

  const rec = await runCli(['reconcile', FIXTURE, FIXTURE, '--year', '2025', '--json']);
  assert.equal(rec.code, 0, rec.stderr);
  const recJson = JSON.parse(rec.stdout) as { coreMatched: number; coreCompared: number; mismatches: unknown[] };
  assert.equal(recJson.mismatches.length, 0);
  assert.equal(recJson.coreMatched, recJson.coreCompared);
  assert.ok(recJson.coreCompared >= 12);

  const dir = await mkdtemp(join(tmpdir(), 'assay-cli-'));
  try {
    const brokenPath = join(dir, 'broken.txt');
    await writeFile(brokenPath, '(단위 : 백만원)\n자산총계\t200,000\t100,000\n부채총계\t50,000\t50,000\n자본총계\t100,000\t50,000\n', 'utf8');
    const gated = await runCli(['check', brokenPath, '--year', '2025', '--fail-on', 'flag']);
    assert.equal(gated.code, 1);
    assert.match(gated.stdout, /# Assay report:/);

    const mismatch = await runCli(['reconcile', FIXTURE, brokenPath, '--year', '2025', '--json']);
    assert.equal(mismatch.code, 1);
    const mismatchJson = JSON.parse(mismatch.stdout) as { mismatches: unknown[] };
    assert.ok(mismatchJson.mismatches.length > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const badFailOn = await runCli(['check', FIXTURE, '--fail-on', 'bogus']);
  assert.equal(badFailOn.code, 1);
  assert.match(badFailOn.stderr, /--fail-on takes watch or flag/);

  const badYear = await runCli(['check', FIXTURE, '--year', '99']);
  assert.equal(badYear.code, 1);
  assert.match(badYear.stderr, /--year must be a four digit year/);
});
