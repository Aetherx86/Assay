import { callTool, ServiceError } from '../sources/mcp.ts';
import type { Evidence, Finding, Layer, Statement, Status } from '../types.ts';

function unavailable(id: string, layer: Layer, title: string, error: unknown): Finding {
  const reason = error instanceof ServiceError && error.kind === 'quota'
    ? 'The shared quota on the public endpoint is used up. Set your own API key to run this check.'
    : `The source could not be reached: ${(error as Error).message}`;
  return { id, layer, title, status: 'unavailable', detail: reason, evidence: [] };
}

function firstCount(text: string): number | undefined {
  const match = text.match(/(?:총|전체|total)\D{0,10}([\d,]+)\s*건/i) ?? text.match(/([\d,]+)\s*건/);
  return match ? Number(match[1]!.replace(/,/g, '')) : undefined;
}

export async function patentChecks(company: string, statement: Statement | undefined): Promise<Finding[]> {
  const title = 'Registered IP under the company name';
  const evidence: Evidence = { source: 'KIPRIS, through the public korean-patent-mcp endpoint', locator: `applicant=${company}`, retrievedAt: new Date().toISOString() };
  try {
    const applied = await callTool('patent', 'search_by_applicant', { applicant: company, numOfRows: 1 });
    const held = await callTool('patent', 'search_by_rightholder', { rightHolder: company, numOfRows: 1 });
    const filings = firstCount(applied.text);
    const holdings = firstCount(held.text);
    if (filings === undefined && holdings === undefined) {
      return [{ id: 'intangible.patents', layer: 'intangible', title, status: 'unavailable', detail: 'The response had no result count that could be read.', evidence: [evidence] }];
    }
    const intangibles = statement?.current.intangibles;
    const assets = statement?.current.totalAssets;
    const material = intangibles !== undefined && assets !== undefined && intangibles / assets > 0.1;
    const empty = !filings && !holdings;
    const status: Status = empty && material ? 'watch' : 'info';
    const note = empty && material ? ' Intangibles exceed 10% of assets, yet nothing is registered under this exact name. Subsidiaries and name changes can explain that.' : '';
    return [{ id: 'intangible.patents', layer: 'intangible', title, status, detail: `${filings ?? 'unknown'} patent and utility filings, ${holdings ?? 'unknown'} currently held after transfers.${note}`, value: holdings ?? filings ?? null, evidence: [evidence] }];
  } catch (error) {
    return [unavailable('intangible.patents', 'intangible', title, error)];
  }
}

export interface ParsedRegion {
  sigungu: string;
  bdong: string;
  bun?: string;
  ji?: string;
}

export function parseRegion(text: string): ParsedRegion | undefined {
  const codes = text.match(/\b(\d{5})\s+(\d{5})\b/);
  if (!codes) return undefined;
  return { sigungu: codes[1]!, bdong: codes[2]!, bun: text.match(/bun=(\d+)/)?.[1], ji: text.match(/ji=(\d+)/)?.[1] };
}

/**
 * Confirms that a site the company names appears in the national building register. The register
 * shows what stands there and how it may be used. It does not show who owns it, because that is
 * in the land registry, which has no open API.
 */
