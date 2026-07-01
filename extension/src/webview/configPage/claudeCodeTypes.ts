export type ClaudeModelOption = {
  id: string;
  label?: string;
};

export interface ClaudeCodeConfigValues {
  apiKey: string;
  baseUrl: string;
  model: string;
  sonnetModel: string;
  opusModel: string;
  haikuModel: string;
  permissionMode: string;
}

export interface ClaudeCodeCliStatus {
  installed: boolean;
  version?: string;
  error?: string;
}

export interface AiCliGatewayStatus {
  enabled: boolean;
  running: boolean;
  port?: number;
  baseUrl?: string;
  upstreamBaseUrl?: string;
  error?: string;
  routeClaude?: boolean;
  routeCodex?: boolean;
  claudeProxyAvailable?: boolean;
  codexProxyAvailable?: boolean;
}

export interface CodexRoutingStatus {
  configPath: string;
  authPath?: string;
  routed: boolean;
  directConfigured?: boolean;
  directUrl?: string;
}

export interface ProviderUsageQueryResult {
  ok: boolean;
  template?: string;
  summary?: string;
  plans?: Array<{ name: string; remaining: string; used?: string; unit?: string }>;
  error?: string;
  unsupported?: boolean;
}

export type ProviderAvailabilityResult = {
  ok: boolean;
  models: number;
  apiKind?: 'anthropic' | 'openai';
  error?: string;
};
