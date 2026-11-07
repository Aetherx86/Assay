#!/usr/bin/env node
// Builds the static demo page. Usage: node scripts/build-site.mjs <output directory>
// The page imports only the modules listed in tsconfig.site.json, which have no Node dependencies.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'out/site');
rmSync(join(out, 'lib'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.site.json', '--outDir', join(out, 'lib')], { stdio: 'inherit' });
for (const file of ['index.html', 'app.js', 'style.css']) cpSync(join('site', file), join(out, file));
if (existsSync('site/data')) cpSync('site/data', join(out, 'data'), { recursive: true });
const banned = /from\s+['"]node:|require\(/;
for (const file of ['checks/financial.js', 'statements/document.js']) {
  if (banned.test(readFileSync(join(out, 'lib', file), 'utf8'))) throw new Error(`${file} depends on Node and cannot run in a browser.`);
}
console.log(`Site written to ${out}`);
