export type Service = 'law' | 'patent' | 'stats' | 'archhub';

const DEFAULT_BASE = 'https://mcp.gomdori.app';

export class ServiceError extends Error {
  readonly kind: 'quota' | 'upstream' | 'network';
  constructor(kind: 'quota' | 'upstream' | 'network', message: string) {
    super(message);
    this.kind = kind;
  }
}

function endpoint(service: Service): string {
  return process.env[`ASSAY_MCP_${service.toUpperCase()}_URL`] ?? `${DEFAULT_BASE}/${service}`;
}

function credentials(service: Service): Record<string, string> {
  if (service === 'patent' && process.env.KIPRIS_API_KEY) return { 'x-api-key': process.env.KIPRIS_API_KEY };
  if (service === 'law' && process.env.LAW_OC) return { apikey: process.env.LAW_OC };
  return {};
}

export interface ToolResult {
  text: string;
  isError: boolean;
}

export function parseEnvelope(raw: string): { result?: { content?: { text?: string }[]; isError?: boolean }; error?: { message: string } } {
  const line = raw.split('\n').map((l) => l.replace(/^data:\s*/, '')).find((l) => l.startsWith('{'));
  if (!line) throw new ServiceError('upstream', 'The service returned no JSON-RPC message.');
  return JSON.parse(line);
}

/**
 * Calls one tool on a public Streamable HTTP MCP endpoint. These services are stateless, so no
 * session handshake is needed. Tool-level errors come back as results because some tools use them
 * to report a real finding, such as a citation that does not exist.
 */
export async function callTool(service: Service, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const attempt = async (): Promise<ToolResult> => {
    let response: Response;
    try {
      response = await fetch(endpoint(service), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...credentials(service) },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (error) {
      throw new ServiceError('network', `${service}/${name} did not respond (${(error as Error).name}).`);
    }
    const envelope = parseEnvelope(await response.text());
    if (response.status === 429) throw new ServiceError('quota', `${service}/${name}: ${envelope.error?.message ?? 'rate limited'}`);
    if (envelope.error) throw new ServiceError('upstream', `${service}/${name}: ${envelope.error.message}`);
    const text = (envelope.result?.content ?? []).map((c) => c.text ?? '').join('\n');
    return { text, isError: envelope.result?.isError ?? false };
  };

  const first = await attempt();
  if (!first.text.startsWith('[EXTERNAL_API_ERROR]')) return first;
  // The government APIs behind these services time out now and then. One retry is enough.
  const second = await attempt();
  if (second.text.startsWith('[EXTERNAL_API_ERROR]')) throw new ServiceError('upstream', `${service}/${name}: ${second.text.slice(0, 200)}`);
  return second;
}
