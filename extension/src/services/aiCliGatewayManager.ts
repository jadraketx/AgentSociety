import * as fs from 'fs';
import * as vscode from 'vscode';
import type { ClaudeCodeConfigValues } from '../webview/configPage/claudeCodeTypes';
import {
  AI_CLI_GATEWAY_PLACEHOLDER_TOKEN,
  buildLocalGatewayBaseUrl,
  isLocalGatewayBaseUrl,
  type AiCliGatewayUpstream,
} from './aiCliGatewayUpstream';
import { AiCliGateway, type AiCliGatewayStatus, type GatewayLogEntry } from './aiCliGateway';
import {
  CLAUDE_SETTINGS_PATH,
  applyClaudeOfficialSubscription,
  readClaudeConfig,
  readClaudeSettingsFile,
  writeClaudeConfig,
} from './claudeCodeSettings';
import {
  fetchProviderModels,
} from './claudeCodeModels';
import {
  claudeSettingsBaseUrl,
  inferApiKindFromBaseUrl,
  providerUpstream,
  resolveProviderBaseUrl,
  type AiCliApiKind,
} from '../aiCli/officialEndpoints';
import { inferOpenAiApiFormat } from './codexApiFormat';
import { resolveCodexChatModel } from './codexModelMapping';
import {
  type TokenUsageRecord,
} from './gatewayUsageTracker';
import {
  type ModelPricingMap,
  getBuiltinPricing,
} from './gatewayModelPricing';
import {
  fetchRemoteGatewayPricing,
  selectObservedRemotePricing,
} from './gatewayRemotePricing';
import {
  queryProviderUsage,
  supportsProviderUsageQuery,
  type ProviderUsageResult,
} from './gatewayProviderUsage';
import {
  applyCodexDirectProvider,
  applyCodexGatewayConfig,
  applyCodexOfficialSubscription,
  getCodexRoutingSnapshot,
  getCodexOfficialLoginSnapshot,
  stripCodexGatewayConfig,
  type CodexProviderPatch,
} from './codexSettings';
import {
  DEFAULT_GATEWAY_RECTIFIER_SETTINGS,
  type GatewayRectifierSettings,
} from './gatewayRequestRectifier';
import type { OutboundProxyConfig } from './gatewayOutboundProxy';
import { buildOutboundProxyUrl } from './gatewayOutboundProxy';
import { resolveManualConfigSyncMode } from './manualConfigSync';
import {
  inferProviderAuthMode,
  isOfficialSubscriptionProvider,
  providerHasApiUpstream as providerHasApiKeyUpstream,
  providerHasConfiguredCredentials,
  type AiCliAuthMode,
} from '../aiCli/providerAuth';
import {
  appendSharedOutputLine,
  getSharedOutputChannel,
  OUTPUT_CHANNEL_GATEWAY,
} from '../shared/outputChannels';
import {
  scanClaudeSessionUsage,
  type ClaudeSessionUsageCursor,
} from './claudeSessionUsage';

const UPSTREAM_SECRET_KEY = 'aiCliGateway.upstream.secret';
const ENABLED_STATE_KEY = 'aiCliGateway.enabled';
const PROVIDERS_STATE_KEY = 'aiCliGateway.providers';
const PROVIDER_SECRET_PREFIX = 'aiCliGateway.provider.apiKey.';
const USAGE_STATE_KEY = 'aiCliGateway.usageRecords';
const CLAUDE_SESSION_CURSOR_STATE_KEY = 'aiCliGateway.claudeSessionUsageCursor';
const CUSTOM_PRICING_STATE_KEY = 'aiCliGateway.customPricing';
const REMOTE_PRICING_STATE_KEY = 'aiCliGateway.remotePricing';
const REMOTE_PRICING_FETCHED_AT_STATE_KEY = 'aiCliGateway.remotePricingFetchedAt';
const FAILOVER_ENABLED_STATE_KEY = 'aiCliGateway.failoverEnabled';
const ROUTE_CLAUDE_STATE_KEY = 'aiCliGateway.routeClaude';
const ROUTE_CODEX_STATE_KEY = 'aiCliGateway.routeCodex';
const OUTBOUND_PROXY_STATE_KEY = 'aiCliGateway.outboundProxy';
const RECTIFIER_STATE_KEY = 'aiCliGateway.rectifier';
const MAX_USAGE_RECORDS = 10000;
const REMOTE_PRICING_TTL_MS = 24 * 60 * 60 * 1000;

export type AiCliGatewayPublicStatus = AiCliGatewayStatus & {
  enabled: boolean;
  routeClaude: boolean;
  routeCodex: boolean;
  claudeProxyAvailable: boolean;
  codexProxyAvailable: boolean;
  codexOfficialLoginPresent: boolean;
  codexAuthPath?: string;
  outboundProxyUrl: string;
  rectifier: GatewayRectifierSettings;
};

export type AiCliProviderConfig = {
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
  fableModel?: string;
  haikuModel?: string;
  sonnetDisplayName?: string;
  opusDisplayName?: string;
  fableDisplayName?: string;
  haikuDisplayName?: string;
  declareSonnet1m?: boolean;
  declareOpus1m?: boolean;
  declareFable1m?: boolean;
  codexEnable1m?: boolean;
  codexContextWindow?: number;
  codexAutoCompactLimit?: number;
  permissionMode?: string;
};

export type AiCliProviderAvailabilityResult = {
  ok: boolean;
  models: number;
  apiKind?: AiCliApiKind;
  error?: string;
};

