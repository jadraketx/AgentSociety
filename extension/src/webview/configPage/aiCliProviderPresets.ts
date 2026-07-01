/**
 * Webview-side copy of provider presets.
 *
 * **Why a duplicate?** The webview is bundled by webpack independently of the
 * extension host. It cannot import from `src/aiCli/`. Keep in sync with the
 * source-of-truth in `src/aiCli/providerPresets.ts`.
 *
 * @see src/aiCli/providerPresets.ts
 */

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
  { id: 'volcengineOpenAi', url: 'https://ark.cn-beijing.volces.com/api/v3', apiKind: 'openai' },
  { id: 'groq', url: 'https://api.groq.com/openai/v1', apiKind: 'openai' },
  { id: 'stepfun', url: 'https://api.stepfun.com/v1', apiKind: 'openai' },
];

export const CODEX_SUGGESTED_MODELS = [
  { id: 'gpt-5.5', label: 'GPT-5.5' },
  { id: 'gpt-5.5-codex', label: 'GPT-5.5 Codex' },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'glm-5.2', label: 'GLM-5.2' },
  { id: 'glm-5.1', label: 'GLM-5.1' },
  { id: 'deepseek-chat', label: 'DeepSeek Chat (V4)' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  { id: 'deepseek-r2', label: 'DeepSeek R2' },
  { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code' },
  { id: 'kimi-for-coding', label: 'Kimi for Coding' },
  { id: 'qwen3.7-max', label: 'Qwen 3.7 Max' },
  { id: 'qwen-plus', label: 'Qwen Plus' },
  { id: 'MiniMax-M3', label: 'MiniMax M3' },
  { id: 'step-3.7-flash', label: 'Step 3.7 Flash' },
];

export function getProviderPresetsForRole(role: 'claude' | 'codex'): AiCliProviderPreset[] {
  return role === 'claude' ? CLAUDE_PROVIDER_PRESETS : CODEX_PROVIDER_PRESETS;
}
