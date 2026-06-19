import type { AiCliApiKind } from './officialEndpoints';
import {
  OFFICIAL_ANTHROPIC_BASE_URL,
  OFFICIAL_OPENAI_BASE_URL,
} from './officialEndpoints';

export type AiCliProviderPreset = {
  id: string;
  url: string;
  apiKind: AiCliApiKind;
  official?: boolean;
};

export const CLAUDE_PROVIDER_PRESETS: AiCliProviderPreset[] = [
  { id: 'anthropic', url: OFFICIAL_ANTHROPIC_BASE_URL, apiKind: 'anthropic', official: true },
  { id: 'deepseek', url: 'https://api.deepseek.com/anthropic', apiKind: 'anthropic' },
  { id: 'volcengine', url: 'https://ark.cn-beijing.volces.com/api/plan', apiKind: 'anthropic' },
  { id: 'mimo', url: 'https://token-plan-cn.xiaomimimo.com/anthropic', apiKind: 'anthropic' },
  { id: 'bigmodel', url: 'https://open.bigmodel.cn/api/anthropic', apiKind: 'anthropic' },
  { id: 'kimi', url: 'https://api.kimi.com/coding/', apiKind: 'anthropic' },
  { id: 'minimax', url: 'https://api.minimaxi.com/anthropic', apiKind: 'anthropic' },
  { id: 'openrouter', url: 'https://openrouter.ai/api', apiKind: 'anthropic' },
];

export const CODEX_PROVIDER_PRESETS: AiCliProviderPreset[] = [
  { id: 'openai', url: OFFICIAL_OPENAI_BASE_URL, apiKind: 'openai', official: true },
  { id: 'zhipuCodex', url: 'https://open.bigmodel.cn/api/coding/paas/v4', apiKind: 'openai' },
  { id: 'bigmodelOpenAi', url: 'https://open.bigmodel.cn/api/paas/v4', apiKind: 'openai' },
  { id: 'kimiCodex', url: 'https://api.kimi.com/coding/v1', apiKind: 'openai' },
  { id: 'minimaxOpenAi', url: 'https://api.minimaxi.com/v1', apiKind: 'openai' },
  { id: 'deepseekOpenAi', url: 'https://api.deepseek.com/v1', apiKind: 'openai' },
  { id: 'siliconflow', url: 'https://api.siliconflow.cn/v1', apiKind: 'openai' },
  { id: 'bailian', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKind: 'openai' },
  { id: 'moonshotOpenAi', url: 'https://api.moonshot.cn/v1', apiKind: 'openai' },
  { id: 'openrouterOpenAi', url: 'https://openrouter.ai/api/v1', apiKind: 'openai' },
];

export const CODEX_SUGGESTED_MODELS = [
  { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
  { id: 'gpt-5', label: 'GPT-5' },
  { id: 'glm-4.7', label: 'GLM-4.7' },
  { id: 'kimi-for-coding', label: 'Kimi for Coding' },
  { id: 'deepseek-chat', label: 'DeepSeek Chat' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'gpt-4o', label: 'GPT-4o' },
];

export function getProviderPresetsForRole(role: 'claude' | 'codex'): AiCliProviderPreset[] {
  return role === 'claude' ? CLAUDE_PROVIDER_PRESETS : CODEX_PROVIDER_PRESETS;
}