export class AiCliGatewayManager {
  private readonly gateway = new AiCliGateway();
  private outputChannel: vscode.OutputChannel;
  private sessionUsage: TokenUsageRecord[] = [];
  private usagePersistTimer: NodeJS.Timeout | undefined;
  private usageChangeListener: (() => void) | null = null;
  private usagePersistPromise: Promise<void> = Promise.resolve();
  private providersCache: AiCliProviderConfig[] = [];
  private storedUpstreamCache: AiCliGatewayUpstream | undefined;
  private readonly secretsReady: Promise<void>;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.outputChannel = getSharedOutputChannel(OUTPUT_CHANNEL_GATEWAY);
    this.gateway.onLog((entry: GatewayLogEntry) => {
      const tokenInfo =
        entry.inputTokens !== undefined && entry.outputTokens !== undefined
          ? ` in:${entry.inputTokens} out:${entry.outputTokens}`
          : '';
      const failoverInfo = entry.failoverFrom ? ` failover:${entry.failoverFrom}` : '';
      appendSharedOutputLine(
        OUTPUT_CHANNEL_GATEWAY,
        `${entry.ts} [request] ${entry.method} ${entry.path} -> ${entry.status} (${entry.ms}ms)${entry.model ? ` model=${entry.model}` : ''}${tokenInfo}${failoverInfo} upstream=${entry.upstream}`
      );
    });
    this.gateway.onUsage((record: TokenUsageRecord) => {
      this.addUsageRecord(record);
    });
    this.gateway.onFailover((upstream, role) => {
      void this.applyFailoverUpstream(upstream, role);
    });
    this.providersCache = this.readStoredProviderMetadata();
    this.secretsReady = this.initializeSecretStorage();
  }

  dispose(): void {
    if (this.usagePersistTimer) {
      clearTimeout(this.usagePersistTimer);
      this.usagePersistTimer = undefined;
    }
    void this.persistUsage();
    void this.gateway.stop();
  }

  getPublicStatus(): AiCliGatewayPublicStatus {
    const routeClaude = this.isRouteClaudeViaGateway();
    const routeCodex = this.isRouteCodexViaGateway();
    const claudeProxyAvailable = Boolean(this.getAnthropicProviderForGateway());
    const codexProxyAvailable = Boolean(this.getOpenAiProviderForGateway());
    this.syncGatewayEnhancements();
    const login = getCodexOfficialLoginSnapshot();
    return {
      ...this.gateway.getStatus(),
      enabled: routeClaude || routeCodex,
      routeClaude,
      routeCodex,
      claudeProxyAvailable,
      codexProxyAvailable,
      codexOfficialLoginPresent: login.present,
      codexAuthPath: login.authPath,
      outboundProxyUrl: this.getOutboundProxy()?.url ?? '',
      rectifier: this.getRectifierSettings(),
    };
  }

  getOutboundProxy(): OutboundProxyConfig | null {
    const stored = this.context.globalState.get<OutboundProxyConfig>(OUTBOUND_PROXY_STATE_KEY);
    if (!stored?.url?.trim()) {
      return null;
    }
    return {
      url: stored.url.trim(),
      username: stored.username?.trim() || undefined,
      password: stored.password?.trim() || undefined,
    };
  }

  async setOutboundProxy(proxy: OutboundProxyConfig | null): Promise<AiCliGatewayPublicStatus> {
    await this.initialize();
    if (!proxy?.url.trim()) {
      await this.context.globalState.update(OUTBOUND_PROXY_STATE_KEY, undefined);
    } else {
      await this.context.globalState.update(OUTBOUND_PROXY_STATE_KEY, {
        url: proxy.url.trim(),
        username: proxy.username?.trim() || undefined,
        password: proxy.password?.trim() || undefined,
      });
    }
    this.syncGatewayEnhancements();
    return this.getPublicStatus();
  }

  getRectifierSettings(): GatewayRectifierSettings {
    const stored = this.context.globalState.get<Partial<GatewayRectifierSettings>>(RECTIFIER_STATE_KEY);
    return { ...DEFAULT_GATEWAY_RECTIFIER_SETTINGS, ...(stored ?? {}) };
  }

  async setRectifierSettings(
    patch: Partial<GatewayRectifierSettings>
  ): Promise<AiCliGatewayPublicStatus> {
    await this.initialize();
    const next = { ...this.getRectifierSettings(), ...patch };
    await this.context.globalState.update(RECTIFIER_STATE_KEY, next);
    this.syncGatewayEnhancements();
    return this.getPublicStatus();
  }

  private syncGatewayEnhancements(): void {
    this.gateway.configureOutboundProxy(this.getOutboundProxy());
    this.gateway.configureRectifier(this.getRectifierSettings());
  }

  /** Shell exports so Codex CLI itself (including login) can reach OpenAI via the outbound proxy. */
  buildOutboundProxyEnvExports(): string {
    const proxy = this.getOutboundProxy();
    const url = proxy ? buildOutboundProxyUrl(proxy) : null;
    if (!url) {
      return '';
    }
    const quoted = JSON.stringify(url);
    return `export HTTP_PROXY=${quoted} HTTPS_PROXY=${quoted} ALL_PROXY=${quoted} http_proxy=${quoted} https_proxy=${quoted} all_proxy=${quoted}`;
  }

  /**
   * Apply live Codex projection to config.toml / model catalog only.
   * Never overwrite auth.json so ChatGPT OAuth (mobile remote / plugins) stays intact.
   */
  private projectCodexProviderLive(provider: AiCliProviderConfig, gatewayPort?: number): void {
    const patch = this.providerToCodexPatch(provider);
    if (typeof gatewayPort === 'number' && gatewayPort > 0) {
      applyCodexGatewayConfig(gatewayPort, patch);
    } else {
      applyCodexDirectProvider(patch);
    }
  }

  isRouteClaudeViaGateway(): boolean {
    return this.context.globalState.get<boolean>(ROUTE_CLAUDE_STATE_KEY, false);
  }

  isRouteCodexViaGateway(): boolean {
    return this.context.globalState.get<boolean>(ROUTE_CODEX_STATE_KEY, false);
  }

  isClaudeRoutedViaGateway(): boolean {
    if (!this.isRouteClaudeViaGateway()) {
      return false;
    }
    return isLocalGatewayBaseUrl(readClaudeConfig().baseUrl);
  }

  async setGatewayRoute(target: 'claude' | 'codex', enabled: boolean): Promise<AiCliGatewayPublicStatus> {
    await this.initialize();
    if (enabled) {
      const available =
        target === 'claude'
          ? Boolean(this.getAnthropicProviderForGateway())
          : Boolean(this.getOpenAiProviderForGateway());
      if (!available) {
        throw new Error('route_requires_api');
      }
    }
    await this.context.globalState.update(
      target === 'claude' ? ROUTE_CLAUDE_STATE_KEY : ROUTE_CODEX_STATE_KEY,
      enabled
    );

    if (!this.isRouteClaudeViaGateway() && !this.isRouteCodexViaGateway()) {
      const activeAnthropic = this.getActiveAnthropicProvider();
      const config = activeAnthropic
        ? this.providerToClaudeConfig(activeAnthropic)
        : readClaudeConfig();
      return this.disableAndRestoreDirect(config);
    }

    const anthropic = this.getAnthropicProviderForGateway();
    const config = anthropic
      ? this.providerToClaudeConfig(anthropic)
      : readClaudeConfig();
    if (!this.gateway.getStatus().running) {
      return this.enableWithClaudeConfig(config);
    }
    await this.applyGatewayRoutes(config);
    await this.persistEnabled(true);
    return this.getPublicStatus();
  }

  getLogChannel(): vscode.OutputChannel {
    return this.outputChannel;
  }

  getStoredUpstream(): AiCliGatewayUpstream | undefined {
    return this.storedUpstreamCache;
  }

  private async persistUpstream(upstream: AiCliGatewayUpstream): Promise<void> {
    this.storedUpstreamCache = upstream;
    await this.context.secrets.store(UPSTREAM_SECRET_KEY, JSON.stringify(upstream));
  }

  private async persistEnabled(enabled: boolean): Promise<void> {
    await this.context.globalState.update(ENABLED_STATE_KEY, enabled);
  }

  resolveUpstreamFromClaudeForm(config: ClaudeCodeConfigValues): AiCliGatewayUpstream {
    const apiKey = config.apiKey.trim();
    let baseUrl = config.baseUrl.trim();
    if (isLocalGatewayBaseUrl(baseUrl)) {
      const stored = this.getStoredUpstream();
      if (stored?.baseUrl && stored.apiKey) {
        return stored;
      }
    }
    if (!baseUrl && apiKey) {
      baseUrl = resolveProviderBaseUrl('', 'anthropic');
    }
    return { baseUrl, apiKey };
  }

  private normalizeProvider(provider: AiCliProviderConfig): AiCliProviderConfig {
    const apiKind = provider.apiKind ?? inferApiKindFromBaseUrl(provider.baseUrl);
    const authMode = inferProviderAuthMode({ ...provider, apiKind });
    return { ...provider, apiKind, authMode };
  }

  private readStoredProviderMetadata(): AiCliProviderConfig[] {
    const raw = this.context.globalState.get<AiCliProviderConfig[]>(PROVIDERS_STATE_KEY) ?? [];
    return raw.map((provider) => this.normalizeProvider(provider));
  }

  private providerSecretKey(id: string): string {
    return `${PROVIDER_SECRET_PREFIX}${id}`;
  }

  private providerMetadata(provider: AiCliProviderConfig): AiCliProviderConfig {
    return { ...provider, apiKey: '' };
  }

  private async initializeSecretStorage(): Promise<void> {
    try {
      const storedProviders = this.readStoredProviderMetadata();
      const hydrated: AiCliProviderConfig[] = [];
      for (const provider of storedProviders) {
        const secretApiKey = await this.context.secrets.get(this.providerSecretKey(provider.id));
        hydrated.push(this.normalizeProvider({ ...provider, apiKey: secretApiKey ?? '' }));
      }
      this.providersCache = hydrated;
      await this.context.globalState.update(
        PROVIDERS_STATE_KEY,
        hydrated.map((provider) => this.providerMetadata(provider))
      );

      const secretUpstream = await this.context.secrets.get(UPSTREAM_SECRET_KEY);
      if (secretUpstream) {
        this.storedUpstreamCache = JSON.parse(secretUpstream) as AiCliGatewayUpstream;
      }
    } catch (error) {
      this.log(`Secret storage initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async initialize(): Promise<void> {
    await this.secretsReady;
  }

  private isAnthropicProvider(provider: AiCliProviderConfig): boolean {
    return (provider.apiKind ?? 'anthropic') !== 'openai';
  }

  providerHasCredentials(provider: AiCliProviderConfig): boolean {
    return providerHasConfiguredCredentials(provider);
  }

  providerHasApiUpstream(provider: AiCliProviderConfig): boolean {
    return providerHasApiKeyUpstream(provider);
  }

  getAnthropicProviderForGateway(): AiCliProviderConfig | undefined {
    const providers = this.getProviders();
    const active = providers.find(
      (p) =>
        p.activeClaude &&
        this.providerHasApiUpstream(p)
    );
    if (active) {
      return active;
    }
    return providers.find(
      (p) => this.providerHasApiUpstream(p)
    );
  }

  getOpenAiProviderForGateway(): AiCliProviderConfig | undefined {
    return this.getProviders().find(
      (p) =>
        p.activeCodex &&
        this.providerHasApiUpstream(p) &&
        Boolean(this.resolveCodexProviderModel(p))
    );
  }

  private resolveCodexProviderModel(provider: AiCliProviderConfig): string | undefined {
    const normalized = this.normalizeProvider(provider);
    const upstream = providerUpstream(normalized);
    const resolved = resolveCodexChatModel(normalized.model, {
      baseUrl: upstream.baseUrl,
      codexModel: normalized.model,
      codexApiFormat: inferOpenAiApiFormat(upstream.baseUrl),
    });
    return resolved.trim() || undefined;
  }

  private providerToGatewayUpstream(provider: AiCliProviderConfig): AiCliGatewayUpstream {
    const normalized = this.normalizeProvider(provider);
    const upstream = providerUpstream(normalized);
    const codexApiFormat =
      upstream.apiKind === 'openai' ? inferOpenAiApiFormat(upstream.baseUrl) : undefined;
    return {
      baseUrl: upstream.baseUrl,
      apiKey: upstream.apiKey,
      providerName: normalized.name.trim() || undefined,
      apiKind: upstream.apiKind,
      model: normalized.model,
      sonnetModel: normalized.sonnetModel,
      opusModel: normalized.opusModel,
      fableModel: normalized.fableModel,
      haikuModel: normalized.haikuModel,
      sonnetDisplayName: normalized.sonnetDisplayName,
      opusDisplayName: normalized.opusDisplayName,
      fableDisplayName: normalized.fableDisplayName,
      haikuDisplayName: normalized.haikuDisplayName,
      declareSonnet1m: normalized.declareSonnet1m,
      declareOpus1m: normalized.declareOpus1m,
      declareFable1m: normalized.declareFable1m,
      codexApiFormat,
      codexModel:
        upstream.apiKind === 'openai'
          ? this.resolveCodexProviderModel(normalized)
          : undefined,
      codexEnable1m: normalized.codexEnable1m,
      codexContextWindow: normalized.codexContextWindow,
      codexAutoCompactLimit: normalized.codexAutoCompactLimit,
    };
  }

  private providerToCodexPatch(provider: AiCliProviderConfig): CodexProviderPatch {
    const normalized = this.normalizeProvider(provider);
    const upstream = providerUpstream(normalized);
    return {
      baseUrl: upstream.baseUrl,
      apiKey: upstream.apiKey,
      model: this.resolveCodexProviderModel(normalized),
      codexEnable1m: normalized.codexEnable1m,
      codexContextWindow: normalized.codexContextWindow,
      codexAutoCompactLimit: normalized.codexAutoCompactLimit,
    };
  }

  private getActiveAnthropicProvider(): AiCliProviderConfig | undefined {
    const providers = this.getProviders();
    return (
      providers.find((p) => p.activeClaude && this.isAnthropicProvider(p)) ??
      providers.find((p) => this.isAnthropicProvider(p) && this.providerHasCredentials(p))
    );
  }

  canEnableGateway(): boolean {
    return Boolean(this.getAnthropicProviderForGateway() || this.getOpenAiProviderForGateway());
  }

  async syncGatewayRoutesWithProviders(): Promise<Array<'claude' | 'codex'>> {
    const adjusted: Array<'claude' | 'codex'> = [];
    if (this.isRouteClaudeViaGateway() && !this.getAnthropicProviderForGateway()) {
      await this.context.globalState.update(ROUTE_CLAUDE_STATE_KEY, false);
      adjusted.push('claude');
    }
    if (this.isRouteCodexViaGateway() && !this.getOpenAiProviderForGateway()) {
      await this.context.globalState.update(ROUTE_CODEX_STATE_KEY, false);
      adjusted.push('codex');
    }
    return adjusted;
  }

  private async prepareGatewayRoutesForEnable(): Promise<Array<'claude' | 'codex'>> {
    const adjusted = await this.syncGatewayRoutesWithProviders();
    let routeClaude = this.isRouteClaudeViaGateway();
    let routeCodex = this.isRouteCodexViaGateway();
    if (!routeClaude && !routeCodex) {
      if (this.getAnthropicProviderForGateway()) {
        await this.context.globalState.update(ROUTE_CLAUDE_STATE_KEY, true);
        routeClaude = true;
        if (!adjusted.includes('claude')) {
          adjusted.push('claude');
        }
      }
      if (this.getOpenAiProviderForGateway()) {
        await this.context.globalState.update(ROUTE_CODEX_STATE_KEY, true);
        routeCodex = true;
        if (!adjusted.includes('codex')) {
          adjusted.push('codex');
        }
      }
    }
    if (!routeClaude && !routeCodex) {
      throw new Error('gateway_no_api_provider');
    }
    return adjusted;
  }

  providerToClaudeConfig(provider: AiCliProviderConfig): ClaudeCodeConfigValues {
    const normalized = this.normalizeProvider(provider);
    const upstream = providerUpstream(normalized);
    return {
      apiKey: upstream.apiKey,
      baseUrl: claudeSettingsBaseUrl(upstream.baseUrl),
      model: provider.model?.trim() ?? '',
      sonnetModel: provider.sonnetModel?.trim() ?? '',
      opusModel: provider.opusModel?.trim() ?? '',
      fableModel: provider.fableModel?.trim() ?? '',
      haikuModel: provider.haikuModel?.trim() ?? '',
      permissionMode: provider.permissionMode?.trim() ?? '',
    };
  }

  getActiveClaudeProvider(): AiCliProviderConfig | undefined {
    return this.getProviders().find((p) => p.activeClaude);
  }

  getActiveCodexProvider(): AiCliProviderConfig | undefined {
    return this.getProviders().find((p) => p.activeCodex);
  }

  claudeConfigForUi(): ClaudeCodeConfigValues {
    const active = this.getActiveClaudeProvider();
    if (active) {
      return this.providerToClaudeConfig(active);
    }
    const live = readClaudeConfig();
    if (!isLocalGatewayBaseUrl(live.baseUrl)) {
      return live;
    }
    const upstream = this.getStoredUpstream();
    if (!upstream) {
      return live;
    }
    return {
      ...live,
      baseUrl: upstream.baseUrl,
      apiKey: upstream.apiKey,
    };
  }

  private buildClaudeLiveConfig(
    port: number,
    config: ClaudeCodeConfigValues
  ): ClaudeCodeConfigValues {
    return {
      ...config,
      baseUrl: buildLocalGatewayBaseUrl(port),
      apiKey: AI_CLI_GATEWAY_PLACEHOLDER_TOKEN,
    };
  }

  private ensureGatewayDiscoveryEnv(): void {
    const settings = readClaudeSettingsFile();
    const env = { ...((settings.env as Record<string, string> | undefined) ?? {}) };
    env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = '1';
    const updated = { ...settings, env };
    const json = JSON.stringify(updated, null, 2);
    const tmpPath = CLAUDE_SETTINGS_PATH + '.tmp';
    fs.writeFileSync(tmpPath, json, 'utf-8');
    try {
      fs.chmodSync(tmpPath, 0o600);
    } catch {
      /* ignore */
    }
    fs.renameSync(tmpPath, CLAUDE_SETTINGS_PATH);
  }

  async enableWithClaudeConfig(config: ClaudeCodeConfigValues): Promise<AiCliGatewayPublicStatus> {
    await this.initialize();
    await this.prepareGatewayRoutesForEnable();
    const routeClaude = this.isRouteClaudeViaGateway();
    const routeCodex = this.isRouteCodexViaGateway();

    const anthropicProvider = this.getAnthropicProviderForGateway();
    const openaiProvider = this.getOpenAiProviderForGateway();
    if (routeClaude && !anthropicProvider) {
      throw new Error('upstream_incomplete');
    }
    if (routeCodex && !openaiProvider) {
      throw new Error('codex_upstream_incomplete');
    }

    let startUpstream: AiCliGatewayUpstream;
    if (routeClaude && anthropicProvider) {
      startUpstream = this.providerToGatewayUpstream(anthropicProvider);
    } else if (routeCodex && openaiProvider) {
      startUpstream = this.providerToGatewayUpstream(openaiProvider);
    } else {
      throw new Error('upstream_incomplete');
    }

    await this.persistUpstream(startUpstream);
    const status = await this.gateway.start(startUpstream);
    if (!status.running || !status.port) {
      throw new Error('gateway_start_failed');
    }
    if (routeCodex && openaiProvider) {
      this.gateway.setOpenaiUpstream(this.providerToGatewayUpstream(openaiProvider));
    } else {
      this.gateway.setOpenaiUpstream(null);
    }
    if (routeClaude) {
      this.syncFailoverToGateway();
    }
    await this.applyGatewayRoutes(config);
    await this.persistEnabled(true);
    this.log(`Gateway enabled on ${status.baseUrl}`);
    return this.getPublicStatus();
  }

  private async applyGatewayRoutes(config?: ClaudeCodeConfigValues): Promise<void> {
    const routeClaude = this.isRouteClaudeViaGateway();
    const routeCodex = this.isRouteCodexViaGateway();
    const gatewayStatus = this.gateway.getStatus();
    const anthropicProvider = this.getAnthropicProviderForGateway();
    const claudeConfig =
      config ??
      (anthropicProvider ? this.providerToClaudeConfig(anthropicProvider) : readClaudeConfig());

    if (routeClaude && gatewayStatus.running && gatewayStatus.port) {
      writeClaudeConfig(this.buildClaudeLiveConfig(gatewayStatus.port, claudeConfig));
      this.ensureGatewayDiscoveryEnv();
    } else {
      const activeAnthropic = this.getActiveAnthropicProvider();
      if (activeAnthropic && isOfficialSubscriptionProvider(activeAnthropic)) {
        applyClaudeOfficialSubscription(activeAnthropic.permissionMode);
      } else if (anthropicProvider) {
        const direct = this.providerToClaudeConfig(anthropicProvider);
        writeClaudeConfig(direct);
        const upstream = providerUpstream(anthropicProvider);
        await this.persistUpstream({ baseUrl: upstream.baseUrl, apiKey: upstream.apiKey });
      }
    }

    if (routeCodex && gatewayStatus.running && gatewayStatus.port) {
      const openaiActive = this.getOpenAiProviderForGateway();
      if (openaiActive) {
        this.projectCodexProviderLive(openaiActive, gatewayStatus.port);
      } else {
        await this.context.globalState.update(ROUTE_CODEX_STATE_KEY, false);
        stripCodexGatewayConfig();
        this.log('Codex gateway route disabled: active provider has no resolvable model');
      }
      if (openaiActive) {
        this.log(`Codex gateway config applied on port ${gatewayStatus.port}`);
      }
    } else {
      stripCodexGatewayConfig();
      this.applyCodexDirectFromActiveProvider();
    }

    if (!gatewayStatus.running) {
      return;
    }
    this.syncFailoverToGateway();
  }

  async disableAndRestoreDirect(config: ClaudeCodeConfigValues): Promise<AiCliGatewayPublicStatus> {
    const upstream = this.resolveUpstreamFromClaudeForm(config);
    await this.gateway.stop();
    stripCodexGatewayConfig();
    this.applyCodexDirectFromActiveProvider();
    if (upstream.baseUrl && upstream.apiKey) {
      writeClaudeConfig({
        ...config,
        baseUrl: upstream.baseUrl,
        apiKey: upstream.apiKey,
      });
      await this.persistUpstream(upstream);
    }
    await this.persistEnabled(false);
    this.log('Gateway disabled; Claude and Codex restored to direct upstream');
    return this.getPublicStatus();
  }

  async syncUpstreamFromClaudeConfig(config: ClaudeCodeConfigValues): Promise<AiCliGatewayPublicStatus> {
    const enabled = this.context.globalState.get<boolean>(ENABLED_STATE_KEY, false);
    if (!enabled) {
      return this.getPublicStatus();
    }
    return this.enableWithClaudeConfig(config);
  }

  async restoreIfEnabled(): Promise<void> {
    await this.initialize();
    const enabled = this.context.globalState.get<boolean>(ENABLED_STATE_KEY, false);
    if (!enabled) {
      return;
    }
    const upstream = this.getStoredUpstream();
    if (!upstream?.baseUrl || !upstream.apiKey) {
      return;
    }
    const live = readClaudeConfig();
    await this.enableWithClaudeConfig({
      ...live,
      baseUrl: upstream.baseUrl,
      apiKey: upstream.apiKey,
    });
  }

  async checkProviderAvailability(
    baseUrl: string,
    apiKey: string,
    apiKind?: AiCliApiKind
  ): Promise<AiCliProviderAvailabilityResult> {
    const result = await fetchProviderModels(baseUrl, apiKey, apiKind);
    if (result.ok) {
      return { ok: true, models: result.models.length, apiKind: result.apiKind };
    }
    return { ok: false, models: 0, error: result.error };
  }

  getProviders(): AiCliProviderConfig[] {
    return this.providersCache.map((provider) => ({ ...provider }));
  }

  async saveProviders(providers: AiCliProviderConfig[]): Promise<void> {
    await this.initialize();
    const normalized = providers.map((provider) => this.normalizeProvider(provider));
    const previousIds = new Set(this.providersCache.map((provider) => provider.id));
    for (const provider of normalized) {
      const apiKey = provider.apiKey.trim();
      if (apiKey) {
        await this.context.secrets.store(this.providerSecretKey(provider.id), apiKey);
      } else {
        await this.context.secrets.delete(this.providerSecretKey(provider.id));
      }
      previousIds.delete(provider.id);
    }
    for (const removedId of previousIds) {
      await this.context.secrets.delete(this.providerSecretKey(removedId));
    }
    this.providersCache = normalized;
    await this.context.globalState.update(
      PROVIDERS_STATE_KEY,
      normalized.map((provider) => this.providerMetadata(provider))
    );
    await this.syncGatewayRoutesWithProviders();
    this.syncFailoverToGateway();
  }

  async addProvider(
    provider: Omit<AiCliProviderConfig, 'id' | 'activeClaude' | 'activeCodex' | 'failoverClaude' | 'failoverCodex'> &
      Partial<Pick<AiCliProviderConfig, 'activeClaude' | 'activeCodex' | 'failoverClaude' | 'failoverCodex'>>
  ): Promise<AiCliProviderConfig> {
    await this.initialize();
    const providers = this.getProviders();
    const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const kind = provider.apiKind ?? inferApiKindFromBaseUrl(provider.baseUrl);
    // Only activate when explicitly requested (e.g. Web import). Do not auto-pick a default vendor.
    const activeClaude = provider.activeClaude === true;
    const activeCodex = provider.activeCodex === true;
    const failoverClaude = provider.failoverClaude ?? false;
    const failoverCodex = provider.failoverCodex ?? false;
    const entry: AiCliProviderConfig = this.normalizeProvider({
      ...provider,
      id,
      activeClaude,
      activeCodex,
      failoverClaude,
      failoverCodex,
    });
    providers.push(entry);
    if (entry.activeClaude) {
      for (const p of providers) {
        p.activeClaude = p.id === entry.id;
      }
    }
    if (entry.activeCodex) {
      for (const p of providers) {
        p.activeCodex = p.id === entry.id;
      }
    }
    await this.saveProviders(providers);
    if (entry.activeClaude) {
      await this.applyActiveClaudeProvider(entry);
    }
    if (entry.activeCodex) {
      await this.applyActiveCodexProvider(entry);
    }
    return entry;
  }

  async removeProvider(id: string): Promise<void> {
    await this.initialize();
    let providers = this.getProviders().filter((p) => p.id !== id);
    const claudeProviders = providers.filter((p) => this.providerHasCredentials(p));
    const codexProviders = providers.filter((p) => this.providerHasApiUpstream(p));
    if (claudeProviders.length > 0 && !claudeProviders.some((p) => p.activeClaude)) {
      providers = providers.map((p) =>
        p.id === claudeProviders[0].id ? { ...p, activeClaude: true } : p
      );
    }
    if (codexProviders.length > 0 && !codexProviders.some((p) => p.activeCodex)) {
      providers = providers.map((p) =>
        p.id === codexProviders[0].id ? { ...p, activeCodex: true } : p
      );
    }
    await this.saveProviders(providers);
    const activeClaude = providers.find((p) => p.activeClaude);
    if (activeClaude) {
      await this.applyActiveClaudeProvider(activeClaude);
    } else {
      applyClaudeOfficialSubscription();
    }
    const activeCodex = providers.find((p) => p.activeCodex);
    if (activeCodex) {
      await this.applyActiveCodexProvider(activeCodex);
    } else {
      applyCodexOfficialSubscription();
    }
    if (!this.isRouteClaudeViaGateway() && !this.isRouteCodexViaGateway()) {
      await this.gateway.stop();
      await this.persistEnabled(false);
    } else if (this.gateway.getStatus().running) {
      await this.applyGatewayRoutes();
    }
  }

  async upsertImportedGatewayProvider(draft: {
    name: string;
    baseUrl: string;
    apiKey: string;
    apiKind?: AiCliApiKind;
    model?: string;
    sonnetModel?: string;
    opusModel?: string;
    fableModel?: string;
    haikuModel?: string;
    sonnetDisplayName?: string;
    opusDisplayName?: string;
    fableDisplayName?: string;
    haikuDisplayName?: string;
    declareSonnet1m?: boolean;
    declareOpus1m?: boolean;
    declareFable1m?: boolean;
    codexEnable1m?: boolean;
  }): Promise<AiCliProviderConfig> {
    await this.initialize();
    const providers = this.getProviders();
    const apiKind = draft.apiKind ?? inferApiKindFromBaseUrl(draft.baseUrl);
    const normalizedBaseUrl = resolveProviderBaseUrl(draft.baseUrl, apiKind);
    const existing = providers.find(
      (provider) =>
        provider.name === draft.name ||
        providerUpstream(provider).baseUrl === normalizedBaseUrl
    );
    const payload = {
      name: draft.name,
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
      apiKind,
      model: draft.model,
      sonnetModel: draft.sonnetModel,
      opusModel: draft.opusModel,
      fableModel: draft.fableModel,
      haikuModel: draft.haikuModel,
      sonnetDisplayName: draft.sonnetDisplayName,
      opusDisplayName: draft.opusDisplayName,
      fableDisplayName: draft.fableDisplayName,
      haikuDisplayName: draft.haikuDisplayName,
      declareSonnet1m: draft.declareSonnet1m,
      declareOpus1m: draft.declareOpus1m,
      declareFable1m: draft.declareFable1m,
      codexEnable1m: draft.codexEnable1m,
      activeClaude: true,
      activeCodex: true,
    };
    if (existing) {
      const apiKey = draft.apiKey.trim() || existing.apiKey.trim();
      return this.updateProvider(existing.id, { ...payload, apiKey });
    }
    return this.addProvider(payload);
  }

  async updateProvider(id: string, patch: Partial<AiCliProviderConfig>): Promise<AiCliProviderConfig> {
    await this.initialize();
    const providers = this.getProviders();
    const index = providers.findIndex((p) => p.id === id);
    if (index < 0) {
      throw new Error('provider_not_found');
    }
    const next = this.normalizeProvider({ ...providers[index], ...patch, id });
    providers[index] = next;
    if (next.activeClaude) {
      for (const p of providers) {
        p.activeClaude = p.id === id;
      }
    }
    if (next.activeCodex) {
      for (const p of providers) {
        p.activeCodex = p.id === id;
      }
    }
    await this.saveProviders(providers);
    if (next.activeClaude) {
      await this.applyActiveClaudeProvider(next);
    }
    if (next.activeCodex) {
      await this.applyActiveCodexProvider(next);
    }
    return next;
  }

  private async applyActiveClaudeProvider(provider: AiCliProviderConfig): Promise<AiCliGatewayPublicStatus> {
    const normalized = this.normalizeProvider(provider);
    const enabled = this.context.globalState.get<boolean>(ENABLED_STATE_KEY, false);
    if (this.isAnthropicProvider(normalized) && isOfficialSubscriptionProvider(normalized)) {
      if (this.isRouteClaudeViaGateway()) {
        await this.context.globalState.update(ROUTE_CLAUDE_STATE_KEY, false);
      }
      applyClaudeOfficialSubscription(normalized.permissionMode);
      this.log('Claude official subscription: cleared proxy env; run claude and /login if needed');
      if (enabled) {
        await this.reconcileGatewayAfterDirectSwitch();
      }
      return this.getPublicStatus();
    }
    if (!this.isAnthropicProvider(normalized) && !this.isRouteClaudeViaGateway()) {
      await this.context.globalState.update(ROUTE_CLAUDE_STATE_KEY, true);
    }
    const config = this.providerToClaudeConfig(normalized);
    if (!this.isAnthropicProvider(normalized) && !enabled) {
      return this.enableWithClaudeConfig(config);
    }
    if (enabled) {
      if (!this.gateway.getStatus().running) {
        return this.enableWithClaudeConfig(config);
      }
      await this.applyGatewayRoutes(config);
      return this.getPublicStatus();
    }
    writeClaudeConfig(config);
    await this.persistUpstream(this.providerToGatewayUpstream(normalized));
    return this.getPublicStatus();
  }

  private async applyActiveCodexProvider(provider: AiCliProviderConfig): Promise<AiCliGatewayPublicStatus> {
    const normalized = this.normalizeProvider(provider);
    const enabled = this.context.globalState.get<boolean>(ENABLED_STATE_KEY, false);
    if (isOfficialSubscriptionProvider(normalized)) {
      if (normalized.apiKind !== 'openai') {
        if (!this.isRouteCodexViaGateway()) {
          await this.context.globalState.update(ROUTE_CODEX_STATE_KEY, true);
        }
      } else {
        if (this.isRouteCodexViaGateway()) {
          await this.context.globalState.update(ROUTE_CODEX_STATE_KEY, false);
        }
        applyCodexOfficialSubscription();
        this.log('Codex official subscription: cleared AgentSociety proxy blocks; run codex login if needed');
        if (enabled) {
          await this.reconcileGatewayAfterDirectSwitch();
        }
        return this.getPublicStatus();
      }
    }
    if (!isOfficialSubscriptionProvider(normalized) && !this.isRouteCodexViaGateway()) {
      await this.context.globalState.update(ROUTE_CODEX_STATE_KEY, true);
    }
    if (!this.gateway.getStatus().running) {
      const anthropic = this.getAnthropicProviderForGateway();
      const config = anthropic
        ? this.providerToClaudeConfig(anthropic)
        : readClaudeConfig();
      return this.enableWithClaudeConfig(config);
    }
    await this.applyGatewayRoutes();
    return this.getPublicStatus();
  }

  private async reconcileGatewayAfterDirectSwitch(): Promise<void> {
    if (!this.isRouteClaudeViaGateway() && !this.isRouteCodexViaGateway()) {
      await this.gateway.stop();
      await this.persistEnabled(false);
      return;
    }
    if (this.gateway.getStatus().running) {
      await this.applyGatewayRoutes();
    }
  }

  async toggleFailover(id: string, role: 'claude' | 'codex'): Promise<void> {
    await this.initialize();
    const providers = this.getProviders();
    const target = providers.find((p) => p.id === id);
    if (!target) {
      throw new Error('provider_not_found');
    }
    const field = role === 'claude' ? 'failoverClaude' : 'failoverCodex';
    const providersToUpdate = providers.map((p) =>
      p.id === id ? { ...p, [field]: !p[field] } : p
    );
    await this.saveProviders(providersToUpdate);
    this.syncFailoverToGateway();
  }

  async activateProvider(id: string, role: 'claude' | 'codex'): Promise<AiCliGatewayPublicStatus> {
    await this.initialize();
    const providers = this.getProviders();
    const target = providers.find((p) => p.id === id);
    if (!target) {
      throw new Error('provider_not_found');
    }
    for (const p of providers) {
      if (role === 'claude') {
        p.activeClaude = p.id === id;
      }
      if (role === 'codex') {
        p.activeCodex = p.id === id;
      }
    }
    await this.saveProviders(providers);
    if (role === 'claude') {
      return this.applyActiveClaudeProvider(target);
    }
    return this.applyActiveCodexProvider(target);
  }

  showLogChannel(): void {
    this.outputChannel.show();
  }

  async syncClaudeConfigFiles(): Promise<AiCliGatewayPublicStatus> {
    await this.initialize();
    const routeClaude = this.isRouteClaudeViaGateway();
    const gatewayStatus = this.gateway.getStatus();
    const mode = resolveManualConfigSyncMode(
      routeClaude,
      Boolean(gatewayStatus.running && gatewayStatus.port)
    );

    if (mode === 'gateway' && gatewayStatus.port) {
      const anthropicProvider = this.getAnthropicProviderForGateway();
      if (!anthropicProvider) {
        throw new Error('no_claude_provider');
      }
      const claudeConfig = this.providerToClaudeConfig(anthropicProvider);
      writeClaudeConfig(this.buildClaudeLiveConfig(gatewayStatus.port, claudeConfig));
      this.ensureGatewayDiscoveryEnv();
    } else {
      const active = this.getActiveClaudeProvider();
      if (!active || !this.isAnthropicProvider(active)) {
        throw new Error('no_claude_provider');
      }
      if (isOfficialSubscriptionProvider(active)) {
        applyClaudeOfficialSubscription(active.permissionMode);
        return this.getPublicStatus();
      }
      writeClaudeConfig(this.providerToClaudeConfig(active));
      const upstream = providerUpstream(active);
      if (upstream.baseUrl && upstream.apiKey) {
        await this.persistUpstream({ baseUrl: upstream.baseUrl, apiKey: upstream.apiKey });
      }
    }

    this.log('Claude config files synced');
    return this.getPublicStatus();
  }

  async syncCodexConfigFiles(): Promise<AiCliGatewayPublicStatus> {
    await this.initialize();
    const routeCodex = this.isRouteCodexViaGateway();
    const gatewayStatus = this.gateway.getStatus();
    const mode = resolveManualConfigSyncMode(
      routeCodex,
      Boolean(gatewayStatus.running && gatewayStatus.port)
    );

    if (mode === 'gateway' && gatewayStatus.port) {
      const openaiActive = this.getOpenAiProviderForGateway();
      if (!openaiActive) {
        throw new Error('no_codex_provider');
      }
      this.projectCodexProviderLive(openaiActive, gatewayStatus.port);
    } else {
      stripCodexGatewayConfig();
      const active = this.getActiveCodexProvider();
      if (!active) {
        throw new Error('no_codex_provider');
      }
      if (isOfficialSubscriptionProvider(active) && active.apiKind === 'openai') {
        applyCodexOfficialSubscription();
      } else if ((active.apiKind ?? inferApiKindFromBaseUrl(active.baseUrl)) === 'openai') {
        this.projectCodexProviderLive(active);
      } else {
        throw new Error('no_codex_provider');
      }
    }

    this.log('Codex config files synced');
    return this.getPublicStatus();
  }

  setUsageChangeListener(listener: (() => void) | null): void {
    this.usageChangeListener = listener;
  }

  // ============ Usage tracking ============

  private addUsageRecord(record: TokenUsageRecord): void {
    this.sessionUsage.push(record);
    if (this.sessionUsage.length > MAX_USAGE_RECORDS) {
      this.sessionUsage = this.sessionUsage.slice(-MAX_USAGE_RECORDS);
    }
    if (!this.usagePersistTimer) {
      this.usagePersistTimer = setTimeout(() => {
        this.usagePersistTimer = undefined;
        void this.persistUsage().then(() => {
          this.usageChangeListener?.();
        });
      }, 300);
    }
  }

  async syncClaudeSessionUsage(): Promise<number> {
    await this.initialize();
    await this.persistUsage();
    const stored = await this.getPersistedUsage();
    const persisted = stored.filter((record) => record.model !== 'models-list');
    if (persisted.length !== stored.length) {
      await this.context.globalState.update(USAGE_STATE_KEY, persisted);
    }
    const cursor =
      this.context.globalState.get<ClaudeSessionUsageCursor>(
        CLAUDE_SESSION_CURSOR_STATE_KEY
      ) ?? {};
    const activeProvider = this.getActiveClaudeProvider();
    const result = await scanClaudeSessionUsage(
      cursor,
      activeProvider?.name
    );
    if (result.records.length > 0) {
      const merged = [...persisted];
      for (const record of result.records) {
        const index = merged.findIndex(
          (existing) =>
            existing.source === 'session' &&
            existing.requestId === record.requestId
        );
        if (index >= 0) {
          merged[index] = record;
        } else {
          merged.push(record);
        }
      }
      await this.context.globalState.update(
        USAGE_STATE_KEY,
        merged.slice(-MAX_USAGE_RECORDS)
      );
    }
    await this.context.globalState.update(
      CLAUDE_SESSION_CURSOR_STATE_KEY,
      result.cursor
    );
    return result.records.length;
  }

  getSessionUsage(): TokenUsageRecord[] {
    return this.sessionUsage;
  }

  clearSessionUsage(): void {
    this.sessionUsage = [];
  }

  async getPersistedUsage(): Promise<TokenUsageRecord[]> {
    return this.context.globalState.get<TokenUsageRecord[]>(USAGE_STATE_KEY) ?? [];
  }

  async persistUsage(): Promise<void> {
    if (this.sessionUsage.length === 0) {
      await this.usagePersistPromise;
      return;
    }
    const pending = this.sessionUsage;
    this.sessionUsage = [];
    this.usagePersistPromise = this.usagePersistPromise
      .then(async () => {
        const existing = await this.getPersistedUsage();
        const merged = [...existing, ...pending].slice(-MAX_USAGE_RECORDS);
        await this.context.globalState.update(USAGE_STATE_KEY, merged);
      })
      .catch(() => {
        this.sessionUsage = [...pending, ...this.sessionUsage].slice(-MAX_USAGE_RECORDS);
      });
    await this.usagePersistPromise;
  }

  async clearPersistedUsage(): Promise<void> {
    if (this.usagePersistTimer) {
      clearTimeout(this.usagePersistTimer);
      this.usagePersistTimer = undefined;
    }
    this.sessionUsage = [];
    await this.usagePersistPromise;
    await this.context.globalState.update(USAGE_STATE_KEY, []);
  }

  // ============ Codex routing status ============

  getCodexRoutingStatus(): {
    configPath: string;
    authPath: string;
    routed: boolean;
    directConfigured: boolean;
    directUrl?: string;
  } {
    const snap = getCodexRoutingSnapshot();
    return {
      configPath: snap.configPath,
      authPath: snap.authPath,
      routed: snap.routedViaGateway,
      directConfigured: snap.directConfigured,
      directUrl: snap.gatewayBaseUrl,
    };
  }

  private applyCodexDirectFromActiveProvider(): void {
    const openai = this.getOpenAiProviderForGateway();
    if (!openai) {
      const subscription = this.getProviders().find(
        (p) => p.activeCodex && p.apiKind === 'openai' && isOfficialSubscriptionProvider(p)
      );
      if (subscription) {
        applyCodexOfficialSubscription();
      }
      return;
    }
    if ((openai.apiKind ?? inferApiKindFromBaseUrl(openai.baseUrl)) !== 'openai') {
      this.log(`Codex direct provider skipped for Anthropic-compatible upstream; use gateway: ${openai.baseUrl}`);
      return;
    }
    this.projectCodexProviderLive(openai);
    this.log(`Codex direct provider: ${openai.baseUrl}`);
  }

  // ============ Custom pricing ============

  getCustomPricing(): ModelPricingMap {
    return this.context.globalState.get<ModelPricingMap>(CUSTOM_PRICING_STATE_KEY) ?? {};
  }

  getRemotePricing(): ModelPricingMap {
    return this.context.globalState.get<ModelPricingMap>(REMOTE_PRICING_STATE_KEY) ?? {};
  }

  private getObservedPricingModelIds(): string[] {
    const ids = new Set<string>();
    for (const provider of this.getProviders()) {
      for (const modelId of [
        provider.model,
        provider.sonnetModel,
        provider.opusModel,
        provider.haikuModel,
      ]) {
        if (modelId?.trim()) {
          ids.add(modelId.trim());
        }
      }
    }
    for (const record of this.sessionUsage) {
      if (record.model?.trim()) {
        ids.add(record.model.trim());
      }
    }
    const persisted = this.context.globalState.get<TokenUsageRecord[]>(USAGE_STATE_KEY) ?? [];
    for (const record of persisted) {
      if (record.model?.trim()) {
        ids.add(record.model.trim());
      }
    }
    return [...ids];
  }

  async refreshObservedRemotePricing(force = false): Promise<ModelPricingMap> {
    const fetchedAt = this.context.globalState.get<number>(REMOTE_PRICING_FETCHED_AT_STATE_KEY, 0);
    const cached = this.getRemotePricing();
    if (
      !force &&
      Object.keys(cached).length > 0 &&
      Date.now() - fetchedAt < REMOTE_PRICING_TTL_MS
    ) {
      return cached;
    }
    const observedModelIds = this.getObservedPricingModelIds();
    if (observedModelIds.length === 0) {
      return cached;
    }
    try {
      const remote = await fetchRemoteGatewayPricing();
      const selected = selectObservedRemotePricing(remote.pricing, observedModelIds);
      const next = { ...cached, ...selected };
      await this.context.globalState.update(REMOTE_PRICING_STATE_KEY, next);
      await this.context.globalState.update(REMOTE_PRICING_FETCHED_AT_STATE_KEY, Date.now());
      if (Object.keys(selected).length > 0) {
        this.log(
          `Pricing cache refreshed from ${remote.sources.join(', ') || 'remote'}: ${Object.keys(selected).length} model(s)`
        );
      }
      return next;
    } catch (error) {
      this.log(`Pricing cache refresh skipped: ${error instanceof Error ? error.message : String(error)}`);
      return cached;
    }
  }

  async saveCustomPricing(pricing: ModelPricingMap): Promise<void> {
    await this.context.globalState.update(CUSTOM_PRICING_STATE_KEY, pricing);
  }

  async clearCustomPricing(): Promise<void> {
    await this.context.globalState.update(CUSTOM_PRICING_STATE_KEY, {});
  }

  getEffectivePricing(): ModelPricingMap {
    return { ...getBuiltinPricing(), ...this.getRemotePricing(), ...this.getCustomPricing() };
  }

  // ============ Failover config ============

  isFailoverEnabled(): boolean {
    return this.context.globalState.get<boolean>(FAILOVER_ENABLED_STATE_KEY, false);
  }

  async setFailoverEnabled(enabled: boolean): Promise<void> {
    await this.context.globalState.update(FAILOVER_ENABLED_STATE_KEY, enabled);
    this.syncFailoverToGateway();
  }

  supportsProviderUsageQuery(baseUrl: string): boolean {
    return supportsProviderUsageQuery(baseUrl);
  }

  async queryProviderUsageById(providerId: string): Promise<ProviderUsageResult> {
    await this.initialize();
    const provider = this.getProviders().find((p) => p.id === providerId);
    if (!provider) {
      throw new Error('provider_not_found');
    }
    const normalized = this.normalizeProvider(provider);
    const apiKind = normalized.apiKind ?? inferApiKindFromBaseUrl(normalized.baseUrl);
    const authMode = inferProviderAuthMode({ ...normalized, apiKind });
    return queryProviderUsage(normalized.baseUrl, normalized.apiKey, { apiKind, authMode });
  }

  private buildClaudeFailoverUpstreams(): AiCliGatewayUpstream[] {
    const providers = this.getProviders().map((p) => this.normalizeProvider(p));
    const active = providers.find(
      (p) => p.activeClaude && this.providerHasApiUpstream(p)
    );
    const list: AiCliGatewayUpstream[] = [];
    if (active) {
      list.push(this.providerToGatewayUpstream(active));
    }
    // Only include providers explicitly marked for failover
    const failoverCandidates = providers.filter(
      (p) => p.failoverClaude && p.id !== active?.id && this.providerHasApiUpstream(p)
    );
    for (const p of failoverCandidates) {
      list.push(this.providerToGatewayUpstream(p));
    }
    const stored = this.getStoredUpstream();
    if (list.length === 0 && stored?.baseUrl && stored.apiKey) {
      return [{ baseUrl: stored.baseUrl.trim(), apiKey: stored.apiKey.trim() }];
    }
    return list;
  }

  private buildCodexFailoverUpstreams(): AiCliGatewayUpstream[] {
    const providers = this.getProviders().map((p) => this.normalizeProvider(p));
    const active = providers.find(
      (p) => p.activeCodex && this.providerHasApiUpstream(p)
    );
    const list: AiCliGatewayUpstream[] = [];
    if (active) {
      list.push(this.providerToGatewayUpstream(active));
    }
    // Only include providers explicitly marked for failover
    const failoverCandidates = providers.filter(
      (p) => p.failoverCodex && p.id !== active?.id && this.providerHasApiUpstream(p)
    );
    for (const p of failoverCandidates) {
      list.push(this.providerToGatewayUpstream(p));
    }
    return list;
  }

  private syncFailoverToGateway(): void {
    if (!this.gateway.getStatus().running) {
      return;
    }
    const openaiProvider = this.isRouteCodexViaGateway()
      ? this.getOpenAiProviderForGateway()
      : undefined;
    if (openaiProvider) {
      this.gateway.setOpenaiUpstream(this.providerToGatewayUpstream(openaiProvider));
    } else {
      this.gateway.setOpenaiUpstream(null);
    }
    this.gateway.configureFailover({
      anthropicUpstreams: this.isRouteClaudeViaGateway()
        ? this.buildClaudeFailoverUpstreams()
        : [],
      openaiUpstreams: this.isRouteCodexViaGateway() ? this.buildCodexFailoverUpstreams() : [],
      enabled: this.isFailoverEnabled(),
    });
  }

  private async applyFailoverUpstream(
    upstream: AiCliGatewayUpstream,
    role: 'claude' | 'codex'
  ): Promise<void> {
    await this.initialize();
    const hydrated = this.getProviders().map((p) => this.normalizeProvider(p));
    const match = hydrated.find((p) => {
      const u = providerUpstream(p);
      return (
        u.baseUrl.trim() === upstream.baseUrl.trim() && u.apiKey.trim() === upstream.apiKey.trim()
      );
    });
    if (match) {
      if (role === 'codex') {
        for (const p of hydrated) {
          p.activeCodex = p.id === match.id;
        }
        await this.saveProviders(hydrated);
      } else if (role === 'claude' && this.isAnthropicProvider(match)) {
        for (const p of hydrated) {
          if (this.isAnthropicProvider(p)) {
            p.activeClaude = p.id === match.id;
          }
        }
        await this.saveProviders(hydrated);
      }
    }
    await this.persistUpstream(upstream);
    this.log(`Failover switched ${role} upstream → ${upstream.baseUrl}`);
  }

  private log(message: string): void {
    appendSharedOutputLine(OUTPUT_CHANNEL_GATEWAY, `${new Date().toISOString()} [gateway] ${message}`);
  }
}
