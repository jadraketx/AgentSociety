import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  AI_CLI_GATEWAY_PLACEHOLDER_TOKEN,
  buildLocalGatewayBaseUrl,
  isLocalGatewayBaseUrl,
} from './aiCliGatewayUpstream';
import { resolveProviderBaseUrl } from '../aiCli/officialEndpoints';
import {
  CODEX_ONE_M_AUTO_COMPACT_LIMIT,
  inferCodexContextWindow,
  writeCodexModelCatalog,
} from './codexModelCatalog';
import {
  CODEX_WEB_SEARCH_DISABLED_VALUE,
  shouldDisableCodexWebSearch,
} from './codexWebSearchPolicy';

export const CODEX_GATEWAY_PROVIDER_ID = 'agentsociety-gateway';
export const CODEX_DIRECT_PROVIDER_ID = 'agentsociety-codex';

export type CodexProviderPatch = {
  baseUrl: string;
  apiKey: string;
  model?: string;
  codexEnable1m?: boolean;
  codexContextWindow?: number;
  codexAutoCompactLimit?: number;
};

function resolveCodexHome(): string {
  const codexHome = process.env.CODEX_HOME?.trim();
  return codexHome || path.join(os.homedir(), '.codex');
}

export function resolveCodexConfigPath(): string {
  return path.join(resolveCodexHome(), 'config.toml');
}

export function resolveCodexAuthPath(): string {
  return path.join(resolveCodexHome(), 'auth.json');
}

function atomicWriteFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (process.platform === 'win32') {
    fs.writeFileSync(filePath, content, 'utf-8');
    return;
  }
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf-8');
  try {
    fs.chmodSync(tmpPath, 0o600);
  } catch {
    /* ignore */
  }
  fs.renameSync(tmpPath, filePath);
}

export type CodexAuthTokens = {
  access_token?: string;
  account_id?: string;
  id_token?: {
    chatgpt_account_id?: string;
  };
};

export type CodexAuthDocument = {
  OPENAI_API_KEY?: string;
  tokens?: CodexAuthTokens;
  [key: string]: unknown;
};

export function readCodexAuthDocument(): CodexAuthDocument | null {
  const authPath = resolveCodexAuthPath();
  if (!fs.existsSync(authPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(authPath, 'utf-8')) as CodexAuthDocument;
  } catch {
    return null;
  }
}

export function readCodexAuth(): Record<string, string> {
  const parsed = readCodexAuthDocument();
  if (!parsed) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') {
      out[key] = value;
    }
  }
  return out;
}

export function readCodexSubscriptionSession(): { accessToken: string; accountId?: string } | null {
  const auth = readCodexAuthDocument();
  const accessToken = auth?.tokens?.access_token?.trim();
  if (!accessToken) {
    return null;
  }
  const accountId =
    auth?.tokens?.account_id?.trim() || auth?.tokens?.id_token?.chatgpt_account_id?.trim();
  return accountId ? { accessToken, accountId } : { accessToken };
}

export function writeCodexAuth(entries: Record<string, string>): void {
  const authPath = resolveCodexAuthPath();
  const existing = readCodexAuthDocument() ?? {};
  const merged = { ...existing, ...entries };
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value === 'string' && !value.trim()) {
      delete merged[key];
    }
  }
  atomicWriteFile(authPath, `${JSON.stringify(merged, null, 2)}\n`);
}

export function readCodexConfigText(): string {
  const configPath = resolveCodexConfigPath();
  if (!fs.existsSync(configPath)) {
    return '';
  }
  return fs.readFileSync(configPath, 'utf-8');
}

export function writeCodexConfigText(text: string): void {
  atomicWriteFile(resolveCodexConfigPath(), text.endsWith('\n') ? text : `${text}\n`);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function removeProviderBlock(text: string, providerId: string): string {
  const escaped = providerId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`\\n?\\[model_providers\\.${escaped}\\][^\\n]*(?:\\n[^\\n\\[]*)*`, 'g'), '');
}

function readProviderBlock(text: string, providerId: string): string {
  const escaped = providerId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.match(new RegExp(`^\\[model_providers\\.${escaped}\\][^\\n]*(?:\\n(?!\\[)[^\\n]*)*`, 'm'))?.[0] ?? '';
}

