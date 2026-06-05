import * as fs from 'fs';
import * as path from 'path';
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
  fetchClaudeCompatibleModels,
  fetchOpenAiCompatibleModels,
  fetchProviderModels,
} from './claudeCodeModels';
import {
  claudeSettingsBaseUrl,
  inferApiKindFromBaseUrl,
  isOfficialAnthropicBaseUrl,
  providerUpstream,
  resolveProviderBaseUrl,
  type AiCliApiKind,
} from './aiCliOfficialEndpoints';
import { inferOpenAiApiFormat } from './codexApiFormat';
import { resolveCodexChatModel } from './codexModelMapping';
import {
  type TokenUsageRecord,
  type UsageAggregation,
  aggregateUsage,
} from './gatewayUsageTracker';
import {
  type ModelPricingMap,
  type CustomPriceEntry,
  getBuiltinPricing,
} from './gatewayModelPricing';
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
  stripCodexGatewayConfig,
} from './codexSettings';
import {
  inferProviderAuthMode,
  isOfficialSubscriptionProvider,
  providerHasApiUpstream as providerHasApiKeyUpstream,
  providerHasConfiguredCredentials,
  type AiCliAuthMode,
} from '../aiCli/providerAuth';

const UPSTREAM_STATE_KEY = 'aiCliGateway.upstream';
const UPSTREAM_SECRET_KEY = 'aiCliGateway.upstream.secret';
const ENABLED_STATE_KEY = 'aiCliGateway.enabled';
const PROVIDERS_STATE_KEY = 'aiCliGateway.providers';
const PROVIDER_SECRET_PREFIX = 'aiCliGateway.provider.apiKey.';
const USAGE_STATE_KEY = 'aiCliGateway.usageRecords';
const CUSTOM_PRICING_STATE_KEY = 'aiCliGateway.customPricing';
const FAILOVER_ENABLED_STATE_KEY = 'aiCliGateway.failoverEnabled';
const ROUTE_CLAUDE_STATE_KEY = 'aiCliGateway.routeClaude';
const ROUTE_CODEX_STATE_KEY = 'aiCliGateway.routeCodex';
const MAX_USAGE_RECORDS = 10000;

export type AiCliGatewayPublicStatus = AiCliGatewayStatus & {
  enabled: boolean;
  routeClaude: boolean;
  routeCodex: boolean;
  claudeProxyAvailable: boolean;
  codexProxyAvailable: boolean;
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
  model?: string;
  sonnetModel?: string;
  opusModel?: string;
  haikuModel?: string;
  permissionMode?: string;
};

export type AiCliProviderAvailabilityResult = {
  ok: boolean;
  models: number;
  error?: string;
};

/** @deprecated use AiCliProviderAvailabilityResult */
export type AiCliProviderSpeedtestResult = AiCliProviderAvailabilityResult;

