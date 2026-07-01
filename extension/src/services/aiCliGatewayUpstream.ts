export type AiCliGatewayUpstream = {
  baseUrl: string;
  apiKey: string;
  apiKind?: 'anthropic' | 'openai';
  model?: string;
  sonnetModel?: string;
  opusModel?: string;
  haikuModel?: string;
  codexApiFormat?: 'openai_responses' | 'openai_chat';
  codexModel?: string;
};

export const AI_CLI_GATEWAY_PLACEHOLDER_TOKEN = 'agentsociety-gateway';

export function normalizeUpstreamBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function isLocalGatewayBaseUrl(baseUrl: string): boolean {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  } catch {
    return false;
  }
}

export function buildLocalGatewayBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function resolveUpstreamTargetUrl(upstreamBase: string, requestPath: string): string {
  const base = normalizeUpstreamBaseUrl(upstreamBase);
  const rawPath = requestPath.startsWith('/') ? requestPath : `/${requestPath}`;
  const path = rawPath.startsWith('/claude/') ? rawPath.slice('/claude'.length) : rawPath;
  if (base.endsWith('/v1') && path.startsWith('/v1/')) {
    return `${base}${path.slice(3)}`;
  }
  if (base.endsWith('/v1') && path === '/v1') {
    return base;
  }
  return `${base}${path}`;
}
