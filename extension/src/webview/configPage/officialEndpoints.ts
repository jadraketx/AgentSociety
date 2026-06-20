/**
 * Webview-side copy of official endpoint constants and helpers.
 *
 * **Why a duplicate?** The webview is bundled by webpack independently of the
 * extension host (tsconfig.json excludes `src/webview/**`). It cannot import
 * from `src/aiCli/` or `src/services/`. Keep this file in sync with the
 * source-of-truth in `src/aiCli/officialEndpoints.ts`.
 *
 * @see src/aiCli/officialEndpoints.ts
 */

export const OFFICIAL_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const OFFICIAL_OPENAI_BASE_URL = 'https://api.openai.com/v1';

export type AiCliApiKind = 'anthropic' | 'openai';

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

export function inferApiKindFromBaseUrl(baseUrl: string): AiCliApiKind {
  const host = baseUrl.trim().toLowerCase();
  if (
    host.includes('api.openai.com') ||
    host.includes('openai.com/v1') ||
    (host.includes('openai.com') && !host.includes('openrouter'))
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
  const normalized = normalizeBaseUrl(baseUrl);
  return (
    normalized === OFFICIAL_OPENAI_BASE_URL ||
    normalized === 'https://api.openai.com'
  );
}

export function resolveProviderBaseUrl(baseUrl: string, apiKind: AiCliApiKind): string {
  const trimmed = baseUrl.trim();
  if (trimmed) {
    return normalizeBaseUrl(trimmed);
  }
  return apiKind === 'openai' ? OFFICIAL_OPENAI_BASE_URL : OFFICIAL_ANTHROPIC_BASE_URL;
}
