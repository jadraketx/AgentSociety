import type { AiCliApiKind } from './officialEndpoints';
import {
  OFFICIAL_ANTHROPIC_BASE_URL,
  OFFICIAL_OPENAI_BASE_URL,
  isOfficialAnthropicBaseUrl,
  isOfficialOpenAiBaseUrl,
} from './officialEndpoints';

export type ClaudeModelOption = {
  id: string;
  label?: string;
};

export type AiCliProviderPreset = {
  id: string;
  url: string;
  apiKind: AiCliApiKind;
  official?: boolean;
  roles: Array<'claude' | 'codex'>;
  modelHints?: ClaudeModelOption[];
};

export const CLAUDE_PROVIDER_PRESETS: AiCliProviderPreset[] = [
  { id: 'anthropic', url: OFFICIAL_ANTHROPIC_BASE_URL, apiKind: 'anthropic', official: true, roles: ['claude'] },
  { id: 'deepseek', url: 'https://api.deepseek.com/anthropic', apiKind: 'anthropic', roles: ['claude'], modelHints: [{ id: 'deepseek-chat', label: 'DeepSeek Chat' }] },
  { id: 'volcengine', url: 'https://ark.cn-beijing.volces.com/api/plan', apiKind: 'anthropic', roles: ['claude'] },
  { id: 'mimo', url: 'https://token-plan-cn.xiaomimimo.com/anthropic', apiKind: 'anthropic', roles: ['claude'], modelHints: [{ id: 'mimo-v2.5-pro', label: 'MiMo V2.5 Pro' }] },
  { id: 'longcat', url: 'https://api.longcat.chat/anthropic', apiKind: 'anthropic', roles: ['claude'], modelHints: [{ id: 'LongCat-2.0-Preview', label: 'LongCat 2.0 Preview' }] },
  { id: 'bigmodel', url: 'https://open.bigmodel.cn/api/anthropic', apiKind: 'anthropic', roles: ['claude'], modelHints: [{ id: 'glm-5.2', label: 'GLM-5.2' }] },
  { id: 'kimi', url: 'https://api.kimi.com/coding/', apiKind: 'anthropic', roles: ['claude'], modelHints: [{ id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code' }] },
  { id: 'minimax', url: 'https://api.minimaxi.com/anthropic', apiKind: 'anthropic', roles: ['claude'], modelHints: [{ id: 'MiniMax-M3', label: 'MiniMax M3' }] },
  { id: 'openrouter', url: 'https://openrouter.ai/api', apiKind: 'anthropic', roles: ['claude'] },
];

export const CODEX_PROVIDER_PRESETS: AiCliProviderPreset[] = [
  { id: 'openai', url: OFFICIAL_OPENAI_BASE_URL, apiKind: 'openai', official: true, roles: ['codex'] },
  { id: 'mimoCodex', url: 'https://api.xiaomimimo.com/v1', apiKind: 'openai', roles: ['codex'], modelHints: [{ id: 'mimo-v2.5-pro', label: 'MiMo V2.5 Pro' }] },
  { id: 'mimoTokenPlanCodex', url: 'https://token-plan-cn.xiaomimimo.com/v1', apiKind: 'openai', roles: ['codex'], modelHints: [{ id: 'mimo-v2.5-pro', label: 'MiMo V2.5 Pro' }] },
  { id: 'longcatCodex', url: 'https://api.longcat.chat/openai/v1', apiKind: 'openai', roles: ['codex'], modelHints: [{ id: 'LongCat-2.0-Preview', label: 'LongCat 2.0 Preview' }] },
  { id: 'zhipuCodex', url: 'https://open.bigmodel.cn/api/coding/paas/v4', apiKind: 'openai', roles: ['codex'], modelHints: [{ id: 'glm-5.2', label: 'GLM-5.2' }] },
  { id: 'kimiCodex', url: 'https://api.kimi.com/coding/v1', apiKind: 'openai', roles: ['codex'], modelHints: [{ id: 'kimi-for-coding', label: 'Kimi for Coding' }] },
  { id: 'minimaxOpenAi', url: 'https://api.minimaxi.com/v1', apiKind: 'openai', roles: ['codex'], modelHints: [{ id: 'MiniMax-M3', label: 'MiniMax M3' }] },
  { id: 'deepseekOpenAi', url: 'https://api.deepseek.com/v1', apiKind: 'openai', roles: ['codex'], modelHints: [{ id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }] },
  { id: 'siliconflow', url: 'https://api.siliconflow.cn/v1', apiKind: 'openai', roles: ['codex'] },
  { id: 'bailian', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKind: 'openai', roles: ['codex'], modelHints: [{ id: 'qwen-plus', label: 'Qwen Plus' }, { id: 'qwen3-coder-plus', label: 'Qwen3 Coder Plus' }] },
  { id: 'openrouterOpenAi', url: 'https://openrouter.ai/api/v1', apiKind: 'openai', roles: ['codex'] },
  { id: 'volcengineOpenAi', url: 'https://ark.cn-beijing.volces.com/api/v3', apiKind: 'openai', roles: ['codex'] },
  { id: 'groq', url: 'https://api.groq.com/openai/v1', apiKind: 'openai', roles: ['codex'] },
  { id: 'stepfun', url: 'https://api.stepfun.com/v1', apiKind: 'openai', roles: ['codex'], modelHints: [{ id: 'step-3.7-flash', label: 'Step 3.7 Flash' }] },
];

export const OPENAI_FALLBACK_MODELS: ClaudeModelOption[] = [
  { id: 'gpt-5.5-codex', label: 'GPT-5.5 Codex' },
  { id: 'gpt-5.5', label: 'GPT-5.5' },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'glm-5.2', label: 'GLM-5.2' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  { id: 'kimi-for-coding', label: 'Kimi for Coding' },
  { id: 'qwen-plus', label: 'Qwen Plus' },
  { id: 'MiniMax-M3', label: 'MiniMax M3' },
];

export const ANTHROPIC_FALLBACK_MODELS: ClaudeModelOption[] = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  { id: 'glm-5.2', label: 'GLM-5.2' },
  { id: 'deepseek-chat', label: 'DeepSeek Chat' },
];

const ALL_PRESETS: AiCliProviderPreset[] = [...CLAUDE_PROVIDER_PRESETS, ...CODEX_PROVIDER_PRESETS];

export function getProviderPresetsForRole(role: 'claude' | 'codex'): AiCliProviderPreset[] {
  return role === 'claude' ? CLAUDE_PROVIDER_PRESETS : CODEX_PROVIDER_PRESETS;
}

export function findPresetByUrl(baseUrl: string): AiCliProviderPreset | undefined {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  return ALL_PRESETS.find((preset) => preset.url.replace(/\/+$/, '') === normalized);
}

export function findPresetById(id: string): AiCliProviderPreset | undefined {
  return ALL_PRESETS.find((preset) => preset.id === id);
}

export function mergeModelOptions(
  fetched: ClaudeModelOption[],
  baseUrl: string,
  apiKind: AiCliApiKind
): ClaudeModelOption[] {
  const preset = findPresetByUrl(baseUrl);
  const hints = preset?.modelHints ?? [];
  const useGenericFallback =
    isOfficialOpenAiBaseUrl(baseUrl) || isOfficialAnthropicBaseUrl(baseUrl);
  const fallback = useGenericFallback
    ? apiKind === 'openai'
      ? OPENAI_FALLBACK_MODELS
      : ANTHROPIC_FALLBACK_MODELS
    : [];
  const seen = new Set<string>();
  const merged: ClaudeModelOption[] = [];
  for (const source of [...fetched, ...hints, ...fallback]) {
    const id = source.id.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    merged.push(source);
  }
  return merged;
}

/** @deprecated Use mergeModelOptions + OPENAI_FALLBACK_MODELS */
export const CODEX_SUGGESTED_MODELS = OPENAI_FALLBACK_MODELS;
