import type { AiCliApiKind } from './officialEndpoints';
import type { AiCliAuthMode } from './providerAuth';

export type AiCliProviderRecord = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiKind?: AiCliApiKind;
  authMode?: AiCliAuthMode;
  activeClaude: boolean;
  activeCodex: boolean;
  model?: string;
  sonnetModel?: string;
  opusModel?: string;
  haikuModel?: string;
  permissionMode?: string;
};

export const EMPTY_PROVIDER_DRAFT: Omit<AiCliProviderRecord, 'id' | 'activeClaude' | 'activeCodex'> = {
  name: '',
  baseUrl: '',
  apiKey: '',
  apiKind: 'anthropic',
  authMode: 'api',
  model: '',
  sonnetModel: '',
  opusModel: '',
  haikuModel: '',
  permissionMode: '',
};

export function isAnthropicProvider(provider: Pick<AiCliProviderRecord, 'apiKind' | 'baseUrl'>): boolean {
  return (provider.apiKind ?? 'anthropic') !== 'openai';
}

export function isProviderActiveForRole(
  provider: Pick<AiCliProviderRecord, 'activeClaude' | 'activeCodex' | 'apiKind' | 'baseUrl'>,
  role: 'claude' | 'codex'
): boolean {
  return role === 'claude' ? provider.activeClaude : provider.activeCodex;
}
