import * as React from 'react';
import { Divider, Space, Switch, Tooltip, Typography, Button, Tabs, Tag } from 'antd';
import { QuestionCircleOutlined, ReloadOutlined } from '@ant-design/icons';
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
import { ClaudeCodeConfigSection } from './ClaudeCodeConfigSection';
import { GatewayUsagePanel } from './GatewayUsagePanel';
import { tabBodyStyle } from './configPageStyles';
import type { AiCliProviderRecord } from './aiCliProviderTypes';
import type { TokenUsageRecord, UsageAggregation } from './gatewayUsageTypes';
import { providerHasApiUpstream } from './providerAuth';
import type { ModelPricingMap } from './modelPricing';

const { Text } = Typography;

export type AiCliSubTab = 'claude' | 'codex';

export interface AiCliConfigSectionProps {
  t: TFunction;
  palette: VscodeThemePalette;
  cliStatus: ClaudeCodeCliStatus;
  settingsPath: string;
  onResetClaude: () => void;
  gatewayStatus: AiCliGatewayStatus;
  gatewayToggling: boolean;
  onRouteClaudeToggle: (enabled: boolean) => void;
  onRouteCodexToggle: (enabled: boolean) => void;
  codexRouting: CodexRoutingStatus | null;
  failoverEnabled: boolean;
  onFailoverToggle: (enabled: boolean) => void;
  providers: AiCliProviderRecord[];
  providersLoading: boolean;
  speedtestResults: Record<string, ProviderAvailabilityResult>;
  onSaveProvider: (provider: AiCliProviderRecord) => void;
  onAddProvider: (draft: Omit<AiCliProviderRecord, 'id' | 'activeClaude' | 'activeCodex'>) => void;
  onActivateProvider: (id: string, role: 'claude' | 'codex') => void;
  onRemoveProvider: (id: string) => void;
  onSpeedtestProvider: (baseUrl: string, apiKey: string, apiKind?: 'anthropic' | 'openai') => void;
  onShowGatewayLog: () => void;
  modelsByProvider: Record<string, ClaudeModelOption[]>;
  modelsLoadingByProvider: Record<string, boolean>;
  modelsErrorByProvider: Record<string, string | null>;
  onFetchProviderModels: (
    providerId: string,
    baseUrl: string,
    apiKey: string,
    apiKind?: 'anthropic' | 'openai'
  ) => void;
  usageRecords: TokenUsageRecord[];
  usageAggregation: UsageAggregation | null;
  usageLoading: boolean;
  onRefreshUsage: () => void;
  onClearUsage: () => void;
  customPricing: ModelPricingMap;
  onGetPricing: () => void;
  onSavePricing: (pricing: ModelPricingMap) => void;
  onClearPricing: () => void;
  providerUsage: Record<string, ProviderUsageQueryResult & { loading?: boolean }>;
  onQueryProviderUsage: (id: string) => void;
  onRestartCodex?: () => void;
}

