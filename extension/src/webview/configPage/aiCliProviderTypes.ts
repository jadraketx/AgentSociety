import type { AiCliApiKind } from './officialEndpoints';
import type { AiCliAuthMode } from './providerAuth';
import type { ClaudeModelOption } from './claudeCodeTypes';

export type AiCliProviderRecord = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiKind?: AiCliApiKind;
  authMode?: AiCliAuthMode;
  activeClaude: boolean;
  activeCodex: boolean;
  failoverClaude: boolean;
  failoverCodex: boolean;
  model?: string;
  sonnetModel?: string;
  opusModel?: string;
  haikuModel?: string;
  permissionMode?: string;
};

export const EMPTY_PROVIDER_DRAFT: Omit<AiCliProviderRecord, 'id' | 'activeClaude' | 'activeCodex' | 'failoverClaude' | 'failoverCodex'> = {
  name: '',
  baseUrl: '',
  apiKey: '',
  apiKind: undefined,
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

const MODEL_ROLE_PATTERNS: Record<'sonnet' | 'opus' | 'haiku', RegExp> = {
  sonnet: /sonnet/i,
  opus: /opus/i,
  haiku: /haiku/i,
};

function findModelIdByRole(models: ClaudeModelOption[], role: 'sonnet' | 'opus' | 'haiku'): string | undefined {
  const pattern = MODEL_ROLE_PATTERNS[role];
  return models.find((m) => pattern.test(m.id) || (m.label ? pattern.test(m.label) : false))?.id;
}

export type ClaudeRoleModelMapping = {
  model: string;
  sonnetModel: string;
  opusModel: string;
  haikuModel: string;
};

export function autoMapClaudeRoleModels(
  models: ClaudeModelOption[],
  current: Partial<Pick<AiCliProviderRecord, 'model' | 'sonnetModel' | 'opusModel' | 'haikuModel'>>
): ClaudeRoleModelMapping {
  const sonnet = findModelIdByRole(models, 'sonnet');
  const opus = findModelIdByRole(models, 'opus');
  const haiku = findModelIdByRole(models, 'haiku');
  const fallback = sonnet ?? opus ?? models[0]?.id ?? '';
  return {
    model: current.model?.trim() ? current.model : fallback,
    sonnetModel: current.sonnetModel?.trim() ? current.sonnetModel : (sonnet ?? ''),
    opusModel: current.opusModel?.trim() ? current.opusModel : (opus ?? ''),
    haikuModel: current.haikuModel?.trim() ? current.haikuModel : (haiku ?? ''),
  };
}