export class AiCliGatewayManager {
  private readonly gateway = new AiCliGateway();
  private outputChannel: vscode.OutputChannel;
  private logChannel: vscode.OutputChannel;
  private sessionUsage: TokenUsageRecord[] = [];
  private usagePersistTimer: NodeJS.Timeout | undefined;
  private usagePersistPromise: Promise<void> = Promise.resolve();
  private providersCache: AiCliProviderConfig[] = [];
  private storedUpstreamCache: AiCliGatewayUpstream | undefined;
  private readonly secretsReady: Promise<void>;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.outputChannel = vscode.window.createOutputChannel('AI CLI Gateway');
    this.logChannel = vscode.window.createOutputChannel('AI CLI Gateway Log');
    this.gateway.onLog((entry: GatewayLogEntry) => {
      const tokenInfo =
        entry.inputTokens !== undefined && entry.outputTokens !== undefined
          ? ` in:${entry.inputTokens} out:${entry.outputTokens}`
          : '';
      const failoverInfo = entry.failoverFrom ? ` failover:${entry.failoverFrom}` : '';
      this.logChannel.appendLine(
        `${entry.ts} ${entry.method} ${entry.path} → ${entry.status} (${entry.ms}ms)${entry.model ? ` [${entry.model}]` : ''}${tokenInfo}${failoverInfo} [${entry.upstream}]`
      );
    });
    this.gateway.onUsage((record: TokenUsageRecord) => {
      this.addUsageRecord(record);
    });
    this.gateway.onFailover((upstream, role) => {
      void this.applyFailoverUpstream(upstream, role);
    });
    this.providersCache = this.readStoredProviderMetadata();
    this.storedUpstreamCache = this.context.globalState.get<AiCliGatewayUpstream>(UPSTREAM_STATE_KEY);
    this.secretsReady = this.initializeSecretStorage();
  }

  dispose(): void {
    if (this.usagePersistTimer) {
      clearTimeout(this.usagePersistTimer);
      this.usagePersistTimer = undefined;
    }
    void this.persistUsage();
    void this.gateway.stop();
    this.outputChannel.dispose();
    this.logChannel.dispose();
  }

  getPublicStatus(): AiCliGatewayPublicStatus {
    const routeClaude = this.isRouteClaudeViaGateway();
    const routeCodex = this.isRouteCodexViaGateway();
    const claudeProxyAvailable = Boolean(this.getAnthropicProviderForGateway());
    const codexProxyAvailable = Boolean(this.getOpenAiProviderForGateway());
    return {
      ...this.gateway.getStatus(),
      enabled: routeClaude || routeCodex,
      routeClaude,
      routeCodex,
      claudeProxyAvailable,
      codexProxyAvailable,
    };
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
    return this.logChannel;
  }

  getStoredUpstream(): AiCliGatewayUpstream | undefined {
    return this.storedUpstreamCache;
  }

  private async persistUpstream(upstream: AiCliGatewayUpstream): Promise<void> {
    this.storedUpstreamCache = upstream;
    await this.context.secrets.store(UPSTREAM_SECRET_KEY, JSON.stringify(upstream));
    await this.context.globalState.update(UPSTREAM_STATE_KEY, undefined);
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

  private migrateProvider(
    raw: Partial<AiCliProviderConfig> & { id: string; active?: boolean }
  ): AiCliProviderConfig {
    const baseUrl = raw.baseUrl ?? '';
    const apiKind = raw.apiKind ?? inferApiKindFromBaseUrl(baseUrl);
    const isOpenAi = apiKind === 'openai';
    let activeClaude = raw.activeClaude;
    let activeCodex = raw.activeCodex;
    if (activeClaude === undefined && activeCodex === undefined && raw.active === true) {
      activeClaude = !isOpenAi;
      activeCodex = isOpenAi;
    }
    if (activeClaude === undefined) {
      activeClaude = false;
    }
    if (activeCodex === undefined) {
      activeCodex = false;
    }
    return this.normalizeProvider({
      id: raw.id,
      name: raw.name ?? '',
      baseUrl,
      apiKey: raw.apiKey ?? '',
      apiKind,
      authMode: raw.authMode,
      activeClaude,
      activeCodex,
      model: raw.model,
      sonnetModel: raw.sonnetModel,
      opusModel: raw.opusModel,
      haikuModel: raw.haikuModel,
      permissionMode: raw.permissionMode,
    });
  }

  private readStoredProviderMetadata(): AiCliProviderConfig[] {
    const raw = this.context.globalState.get<(AiCliProviderConfig & { active?: boolean })[]>(
      PROVIDERS_STATE_KEY
    ) ?? [];
    return raw.map((p) => this.migrateProvider(p));
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
        const legacyApiKey = provider.apiKey.trim();
        const secretApiKey = await this.context.secrets.get(this.providerSecretKey(provider.id));
        const apiKey = secretApiKey ?? legacyApiKey;
        if (legacyApiKey && secretApiKey === undefined) {
          await this.context.secrets.store(this.providerSecretKey(provider.id), legacyApiKey);
        }
        hydrated.push(this.normalizeProvider({ ...provider, apiKey }));
      }
      this.providersCache = hydrated;
      await this.context.globalState.update(
        PROVIDERS_STATE_KEY,
        hydrated.map((provider) => this.providerMetadata(provider))
      );

      const legacyUpstream = this.context.globalState.get<AiCliGatewayUpstream>(UPSTREAM_STATE_KEY);
      const secretUpstream = await this.context.secrets.get(UPSTREAM_SECRET_KEY);
      if (secretUpstream) {
        this.storedUpstreamCache = JSON.parse(secretUpstream) as AiCliGatewayUpstream;
      } else if (legacyUpstream?.baseUrl && legacyUpstream.apiKey) {
        await this.context.secrets.store(UPSTREAM_SECRET_KEY, JSON.stringify(legacyUpstream));
        this.storedUpstreamCache = legacyUpstream;
      }
      if (legacyUpstream) {
        await this.context.globalState.update(UPSTREAM_STATE_KEY, undefined);
      }
    } catch (error) {
      this.log(`Secret storage migration failed: ${error instanceof Error ? error.message : String(error)}`);
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
        this.isAnthropicProvider(p) &&
        this.providerHasApiUpstream(p)
    );
    if (active) {
      return active;
    }
    return providers.find(
      (p) => this.isAnthropicProvider(p) && this.providerHasApiUpstream(p)
    );
  }

  getOpenAiProviderForGateway(): AiCliProviderConfig | undefined {
    return this.getProviders().find(
      (p) =>
        p.activeCodex &&
        p.apiKind === 'openai' &&
        this.providerHasApiUpstream(p)
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
      codexApiFormat,
      codexModel:
        upstream.apiKind === 'openai'
          ? this.resolveCodexProviderModel(normalized)
          : undefined,
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
      haikuModel: provider.haikuModel?.trim() ?? '',
      permissionMode: provider.permissionMode?.trim() ?? '',
    };
  }

  getActiveClaudeProvider(): AiCliProviderConfig | undefined {
    return this.getProviders().find((p) => p.activeClaude && this.isAnthropicProvider(p));
  }

  getActiveCodexProvider(): AiCliProviderConfig | undefined {
    return this.getProviders().find((p) => p.activeCodex && p.apiKind === 'openai');
  }

  /** @deprecated use getActiveClaudeProvider */
  getActiveProvider(): AiCliProviderConfig | undefined {
    return this.getActiveClaudeProvider();
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

  async ensureDefaultProviderFromClaudeConfig(): Promise<AiCliProviderConfig[]> {
    await this.initialize();
    let providers = this.getProviders();
    if (providers.length > 0) {
      await this.saveProviders(providers);
      return providers;
    }
    const live = readClaudeConfig();
    if (!live.apiKey.trim() && !live.baseUrl.trim()) {
      return providers;
    }
    const official = !live.baseUrl.trim() || isOfficialAnthropicBaseUrl(live.baseUrl);
    const entry = await this.addProvider({
      name: official
        ? 'Anthropic Official'
        : live.baseUrl.trim() || 'Default',
      baseUrl: live.baseUrl.trim(),
      apiKey: live.apiKey.trim(),
      apiKind: 'anthropic',
      model: live.model,
      sonnetModel: live.sonnetModel,
      opusModel: live.opusModel,
      haikuModel: live.haikuModel,
      permissionMode: live.permissionMode,
    });
    providers = [entry];
    return providers;
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
      applyCodexGatewayConfig(
        gatewayStatus.port,
        openaiActive ? this.resolveCodexProviderModel(openaiActive) : undefined
      );
      this.log(`Codex gateway config applied on port ${gatewayStatus.port}`);
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
    apiKind: AiCliApiKind = 'anthropic'
  ): Promise<AiCliProviderAvailabilityResult> {
    const result = await fetchProviderModels(baseUrl, apiKey, apiKind);
    if (result.ok) {
      return { ok: true, models: result.models.length };
    }
    return { ok: false, models: 0, error: result.error };
  }

  /** @deprecated use checkProviderAvailability */
  async speedtestProvider(
    baseUrl: string,
    apiKey: string,
    apiKind: AiCliApiKind = 'anthropic'
  ): Promise<AiCliProviderAvailabilityResult> {
    return this.checkProviderAvailability(baseUrl, apiKey, apiKind);
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
    provider: Omit<AiCliProviderConfig, 'id' | 'activeClaude' | 'activeCodex'> &
      Partial<Pick<AiCliProviderConfig, 'activeClaude' | 'activeCodex'>>
  ): Promise<AiCliProviderConfig> {
    await this.initialize();
    const providers = this.getProviders();
    const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const kind = provider.apiKind ?? inferApiKindFromBaseUrl(provider.baseUrl);
    const isOpenAi = kind === 'openai';
    const activeClaude =
      provider.activeClaude ?? (!isOpenAi && !providers.some((p) => p.activeClaude));
    const activeCodex =
      provider.activeCodex ?? (isOpenAi && !providers.some((p) => p.activeCodex));
    const entry: AiCliProviderConfig = this.normalizeProvider({
      ...provider,
      id,
      activeClaude,
      activeCodex,
    });
    providers.push(entry);
    await this.saveProviders(providers);
    if (entry.activeClaude) {
      await this.applyActiveClaudeProvider(entry);
    } else if (entry.activeCodex) {
      await this.applyActiveCodexProvider(entry);
    }
    return entry;
  }

  async removeProvider(id: string): Promise<void> {
    await this.initialize();
    let providers = this.getProviders().filter((p) => p.id !== id);
    const anthropic = providers.filter((p) => this.isAnthropicProvider(p));
    const openai = providers.filter((p) => p.apiKind === 'openai');
    if (anthropic.length > 0 && !anthropic.some((p) => p.activeClaude)) {
      providers = providers.map((p) =>
        p.id === anthropic[0].id ? { ...p, activeClaude: true } : p
      );
    }
    if (openai.length > 0 && !openai.some((p) => p.activeCodex)) {
      providers = providers.map((p) =>
        p.id === openai[0].id ? { ...p, activeCodex: true } : p
      );
    }
    await this.saveProviders(providers);
    const activeClaude = providers.find((p) => p.activeClaude && this.isAnthropicProvider(p));
    if (activeClaude) {
      await this.applyActiveClaudeProvider(activeClaude);
    } else {
      applyClaudeOfficialSubscription();
    }
    const activeCodex = providers.find((p) => p.activeCodex && p.apiKind === 'openai');
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

  async updateProvider(id: string, patch: Partial<AiCliProviderConfig>): Promise<AiCliProviderConfig> {
    await this.initialize();
    const providers = this.getProviders();
    const index = providers.findIndex((p) => p.id === id);
    if (index < 0) {
      throw new Error('provider_not_found');
    }
    const next = this.normalizeProvider({ ...providers[index], ...patch, id });
    providers[index] = next;
    await this.saveProviders(providers);
    if (next.activeClaude) {
      await this.applyActiveClaudeProvider(next);
    } else if (next.activeCodex) {
      await this.applyActiveCodexProvider(next);
    }
    return next;
  }

  private async applyActiveClaudeProvider(provider: AiCliProviderConfig): Promise<AiCliGatewayPublicStatus> {
    const normalized = this.normalizeProvider(provider);
    if (!this.isAnthropicProvider(normalized)) {
      return this.getPublicStatus();
    }
    const enabled = this.context.globalState.get<boolean>(ENABLED_STATE_KEY, false);
    if (isOfficialSubscriptionProvider(normalized)) {
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
    const config = this.providerToClaudeConfig(normalized);
    if (enabled) {
      if (!this.gateway.getStatus().running) {
        return this.enableWithClaudeConfig(config);
      }
      await this.applyGatewayRoutes(config);
      return this.getPublicStatus();
    }
    writeClaudeConfig(config);
    const upstream = providerUpstream(normalized);
    await this.persistUpstream({ baseUrl: upstream.baseUrl, apiKey: upstream.apiKey });
    return this.getPublicStatus();
  }

  private async applyActiveCodexProvider(provider: AiCliProviderConfig): Promise<AiCliGatewayPublicStatus> {
    const normalized = this.normalizeProvider(provider);
    if (normalized.apiKind !== 'openai') {
      return this.getPublicStatus();
    }
    const enabled = this.context.globalState.get<boolean>(ENABLED_STATE_KEY, false);
    if (isOfficialSubscriptionProvider(normalized)) {
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
    if (!enabled) {
      applyCodexDirectProvider({
        baseUrl: normalized.baseUrl,
        apiKey: normalized.apiKey,
        model: normalized.model,
      });
      this.log(`Codex direct provider: ${normalized.baseUrl}`);
      return this.getPublicStatus();
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

  async activateProvider(id: string, role: 'claude' | 'codex'): Promise<AiCliGatewayPublicStatus> {
    await this.initialize();
    const providers = this.getProviders();
    const target = providers.find((p) => p.id === id);
    if (!target) {
      throw new Error('provider_not_found');
    }
    const kind = target.apiKind ?? inferApiKindFromBaseUrl(target.baseUrl);
    if (role === 'claude' && kind === 'openai') {
      throw new Error('provider_wrong_kind');
    }
    if (role === 'codex' && kind !== 'openai') {
      throw new Error('provider_wrong_kind');
    }
    for (const p of providers) {
      if (role === 'claude' && this.isAnthropicProvider(p)) {
        p.activeClaude = p.id === id;
      }
      if (role === 'codex' && p.apiKind === 'openai') {
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
    this.logChannel.show();
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
        void this.persistUsage();
      }, 1_000);
    }
  }

  getSessionUsage(): TokenUsageRecord[] {
    return this.sessionUsage;
  }

  getSessionAggregation(): UsageAggregation {
    return aggregateUsage(this.sessionUsage);
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
    applyCodexDirectProvider({
      baseUrl: openai.baseUrl,
      apiKey: openai.apiKey,
      model: openai.model,
    });
    this.log(`Codex direct provider: ${openai.baseUrl}`);
  }

  // ============ Custom pricing ============

  getCustomPricing(): ModelPricingMap {
    return this.context.globalState.get<ModelPricingMap>(CUSTOM_PRICING_STATE_KEY) ?? {};
  }

  async saveCustomPricing(pricing: ModelPricingMap): Promise<void> {
    await this.context.globalState.update(CUSTOM_PRICING_STATE_KEY, pricing);
  }

  async clearCustomPricing(): Promise<void> {
    await this.context.globalState.update(CUSTOM_PRICING_STATE_KEY, {});
  }

  getEffectivePricing(): ModelPricingMap {
    return { ...getBuiltinPricing(), ...this.getCustomPricing() };
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
    const anthropicProviders = providers.filter(
      (p) => this.isAnthropicProvider(p) && this.providerHasCredentials(p)
    );
    const active = anthropicProviders.find((p) => p.activeClaude) ?? anthropicProviders[0];
    const list: AiCliGatewayUpstream[] = [];
    if (active) {
      const upstream = providerUpstream(active);
      list.push({ baseUrl: upstream.baseUrl, apiKey: upstream.apiKey });
    }
    for (const p of anthropicProviders) {
      if (p.id === active?.id) {
        continue;
      }
      const upstream = providerUpstream(p);
      list.push({ baseUrl: upstream.baseUrl, apiKey: upstream.apiKey });
    }
    const stored = this.getStoredUpstream();
    if (list.length === 0 && stored?.baseUrl && stored.apiKey) {
      return [{ baseUrl: stored.baseUrl.trim(), apiKey: stored.apiKey.trim() }];
    }
    return list;
  }

  private buildCodexFailoverUpstreams(): AiCliGatewayUpstream[] {
    const providers = this.getProviders().map((p) => this.normalizeProvider(p));
    const openaiProviders = providers.filter(
      (p) => p.apiKind === 'openai' && this.providerHasApiUpstream(p)
    );
    const active = openaiProviders.find((p) => p.activeCodex) ?? openaiProviders[0];
    const list: AiCliGatewayUpstream[] = [];
    if (active) {
      list.push(this.providerToGatewayUpstream(active));
    }
    for (const p of openaiProviders) {
      if (p.id === active?.id) {
        continue;
      }
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
      if (role === 'codex' && match.apiKind === 'openai') {
        for (const p of hydrated) {
          if (p.apiKind === 'openai') {
            p.activeCodex = p.id === match.id;
          }
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
    this.outputChannel.appendLine(`${new Date().toISOString()} ${message}`);
  }
}
