import { isOfficialOpenAiBaseUrl } from './officialEndpoints';
import type { AiCliAuthMode } from './providerAuth';

export function supportsProviderUsageQuery(
  baseUrl: string,
  options?: { authMode?: AiCliAuthMode; apiKind?: 'anthropic' | 'openai' }
): boolean {
  if (
    options?.apiKind === 'openai' &&
    options.authMode === 'subscription' &&
    isOfficialOpenAiBaseUrl(baseUrl)
  ) {
    return true;
  }
  const host = baseUrl.toLowerCase();
  return (
    host.includes('bigmodel.cn') ||
    host.includes('deepseek.com') ||
    host.includes('openrouter.ai') ||
    host.includes('siliconflow.cn')
  );
}