function upsertModelProvider(text: string, providerId: string): string {
  let updated = text;
  if (updated.match(/^model_provider\s*=/m)) {
    updated = updated.replace(/^model_provider\s*=\s*"[^"]*"/m, `model_provider = "${providerId}"`);
  } else {
    updated = `model_provider = "${providerId}"\n${updated}`;
  }
  return updated;
}

function appendProviderBlock(
  text: string,
  providerId: string,
  lines: string[]
): string {
  let updated = removeProviderBlock(text, providerId).replace(/\n+$/, '');
  updated += ['', `[model_providers.${providerId}]`, ...lines, ''].join('\n');
  return updated;
}

function codexBaseUrlForProvider(baseUrl: string): string {
  const resolved = resolveProviderBaseUrl(baseUrl, 'openai');
  return resolved.endsWith('/v1') ? resolved : `${resolved}/v1`;
}

function upsertTopLevelTomlField(text: string, key: string, value: string): string {
  const pattern = new RegExp(`^${key}\\s*=.*$`, 'm');
  const line = `${key} = ${value}`;
  if (pattern.test(text)) {
    return text.replace(pattern, line);
  }
  return `${line}\n${text}`;
}

function removeTopLevelTomlField(text: string, key: string): string {
  return text.replace(new RegExp(`^${key}\\s*=.*\\n?`, 'm'), '');
}

function applyCodexCatalogAndPolicy(text: string, provider: CodexProviderPatch): string {
  const modelName = provider.model?.trim();
  if (!modelName) {
    return text;
  }
  const contextWindow =
    provider.codexContextWindow && provider.codexContextWindow > 0
      ? provider.codexContextWindow
      : inferCodexContextWindow(modelName, provider.codexEnable1m);
  const catalogPath = writeCodexModelCatalog({
    entries: [
      {
        modelId: modelName,
        displayName: modelName,
        contextWindow,
        effectiveContextPercent: provider.codexEnable1m ? 100 : undefined,
      },
    ],
  });
  let updated = upsertTopLevelTomlField(text, 'model_catalog_json', tomlString(catalogPath));
  if (provider.codexEnable1m) {
    const compactLimit =
      provider.codexAutoCompactLimit && provider.codexAutoCompactLimit > 0
        ? provider.codexAutoCompactLimit
        : CODEX_ONE_M_AUTO_COMPACT_LIMIT;
    updated = upsertTopLevelTomlField(
      updated,
      'model_auto_compact_token_limit',
      String(compactLimit)
    );
  } else {
    updated = removeTopLevelTomlField(updated, 'model_auto_compact_token_limit');
  }
  if (shouldDisableCodexWebSearch(provider.baseUrl, modelName)) {
    updated = upsertTopLevelTomlField(
      updated,
      'web_search',
      tomlString(CODEX_WEB_SEARCH_DISABLED_VALUE)
    );
  } else {
    const current = updated.match(/^web_search\s*=\s*"([^"]*)"/m)?.[1];
    if (current === CODEX_WEB_SEARCH_DISABLED_VALUE) {
      updated = removeTopLevelTomlField(updated, 'web_search');
    }
  }
  return updated;
}

export function applyCodexGatewayConfig(port: number, provider?: CodexProviderPatch): void {
  const gatewayUrl = `${buildLocalGatewayBaseUrl(port)}/v1`;
  let text = readCodexConfigText();
  text = removeProviderBlock(text, CODEX_DIRECT_PROVIDER_ID);
  text = appendProviderBlock(text, CODEX_GATEWAY_PROVIDER_ID, [
    'name = "AgentSociety Gateway"',
    `base_url = ${tomlString(gatewayUrl)}`,
    'wire_api = "responses"',
    'requires_openai_auth = true',
    `experimental_bearer_token = ${tomlString(AI_CLI_GATEWAY_PLACEHOLDER_TOKEN)}`,
  ]);
  text = upsertModelProvider(text, CODEX_GATEWAY_PROVIDER_ID);
  const modelName = provider?.model?.trim();
  if (modelName) {
    if (text.match(/^model\s*=/m)) {
      text = text.replace(/^model\s*=\s*"[^"]*"/m, `model = ${tomlString(modelName)}`);
    } else {
      text = `model = ${tomlString(modelName)}\n${text}`;
    }
    text = applyCodexCatalogAndPolicy(text, {
      baseUrl: gatewayUrl,
      apiKey: AI_CLI_GATEWAY_PLACEHOLDER_TOKEN,
      model: modelName,
      codexEnable1m: provider?.codexEnable1m,
      codexContextWindow: provider?.codexContextWindow,
      codexAutoCompactLimit: provider?.codexAutoCompactLimit,
    });
  }
  writeCodexConfigText(text);
}