export function AiCliConfigSection(props: AiCliConfigSectionProps) {
  const {
    t,
    palette,
    onResetClaude,
    gatewayStatus,
    providers,
    failoverEnabled,
    onFailoverToggle,
    usageRecords,
    usageAggregation,
    usageLoading,
    onRefreshUsage,
    onClearUsage,
    customPricing,
    onGetPricing,
    onSavePricing,
    onClearPricing,
    onShowGatewayLog,
  } = props;
  const [subTab, setSubTab] = React.useState<AiCliSubTab>('claude');

  const routeClaude = gatewayStatus.routeClaude ?? false;
  const routeCodex = gatewayStatus.routeCodex ?? false;
  const claudeUpstreamCount = providers.filter(
    (p) => p.apiKind === 'anthropic' && providerHasApiUpstream(p)
  ).length;
  const codexUpstreamCount = providers.filter(
    (p) => p.apiKind === 'openai' && providerHasApiUpstream(p)
  ).length;
  const showFailoverToggle =
    (routeClaude && claudeUpstreamCount >= 2) || (routeCodex && codexUpstreamCount >= 2);

  const toolSectionProps = {
    t: props.t,
    palette: props.palette,
    cliStatus: props.cliStatus,
    settingsPath: props.settingsPath,
    gatewayStatus: props.gatewayStatus,
    gatewayToggling: props.gatewayToggling,
    onRouteClaudeToggle: props.onRouteClaudeToggle,
    onRouteCodexToggle: props.onRouteCodexToggle,
    codexRouting: props.codexRouting,
    providers: props.providers,
    providersLoading: props.providersLoading,
    speedtestResults: props.speedtestResults,
    onSaveProvider: props.onSaveProvider,
    onAddProvider: props.onAddProvider,
    onActivateProvider: props.onActivateProvider,
    onRemoveProvider: props.onRemoveProvider,
    onSpeedtestProvider: props.onSpeedtestProvider,
    modelsByProvider: props.modelsByProvider,
    modelsLoadingByProvider: props.modelsLoadingByProvider,
    modelsErrorByProvider: props.modelsErrorByProvider,
    onFetchProviderModels: props.onFetchProviderModels,
    providerUsage: props.providerUsage,
    onQueryProviderUsage: props.onQueryProviderUsage,
    onRestartCodex: props.onRestartCodex,
  };

  return (
    <div style={tabBodyStyle}>
      <Tabs
        activeKey={subTab}
        onChange={(key) => setSubTab(key as AiCliSubTab)}
        size="small"
        destroyInactiveTabPane={false}
        items={[
          {
            key: 'claude',
            label: t('claudeCodeConfig.gatewayClaudeBlockTitle'),
            children: (
              <ClaudeCodeConfigSection mode="claude" {...toolSectionProps} onReset={onResetClaude} />
            ),
          },
          {
            key: 'codex',
            label: t('claudeCodeConfig.gatewayCodexBlockTitle'),
            children: <ClaudeCodeConfigSection mode="codex" {...toolSectionProps} />,
          },
        ]}
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8, marginBottom: 8 }}>
        <Button size="small" icon={<ReloadOutlined />} onClick={onShowGatewayLog}>
          {t('claudeCodeConfig.showGatewayLog')}
        </Button>
      </div>

      {routeClaude || routeCodex ? (
        <div
          style={{
            marginBottom: 12,
            padding: '8px 10px',
            border: `1px solid ${palette.panelBorder}`,
            borderRadius: 8,
            background: palette.codeBlockBackground,
          }}
        >
          <Space align="center" wrap>
            <Switch
              size="small"
              checked={failoverEnabled && showFailoverToggle}
              disabled={!showFailoverToggle}
              onChange={onFailoverToggle}
            />
            <Text style={{ fontSize: 12 }}>{t('claudeCodeConfig.failoverEnable')}</Text>
            <Tag color={showFailoverToggle ? 'blue' : 'default'} style={{ margin: 0, fontSize: 10 }}>
              {t(showFailoverToggle ? 'claudeCodeConfig.failoverReady' : 'claudeCodeConfig.failoverNeedBackup')}
            </Tag>
            <Tooltip title={t('claudeCodeConfig.failoverHint')}>
              <QuestionCircleOutlined style={{ opacity: 0.65, cursor: 'help' }} />
            </Tooltip>
          </Space>
          <Text type="secondary" style={{ display: 'block', fontSize: 11, marginTop: 4 }}>
            {t('claudeCodeConfig.failoverSummary', {
              claude: claudeUpstreamCount,
              codex: codexUpstreamCount,
            })}
          </Text>
        </div>
      ) : null}

      <Divider orientation="left" plain style={{ margin: '20px 0 12px', fontSize: 12 }}>
        {t('claudeCodeConfig.usageDivider')}
      </Divider>
      <GatewayUsagePanel
        t={t}
        palette={palette}
        records={usageRecords}
        aggregation={usageAggregation}
        loading={usageLoading}
        onRefresh={onRefreshUsage}
        onClear={onClearUsage}
        customPricing={customPricing}
        onGetPricing={onGetPricing}
        onSavePricing={onSavePricing}
        onClearPricing={onClearPricing}
      />
    </div>
  );
}
