import * as React from 'react';
import { Space, Tag, Button } from 'antd';
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
import { providerHasApiUpstream } from './providerAuth';

export type ProviderSectionCommonProps = {
  t: TFunction;
  palette: VscodeThemePalette;
  cliStatus: ClaudeCodeCliStatus;
  settingsPath: string;
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
};

export interface ClaudeCodeConfigSectionProps extends ProviderSectionCommonProps {
  mode: 'claude' | 'codex';
  onReset?: () => void;
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
  const routeEnabled = isClaude
    ? (gatewayStatus.routeClaude ?? false)
    : (gatewayStatus.routeCodex ?? false);
  const hasUpstreamForRole = isClaude
    ? providers.some((p) => providerHasApiUpstream(p))
    : providers.some((p) => p.apiKind === 'openai' && providerHasApiUpstream(p));
  const proxyAvailable = isClaude
    ? (gatewayStatus.claudeProxyAvailable ?? hasUpstreamForRole)
    : (gatewayStatus.codexProxyAvailable ?? hasUpstreamForRole);
  const gatewayRunning = gatewayStatus.running;
  const routeRecognized = isClaude ? true : (codexRouting?.routed ?? false);
  const routeMode: 'proxy' | 'direct' | 'off' = routeEnabled
    ? (gatewayRunning && proxyAvailable && routeRecognized ? 'proxy' : 'off')
    : 'direct';
  const gatewayBaseUrl = gatewayRunning ? gatewayStatus.baseUrl : undefined;

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

  const proxySection = (
    <AiCliToolProxySection
      t={t}
      palette={palette}
      tool={mode}
      proxyEnabled={routeEnabled}
      proxyAvailable={proxyAvailable}
      proxyToggling={gatewayToggling}
      routeMode={routeMode}
      configPath={isClaude ? settingsPath : (codexRouting?.configPath ?? '~/.codex/config.toml')}
      authPath={isClaude ? undefined : codexRouting?.authPath}
      gatewayBaseUrl={routeEnabled ? gatewayBaseUrl : undefined}
      onProxyToggle={isClaude ? onRouteClaudeToggle : onRouteCodexToggle}
    />
  );

  return (
    <div style={{ paddingTop: 4 }}>
      {isClaude ? (
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
      ) : null}

      {proxySection}

      {!isClaude && onRestartCodex ? (
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
        role={mode}
        proxyEnabled={routeEnabled}
      />

      {isClaude && onReset ? (
        <Button icon={<ReloadOutlined />} onClick={onReset} style={{ marginTop: 12 }}>
          {t('configPage.resetClaudeDefaults')}
        </Button>
      ) : null}
    </div>
  );
}