export function applyCodexDirectProvider(provider: CodexProviderPatch): void {
  const baseUrl = codexBaseUrlForProvider(provider.baseUrl);
  let text = readCodexConfigText();
  text = removeProviderBlock(text, CODEX_GATEWAY_PROVIDER_ID);
  text = appendProviderBlock(text, CODEX_DIRECT_PROVIDER_ID, [
    'name = "AgentSociety Codex"',
    `base_url = ${tomlString(baseUrl)}`,
    'wire_api = "responses"',
    'requires_openai_auth = true',
    `experimental_bearer_token = ${tomlString(provider.apiKey.trim())}`,
  ]);
  text = upsertModelProvider(text, CODEX_DIRECT_PROVIDER_ID);
  if (provider.model?.trim()) {
    if (text.match(/^model\s*=/m)) {
      text = text.replace(/^model\s*=\s*"[^"]*"/m, `model = ${tomlString(provider.model.trim())}`);
    } else {
      text = `model = ${tomlString(provider.model.trim())}\n${text}`;
    }
    text = applyCodexCatalogAndPolicy(text, provider);
  }
  writeCodexConfigText(text);
}

function stripAgentsocietyCodexProviders(text: string): string {
  let updated = removeProviderBlock(text, CODEX_GATEWAY_PROVIDER_ID);
  updated = removeProviderBlock(updated, CODEX_DIRECT_PROVIDER_ID);
  const activeMatch = updated.match(/^model_provider\s*=\s*"([^"]*)"/m);
  const activeProvider = activeMatch?.[1]?.trim();
  if (
    activeProvider === CODEX_GATEWAY_PROVIDER_ID ||
    activeProvider === CODEX_DIRECT_PROVIDER_ID
  ) {
    updated = updated.replace(/^model_provider\s*=\s*"[^"]*"\n?/m, '');
  }
  return updated;
}

export function applyCodexOfficialSubscription(): void {
  let text = readCodexConfigText();
  if (text) {
    text = stripAgentsocietyCodexProviders(text);
    writeCodexConfigText(text);
  }
}

export function stripCodexGatewayConfig(): void {
  let text = readCodexConfigText();
  if (!text) {
    return;
  }
  text = removeProviderBlock(text, CODEX_GATEWAY_PROVIDER_ID);
  if (text.match(new RegExp(`^model_provider\\s*=\\s*"${CODEX_GATEWAY_PROVIDER_ID}"`, 'm'))) {
    text = text.replace(/^model_provider\s*=\s*"[^"]*"\n?/m, '');
  }
  writeCodexConfigText(text);
}

export function getCodexRoutingSnapshot(): {
  configPath: string;
  authPath: string;
  routedViaGateway: boolean;
  directConfigured: boolean;
  gatewayBaseUrl?: string;
} {
  const configPath = resolveCodexConfigPath();
  const authPath = resolveCodexAuthPath();
  const text = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : '';
  const providerMatch = text.match(/^model_provider\s*=\s*"([^"]*)"/m);
  const activeProvider = providerMatch?.[1]?.trim();
  const routedViaGateway = activeProvider === CODEX_GATEWAY_PROVIDER_ID;
  const directConfigured =
    activeProvider === CODEX_DIRECT_PROVIDER_ID ||
    text.includes(`[model_providers.${CODEX_DIRECT_PROVIDER_ID}]`);
  const gatewayBlock = readProviderBlock(text, CODEX_GATEWAY_PROVIDER_ID);
  const gatewayUrlMatch = gatewayBlock.match(/^base_url\s*=\s*"([^"]*)"/m);
  const gatewayBaseUrl = gatewayUrlMatch?.[1]?.trim();
  const gatewayTokenMatch = gatewayBlock.match(/^experimental_bearer_token\s*=\s*"([^"]*)"/m);
  const usesGatewayAuth = gatewayTokenMatch?.[1] === AI_CLI_GATEWAY_PLACEHOLDER_TOKEN;
  return {
    configPath,
    authPath,
    routedViaGateway: routedViaGateway && usesGatewayAuth,
    directConfigured,
    gatewayBaseUrl: gatewayBaseUrl && !isLocalGatewayBaseUrl(gatewayBaseUrl) ? gatewayBaseUrl : undefined,
  };
}
