import {
  inferApiKindFromBaseUrl,
  isOfficialAnthropicBaseUrl,
  isOfficialOpenAiBaseUrl,
  type AiCliApiKind,
} from './officialEndpoints';

export type AiCliAuthMode = 'subscription' | 'api';

export type AiCliProviderAuthFields = {
  baseUrl: string;
  apiKey: string;
  apiKind?: AiCliApiKind;
  authMode?: AiCliAuthMode;
};

export function inferProviderAuthMode(provider: AiCliProviderAuthFields): AiCliAuthMode {
  if (provider.authMode === 'subscription' || provider.authMode === 'api') {
    return provider.authMode;
  }
  if (provider.apiKey.trim()) {
    return 'api';
  }
  const kind = provider.apiKind ?? inferApiKindFromBaseUrl(provider.baseUrl);
  if (kind === 'openai' && isOfficialOpenAiBaseUrl(provider.baseUrl)) {
    return 'subscription';
  }
  if (kind !== 'openai' && isOfficialAnthropicBaseUrl(provider.baseUrl)) {
    return 'subscription';
  }
  return 'api';
}

export function isOfficialSubscriptionProvider(provider: AiCliProviderAuthFields): boolean {
  return inferProviderAuthMode(provider) === 'subscription';
}

export function providerHasConfiguredCredentials(provider: AiCliProviderAuthFields): boolean {
  if (isOfficialSubscriptionProvider(provider)) {
    return true;
  }
  return Boolean(provider.apiKey.trim());
}

export function providerHasApiUpstream(provider: AiCliProviderAuthFields): boolean {
  return inferProviderAuthMode(provider) === 'api' && Boolean(provider.apiKey.trim());
}
