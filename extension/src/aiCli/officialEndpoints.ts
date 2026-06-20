export const OFFICIAL_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const OFFICIAL_OPENAI_BASE_URL = 'https://api.openai.com/v1';

export type AiCliApiKind = 'anthropic' | 'openai';

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function inferApiKindFromBaseUrl(baseUrl: string): AiCliApiKind {
  let host: string;
  try {
    const url = new URL(baseUrl.trim());
    host = url.hostname.toLowerCase();
  } catch {
    host = baseUrl.trim().toLowerCase();
  }
  if (
    host === 'api.openai.com' ||
    host.endsWith('.api.openai.com') ||
    host === 'openai.com' ||
    host.endsWith('.openai.com')
  ) {
    return 'openai';
  }
  return 'anthropic';
}

export function isOfficialAnthropicBaseUrl(baseUrl: string): boolean {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    return true;
  }
  return (
    normalized === OFFICIAL_ANTHROPIC_BASE_URL ||
    normalized === `${OFFICIAL_ANTHROPIC_BASE_URL}/v1`
  );
}

export function isOfficialOpenAiBaseUrl(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    host = baseUrl.trim().toLowerCase();
  }
  return host === 'api.openai.com';
}

export function resolveProviderBaseUrl(baseUrl: string, apiKind: AiCliApiKind): string {
  const trimmed = baseUrl.trim();
  if (trimmed) {
    return normalizeBaseUrl(trimmed);
  }
  return apiKind === 'openai' ? OFFICIAL_OPENAI_BASE_URL : OFFICIAL_ANTHROPIC_BASE_URL;
}

export function providerUpstream(provider: {
  baseUrl: string;
  apiKey: string;
  apiKind?: AiCliApiKind;
}): {
  baseUrl: string;
  apiKey: string;
  apiKind: AiCliApiKind;
} {
  const apiKind = provider.apiKind ?? inferApiKindFromBaseUrl(provider.baseUrl);
  return {
    apiKind,
    baseUrl: resolveProviderBaseUrl(provider.baseUrl, apiKind),
    apiKey: provider.apiKey.trim(),
  };
}

export function claudeSettingsBaseUrl(resolvedAnthropicBaseUrl: string): string {
  if (isOfficialAnthropicBaseUrl(resolvedAnthropicBaseUrl)) {
    return '';
  }
  return resolvedAnthropicBaseUrl;
}