export async function propertyCheck(site: string, company: string | undefined): Promise<Finding> {
  const id = `physical.site:${site}`;
  const title = `Building register: ${site}`;
  const evidence: Evidence = { source: 'Building HUB (MOLIT), through the public archhub-mcp endpoint', locator: site, retrievedAt: new Date().toISOString() };
  try {
    const region = parseRegion((await callTool('archhub', 'find_region', { keyword: site, limit: 3 })).text);
    if (!region?.bun) return { id, layer: 'physical', title, status: 'unavailable', detail: 'The address did not resolve to a parcel. Give it as district, neighbourhood and lot number.', evidence: [evidence] };
    const args = { sigungu_code: region.sigungu, bdong_code: region.bdong, bun: region.bun, ...(region.ji ? { ji: region.ji } : {}) };
    const profile = await callTool('archhub', 'building_profile', { ...args, max_buildings: 3 });
    const count = profile.text.match(/건축물\s*(\d+)개\s*동/)?.[1];
    const named = company ? profile.text.includes(company.replace(/\s|주식회사|\(주\)/g, '')) : false;
    const use = profile.text.match(/용도:\s*([^\n(·]+)/)?.[1]?.trim();
    const zoning = profile.text.match(/용도지역·지구:\s*([^\n]+)/)?.[1]?.trim();
    const area = profile.text.match(/연면적\s*([\d,.]+)㎡/)?.[1];
    if (!count && !use) {
      return { id, layer: 'physical', title, status: 'watch', detail: 'No registered building was found at this parcel. Vacant land and a wrong lot number both look like this.', evidence: [evidence], value: 0 };
    }
    const history = await callTool('archhub', 'parcel_history', { ...args, top: 1 });
    const events = history.text.match(/이벤트\s*([\d,]+)건/)?.[1];
    const parts = [
      `${count ?? 'At least 1'} registered building(s)`,
      use && `main use ${use}`,
      area && `largest listed floor area ${area} sqm`,
      zoning && `zoning ${zoning}`,
      events && `${events} permit and demolition events`,
    ].filter(Boolean);
    return {
      id, layer: 'physical', title, status: 'pass',
      detail: `${parts.join(', ')}. ${named ? 'The register entry carries the company name.' : 'The listed entries do not carry the company name.'} This confirms the building exists, not who owns it.`,
      value: count ? Number(count) : 1,
      evidence: [evidence],
    };
  } catch (error) {
    return unavailable(id, 'physical', title, error);
  }
}

const STATUTE = /([가-힣ㆍ·]+(?:\s[가-힣ㆍ·]+){0,8}?\s?법률?(?:\s시행령|\s시행규칙)?)\s*제\s*(\d+)\s*조(의\s*\d+)?/g;
const PARTICLE_ENDING = /(?:는|은|이|가|을|를|에|로|서|며|고|및|또는|따라|따른|의한|근거한|규정|상기|해당|현행)$/;

/** Long titles read "... 에 관한 법률" and need all their words. Others are a single word like 상법. */
function statuteName(words: string[]): string {
  const about = words.findIndex((w) => w === '관한');
  if (about < 0) return words.at(-1)!;
  let start = 0;
  while (start < about && PARTICLE_ENDING.test(words[start]!)) start++;
  return words.slice(start).join(' ');
}

/** Pulls statute citations out of filing text so they can be checked against the statute database. */
export function extractCitations(text: string, limit = 12): string[] {
  const plain = text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const seen = new Set<string>();
  for (const match of plain.matchAll(STATUTE)) {
    const words = match[1]!.split(/\s+/);
    // Keep 시행령 and 시행규칙 attached to the statute they belong to.
    const decree = /^시행(령|규칙)$/.test(words.at(-1)!) ? words.pop()! : '';
    const name = [statuteName(words), decree].filter(Boolean).join(' ');
    if (name.length < 2) continue;
    seen.add(`${name} 제${match[2]}조${match[3] ? match[3].replace(/\s/g, '') : ''}`);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

export async function legalCheck(text: string, source: Evidence): Promise<Finding> {
  const id = 'legal.citations';
  const title = 'Statutes cited in the filing exist';
  const citations = extractCitations(text);
  if (citations.length === 0) {
    return { id, layer: 'legal', title, status: 'info', detail: 'The filing text cites no statute by article number.', evidence: [source], value: 0 };
  }
  try {
    const result = await callTool('law', 'legal_analysis', { mode: 'verify_citations', text: citations.join('. '), maxCitations: citations.length });
    const counts = result.text.match(/법령 인용\s*(\d+)건\s*\|\s*✓\s*(\d+)[^|]*\|\s*✗\s*(\d+)[^|]*\|\s*⌛\s*(\d+)[^|]*\|\s*⚠\s*(\d+)/);
    if (!counts) return { id, layer: 'legal', title, status: 'unavailable', detail: 'The verifier response could not be read.', evidence: [source] };
    const [, total, valid, wrong, repealed, unsure] = counts.map(Number) as [number, number, number, number, number, number];
    const bad = result.text.split('\n').filter((l) => l.startsWith('✗') || l.startsWith('⌛')).map((l) => l.slice(2).trim()).slice(0, 5);
    const status: Status = wrong + repealed > 0 ? 'watch' : 'pass';
    const service: Evidence = { source: 'National Law Information Center, through the public korean-law-mcp endpoint', locator: 'legal_analysis verify_citations', retrievedAt: new Date().toISOString() };
    return {
      id, layer: 'legal', title, status,
      detail: `${valid} of ${total} citations exist, ${wrong} not found, ${repealed} repealed, ${unsure} uncertain.${bad.length ? ` Check: ${bad.join('; ')}. These citations were matched by pattern, so a parsing slip can cause a miss.` : ''}`,
      value: `${valid}/${total}`,
      evidence: [source, service],
    };
  } catch (error) {
    return unavailable(id, 'legal', title, error);
  }
}

export function regionFromAddress(address: string): string | undefined {
  const tokens = address.split(/\s+/);
  return tokens.slice(0, 3).reverse().find((t) => /(시|군|구)$/.test(t)) ?? tokens.find((t) => /(특별시|광역시|도)$/.test(t));
}

export async function contextCheck(region: string): Promise<Finding> {
  const id = `context.region:${region}`;
  const title = `Regional statistics: ${region}`;
  const evidence: Evidence = { source: 'KOSIS, through the public korean-stats-mcp endpoint', locator: `chain_region_brief region=${region}`, retrievedAt: new Date().toISOString() };
  try {
    const result = await callTool('stats', 'chain_region_brief', { region, format: 'speech' });
    const body = JSON.parse(result.text) as { success?: boolean; speechLine?: string; indicators?: { label: string; value: string; unit: string; period: string; success: boolean }[] };
    const indicators = (body.indicators ?? []).filter((i) => i.success).slice(0, 5);
    if (!indicators.length) return { id, layer: 'context', title, status: 'unavailable', detail: 'The service returned no indicators.', evidence: [evidence] };
    const detail = indicators.map((i) => `${i.label} ${i.value}${i.unit} (${i.period})`).join('; ');
    return { id, layer: 'context', title, status: 'info', detail, evidence: [evidence] };
  } catch (error) {
    return unavailable(id, 'context', title, error);
  }
}
