import type { ClaudeCodeConfigValues } from '../webview/configPage/claudeCodeTypes';

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
    return url.toLowerCase().includes('llmapi.fiblab.net');
  }
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
    haikuModel: claudeConfig.haikuModel?.trim() || undefined,
    codexEnable1m: options?.enableCodex1m,
  };
}
