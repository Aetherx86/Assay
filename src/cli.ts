#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { analyze, VERSION } from './analyze.ts';
import { reconcile } from './checks/reconcile.ts';
import { coverage, toHtml, toHwpx, toMarkdown } from './report.ts';
import { statementFromDocument } from './statements/file.ts';
import { summarize, type Lang } from './summary.ts';
import { runRound } from './validate.ts';

const HELP = `Assay ${VERSION}: cross-checks what a Korean listed company reports against public records.

Usage
  assay analyze <stock code or name> --year <fiscal year> [options]
  assay reconcile <file a> <file b> --year <fiscal year>
  assay validate <manifest.json> --round <n> [--set <comma separated sets, or all>] [--out dir]

Analyze options
  --doc <file>        Company document (PDF, HWP, HWPX, HTML) to reconcile against
  --site <address>    Site for the building register, as district, neighbourhood and lot (repeatable)
  --out <dir>         Output directory (default: out)
  --format <list>     Comma separated: md,json,html,hwpx (default: md,json,html)
  --no-external       Skip the patent, building, statute and statistics services
  --lang <ko|en>      Language of the summary (default: ko)

Environment
  DART_API_KEY        OpenDART key. Adds XBRL figures, insider data and search by company name
  KIPRIS_API_KEY      Sent to the public patent endpoint. It has a small shared daily quota otherwise
  LAW_OC              Sent to the public statute endpoint
  ASSAY_MCP_<SERVICE>_URL  Use your own server for LAW, PATENT, STATS or ARCHHUB

Without any key, Assay reads annual reports from KIND using the stock code.
A .env file in the working directory is read if present.
`;

function loadEnv(): void {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]!]) process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, '');
  }
}

async function main(): Promise<number> {
  loadEnv();
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      year: { type: 'string' }, doc: { type: 'string' }, site: { type: 'string', multiple: true },
      out: { type: 'string' }, format: { type: 'string' }, 'no-external': { type: 'boolean' },
      lang: { type: 'string' }, round: { type: 'string' }, set: { type: 'string' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
    },
  });
  if (values.version) {
    console.log(VERSION);
    return 0;
  }
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    console.log(HELP);
    return values.help ? 0 : 2;
  }
  const year = values.year ? Number(values.year) : undefined;

  if (command === 'analyze') {
    if (!rest[0] || !year) throw new Error('analyze needs a company and --year.');
    const report = await analyze({
      query: rest[0], fiscalYear: year, dartKey: process.env.DART_API_KEY || undefined,
      documentPath: values.doc, sites: values.site, skipExternal: values['no-external'],
    });
    const out = values.out ?? 'out';
    await mkdir(out, { recursive: true });
    const base = `${report.subject.stockCode ?? report.subject.query}-${year}`;
    const formats = (values.format ?? 'md,json,html').split(',');
    const lang: Lang = values.lang === 'en' ? 'en' : 'ko';
    if (formats.includes('md')) await writeFile(join(out, `${base}.md`), toMarkdown(report, lang));
    if (formats.includes('json')) await writeFile(join(out, `${base}.json`), JSON.stringify(report, null, 2));
    if (formats.includes('html')) await writeFile(join(out, `${base}.html`), toHtml(report));
    if (formats.includes('hwpx')) await writeFile(join(out, `${base}.hwpx`), await toHwpx(report));
    const c = coverage(report);
    console.log(`${summarize(report, lang).headline}\n`);
    console.log(`${report.subject.name ?? report.subject.query} ${year}: ${c.layersRun}/${c.layers} layers ran. ${c.counts.flag} flag, ${c.counts.watch} watch, ${c.counts.pass} pass, ${c.counts.info} info, ${c.counts.unavailable} not run.`);
    if (c.missing.length) console.log(`Not run: ${c.missing.join(', ')}.`);
    console.log(`Written to ${join(out, base)}.{${formats.join(',')}}`);
    return 0;
  }

  if (command === 'reconcile') {
    if (rest.length < 2 || !year) throw new Error('reconcile needs two files and --year.');
    const [a, b] = await Promise.all(rest.slice(0, 2).map((path) => statementFromDocument(path, { fiscalYear: year })));
    const result = reconcile(a!.statement, b!.statement);
    console.log(`Core lines: ${result.coreMatched}/${result.coreCompared} agree.`);
    if (result.missingCore.length) console.log(`Could not compare: ${result.missingCore.join(', ')}`);
    for (const m of result.mismatches) console.log(`${m.line} (${m.period}): ${m.a} against ${m.b}`);
    return result.mismatches.length ? 1 : 0;
  }

  if (command === 'validate') {
    if (!rest[0] || !values.round) throw new Error('validate needs a manifest and --round.');
    return runRound({ manifest: rest[0], round: Number(values.round), set: values.set ?? 'all', out: values.out ?? 'validation/results', dartKey: process.env.DART_API_KEY || undefined, noExternal: values['no-external'] });
  }

  console.error(`Unknown command: ${command}\n\n${HELP}`);
  return 2;
}

main().then((code) => { process.exitCode = code; }, (error: Error) => {
  console.error(`assay: ${error.message}`);
  process.exitCode = 1;
});
