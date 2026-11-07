import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { AuditReport, CreditRating, Statement } from '../types.ts';
import { extractAudit, extractRatings, extractStatement, htmlToLines } from './document.ts';

export interface ParsedDocument {
  markdown: string;
  sha256: string;
  path: string;
}

/** pdf.js warns about canvas support at import time, which text extraction does not need. */
async function loadParser(): Promise<typeof import('kordoc')> {
  const log = console.log;
  console.log = (...args: unknown[]) => {
    if (!String(args[0]).startsWith('Warning:')) log(...args);
  };
  try {
    return await import('kordoc');
  } finally {
    console.log = log;
  }
}

export async function parseDocument(path: string): Promise<ParsedDocument> {
  const bytes = await readFile(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (/\.html?$/i.test(path)) return { markdown: htmlToLines(bytes.toString('utf8')), path, sha256 };
  const { parse } = await loadParser();
  const log = console.log;
  console.log = (...args: unknown[]) => {
    if (!String(args[0]).startsWith('Warning:')) log(...args);
  };
  try {
    const result = await parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    if (!result.success) throw new Error(`Could not parse ${path}: ${result.error}`);
    return { markdown: result.markdown, path, sha256 };
  } finally {
    console.log = log;
  }
}

export async function statementFromDocument(path: string, options: { fiscalYear?: number; company?: string } = {}): Promise<{ statement: Statement; audit: AuditReport; ratings: CreditRating[]; document: ParsedDocument }> {
  const document = await parseDocument(path);
  const statement: Statement = {
    ...extractStatement(document.markdown, options),
    company: options.company,
    evidence: { source: 'Company document', locator: path, sha256: document.sha256, retrievedAt: new Date().toISOString() },
  };
  return { statement, audit: extractAudit(document.markdown), ratings: extractRatings(document.markdown), document };
}
