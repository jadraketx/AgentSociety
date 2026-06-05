import * as React from 'react';
import { Space, Tag, Typography, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { TFunction } from 'i18next';
import type { VscodeThemePalette } from '../theme';
import type {
  AiCliGatewayStatus,
  ClaudeCodeCliStatus,
  ClaudeModelOption,
  CodexRoutingStatus,
  ProviderUsageQueryResult,
  ProviderAvailabilityResult,
} from './claudeCodeTypes';
import { AiCliProviderGroup } from './AiCliProviderGroup';
import { AiCliToolProxySection } from './AiCliToolProxySection';
import type { AiCliProviderRecord } from './aiCliProviderTypes';
import { inferApiKindFromBaseUrl } from './officialEndpoints';
import { providerHasApiUpstream } from './providerAuth';

const { Text } = Typography;

export interface ClaudeCodeConfigSectionProps {
  mode: 'claude' | 'codex';
  t: TFunction;
  palette: VscodeThemePalette;
  cliStatus: ClaudeCodeCliStatus;
  settingsPath: string;
  onReset?: () => void;
  gatewayStatus: AiCliGatewayStatus;
  gatewayToggling: boolean;
  onRouteClaudeToggle: (enabled: boolean) => void;
  onRouteCodexToggle: (enabled: boolean) => void;
  codexRouting: CodexRoutingStatus | null;
  providers: AiCliProviderRecord[];
  providersLoading: boolean;
  speedtestResults: Record<string, ProviderAvailabilityResult>;
  onSaveProvider: (provider: AiCliProviderRecord) => void;
  onAddProvider: (draft: Omit<AiCliProviderRecord, 'id' | 'activeClaude' | 'activeCodex'>) => void;
  onActivateProvider: (id: string, role: 'claude' | 'codex') => void;
  onRemoveProvider: (id: string) => void;
  onSpeedtestProvider: (baseUrl: string, apiKey: string, apiKind?: 'anthropic' | 'openai') => void;
  modelsByProvider: Record<string, ClaudeModelOption[]>;
  modelsLoadingByProvider: Record<string, boolean>;
  modelsErrorByProvider: Record<string, string | null>;
  onFetchProviderModels: (
    providerId: string,
    baseUrl: string,
    apiKey: string,
    apiKind?: 'anthropic' | 'openai'
  ) => void;
  providerUsage: Record<string, ProviderUsageQueryResult & { loading?: boolean }>;
  onQueryProviderUsage: (id: string) => void;
  onRestartCodex?: () => void;
}

export function ClaudeCodeConfigSection({
  mode,
  t,
  palette,
  cliStatus,
  settingsPath,
  onReset,
  gatewayStatus,
  gatewayToggling,
  onRouteClaudeToggle,
  onRouteCodexToggle,
  codexRouting,
  providers,
  providersLoading,
  speedtestResults,
  onSaveProvider,
  onAddProvider,
  onActivateProvider,
  onRemoveProvider,
  onSpeedtestProvider,
  modelsByProvider,
  modelsLoadingByProvider,
  modelsErrorByProvider,
  onFetchProviderModels,
  providerUsage,
  onQueryProviderUsage,
  onRestartCodex,
}: ClaudeCodeConfigSectionProps) {
  const isClaude = mode === 'claude';
  const hasAnthropicApiForGateway = providers.some(
    (p) =>
      (p.apiKind ?? inferApiKindFromBaseUrl(p.baseUrl)) === 'anthropic' &&
      providerHasApiUpstream(p)
  );
  const hasOpenAiApiForGateway = providers.some(
    (p) => p.apiKind === 'openai' && providerHasApiUpstream(p)
  );
  const claudeProxyAvailable =
    gatewayStatus.claudeProxyAvailable ?? hasAnthropicApiForGateway;
  const codexProxyAvailable = gatewayStatus.codexProxyAvailable ?? hasOpenAiApiForGateway;
  const routeClaude = gatewayStatus.routeClaude ?? false;
  const routeCodex = gatewayStatus.routeCodex ?? false;
  const gatewayBaseUrl = gatewayStatus.running ? gatewayStatus.baseUrl : undefined;

  const claudeRouteMode: 'proxy' | 'direct' | 'off' = routeClaude
    ? gatewayStatus.running && claudeProxyAvailable
      ? 'proxy'
      : 'off'
    : 'direct';
  const codexRouteMode: 'proxy' | 'direct' | 'off' = routeCodex
    ? gatewayStatus.running && codexProxyAvailable && codexRouting?.routed
      ? 'proxy'
      : 'off'
    : 'direct';

  const providerGroupProps = {
    t,
    palette,
    providers,
    loading: providersLoading,
    onSave: onSaveProvider,
    onAdd: onAddProvider,
    onActivate: onActivateProvider,
    onRemove: onRemoveProvider,
    onCheckAvailability: onSpeedtestProvider,
    availabilityResults: speedtestResults,
    providerUsage,
    onQueryProviderUsage,
    modelsByProvider,
    modelsLoadingByProvider,
    modelsErrorByProvider,
    onFetchModels: onFetchProviderModels,
    onRestartCodex,
  };

  return (
    <div style={{ paddingTop: 4 }}>
      {isClaude ? (
        <>
          <Space size={8} wrap style={{ marginBottom: 10 }}>
            {cliStatus.installed ? (
              <Tag color="success" style={{ margin: 0 }}>
                {t('claudeCodeConfig.cliDetected', { version: cliStatus.version })}
              </Tag>
            ) : (
              <Tag color="warning" style={{ margin: 0 }}>
                {t('claudeCodeConfig.cliNotInstalled')}
              </Tag>
            )}
          </Space>
          <AiCliToolProxySection
            t={t}
            palette={palette}
            tool="claude"
            proxyEnabled={routeClaude}
            proxyAvailable={claudeProxyAvailable}
            proxyToggling={gatewayToggling}
            routeMode={claudeRouteMode}
            configPath={settingsPath}
            gatewayBaseUrl={routeClaude ? gatewayBaseUrl : undefined}
            onProxyToggle={onRouteClaudeToggle}
          />
          <AiCliProviderGroup
            {...providerGroupProps}
            role="claude"
            proxyEnabled={routeClaude}
          />
          {onReset ? (
            <Button icon={<ReloadOutlined />} onClick={onReset} style={{ marginTop: 12 }}>
              {t('configPage.resetClaudeDefaults')}
            </Button>
          ) : null}
        </>
      ) : (
        <>
          <AiCliToolProxySection
            t={t}
            palette={palette}
            tool="codex"
            proxyEnabled={routeCodex}
            proxyAvailable={codexProxyAvailable}
            proxyToggling={gatewayToggling}
            routeMode={codexRouteMode}
            configPath={codexRouting?.configPath ?? '~/.codex/config.toml'}
            authPath={codexRouting?.authPath}
            gatewayBaseUrl={routeCodex ? gatewayBaseUrl : undefined}
            onProxyToggle={onRouteCodexToggle}
          />
          {onRestartCodex ? (
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={onRestartCodex}
              style={{ marginBottom: 12 }}
            >
              {t('claudeCodeConfig.restartCodex')}
            </Button>
          ) : null}
          <AiCliProviderGroup
            {...providerGroupProps}
            role="codex"
            proxyEnabled={routeCodex}
          />
        </>
      )}
    </div>
  );
}
