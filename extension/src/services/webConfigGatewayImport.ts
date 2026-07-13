import type { ClaudeCodeConfigValues } from '../webview/configPage/claudeCodeTypes';
import type {
  ImportedModelDefaults,
  ImportedModelOptions,
} from '../webview/configPage/types';

export type WebImportGatewayProviderDraft = {
  name: string;
  baseUrl: string;
  apiKey: string;
  apiKind: 'anthropic' | 'openai';
  model?: string;
  sonnetModel?: string;
  opusModel?: string;
  fableModel?: string;
  haikuModel?: string;
  codexEnable1m?: boolean;
};

export function isFiblabLlmBase(url: string): boolean {
  try {
    return new URL(url.trim()).hostname.toLowerCase() === 'llmapi.fiblab.net';
  } catch {
    return false;
  }
}

export function formatGatewayClaudeModels(provider: {
  sonnetModel?: string;
  opusModel?: string;
  fableModel?: string;
  haikuModel?: string;
}): string {
  return [
    provider.sonnetModel,
    provider.opusModel,
    provider.fableModel,
    provider.haikuModel,
  ]
    .filter((model): model is string => Boolean(model))
    .join(' · ') || '-';
}

function pickImportedModel(options: string[], preferred?: string): string {
  return preferred?.trim() || options[0] || '';
}

function pickFableModel(options: string[], preferred?: string): string {
  return preferred?.trim() || options.find((model) => /fable/i.test(model)) || '';
}

export function resolveWebImportClaudeConfig(
  modelOptions: ImportedModelOptions,
  defaults: Partial<ImportedModelDefaults>
): Partial<ClaudeCodeConfigValues> {
  const options = [...new Set([
    ...modelOptions.claudeCode,
    ...modelOptions.openaiCompatible,
  ])];
  const model = pickImportedModel(
    options,
    defaults.claudeCode || defaults.simulation
  );
  return {
    model,
    sonnetModel: pickImportedModel(
      options,
      defaults.claudeCodeSonnet || model
    ),
    opusModel: pickImportedModel(
      options,
      defaults.claudeCodeOpus || model
    ),
    fableModel: pickFableModel(options, defaults.claudeCodeFable),
    haikuModel: pickImportedModel(
      options,
      defaults.claudeCodeHaiku || model
    ),
  };
}

export function buildGatewayProviderFromWebImport(
  apiKey: string,
  apiBase: string,
  claudeConfig: Partial<ClaudeCodeConfigValues>,
  options?: {
    enableCodex1m?: boolean;
  }
): WebImportGatewayProviderDraft | undefined {
  const key = apiKey.trim();
  const baseUrl = apiBase.trim();
  if (!key || !baseUrl) {
    return undefined;
  }

  return {
    name: isFiblabLlmBase(baseUrl) ? 'Fiblab' : 'AgentSociety Web',
    baseUrl,
    apiKey: key,
    apiKind: 'openai',
    model: claudeConfig.model?.trim() || undefined,
    sonnetModel: claudeConfig.sonnetModel?.trim() || undefined,
    opusModel: claudeConfig.opusModel?.trim() || undefined,
    fableModel: claudeConfig.fableModel?.trim() || undefined,
    haikuModel: claudeConfig.haikuModel?.trim() || undefined,
    codexEnable1m: options?.enableCodex1m,
  };
}
