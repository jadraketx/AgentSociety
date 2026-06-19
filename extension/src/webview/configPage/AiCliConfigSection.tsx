import * as React from 'react';
import { Divider, Space, Switch, Tooltip, Typography, Button, Tabs, Tag } from 'antd';
import { CheckCircleOutlined, LinkOutlined, QuestionCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import type { TFunction } from 'i18next';
import type { VscodeThemePalette } from '../theme';
import { ClaudeCodeConfigSection, type ProviderSectionCommonProps } from './ClaudeCodeConfigSection';
import { GatewayUsagePanel } from './GatewayUsagePanel';
import { tabBodyStyle } from './configPageStyles';
import type { TokenUsageRecord, UsageAggregation } from './gatewayUsageTypes';
import { providerHasApiUpstream } from './providerAuth';
import type { ModelPricingMap } from './modelPricing';

const { Text } = Typography;

export type AiCliSubTab = 'claude' | 'codex';

export interface AiCliConfigSectionProps extends ProviderSectionCommonProps {
  onResetClaude: () => void;
  failoverEnabled: boolean;
  onFailoverToggle: (enabled: boolean) => void;
  onShowGatewayLog: () => void;
  usageRecords: TokenUsageRecord[];
  usageAggregation: UsageAggregation | null;
  usageLoading: boolean;
  onRefreshUsage: () => void;
  onClearUsage: () => void;
  customPricing: ModelPricingMap;
  onGetPricing: () => void;
  onSavePricing: (pricing: ModelPricingMap) => void;
  onClearPricing: () => void;
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
    ...providerSectionCommon
  } = props;
  const [subTab, setSubTab] = React.useState<AiCliSubTab>('claude');

  const routeClaude = gatewayStatus.routeClaude ?? false;
  const routeCodex = gatewayStatus.routeCodex ?? false;
  const claudeUpstreamCount = providers.filter(
    (p) => providerHasApiUpstream(p)
  ).length;
  const codexUpstreamCount = providers.filter(
    (p) => p.apiKind === 'openai' && providerHasApiUpstream(p)
  ).length;
  const showFailoverToggle =
    (routeClaude && claudeUpstreamCount >= 2) || (routeCodex && codexUpstreamCount >= 2);
  const activeClaudeProvider = providers.find((p) => p.activeClaude);
  const activeCodexProvider = providers.find((p) => p.activeCodex && p.apiKind === 'openai');
  const gatewayBaseUrl = gatewayStatus.running ? gatewayStatus.baseUrl : undefined;
  const summaryItems = [
    {
      key: 'gateway',
      label: t('claudeCodeConfig.gatewaySummaryService'),
      value: gatewayStatus.running
        ? t('claudeCodeConfig.gatewaySummaryRunning')
        : routeClaude || routeCodex
          ? t('claudeCodeConfig.gatewaySummaryStopped')
          : t('claudeCodeConfig.gatewaySummaryDirect'),
      tone: gatewayStatus.running ? '#52c41a' : routeClaude || routeCodex ? '#faad14' : palette.descriptionForeground,
      detail: gatewayBaseUrl ?? t('claudeCodeConfig.gatewaySummaryNoLocal'),
    },
    {
      key: 'claude',
      label: t('claudeCodeConfig.gatewayClaudeBlockTitle'),
      value: routeClaude ? t('claudeCodeConfig.gatewayRouteProxy') : t('claudeCodeConfig.gatewayRouteDirect'),
      tone: routeClaude ? '#1677ff' : palette.descriptionForeground,
      detail: activeClaudeProvider?.name || activeClaudeProvider?.baseUrl || t('claudeCodeConfig.providerNoneActive'),
    },
    {
      key: 'codex',
      label: t('claudeCodeConfig.gatewayCodexBlockTitle'),
      value: routeCodex ? t('claudeCodeConfig.gatewayRouteProxy') : t('claudeCodeConfig.gatewayRouteDirect'),
      tone: routeCodex ? '#1677ff' : palette.descriptionForeground,
      detail: activeCodexProvider?.name || activeCodexProvider?.baseUrl || t('claudeCodeConfig.providerNoneActive'),
    },
  ];

  return (
    <div style={tabBodyStyle}>
      <div style={{ marginBottom: 12 }}>
        <Space size={6} wrap style={{ marginBottom: 8 }}>
          <LinkOutlined />
          <Text strong style={{ fontSize: 13 }}>{t('claudeCodeConfig.gatewayTopologyTitle')}</Text>
          <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>
            {t('claudeCodeConfig.gatewaySharedProviders')}
          </Tag>
        </Space>
        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 10 }}>
          {t('claudeCodeConfig.gatewayTopologyHint')}
        </Text>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: 8,
          }}
        >
          {summaryItems.map((item) => (
            <div
              key={item.key}
              style={{
                border: `1px solid ${palette.panelBorder}`,
                borderRadius: 8,
                padding: '9px 10px',
                background: palette.codeBlockBackground,
                minWidth: 0,
              }}
            >
              <Space size={6} style={{ marginBottom: 4 }}>
                <CheckCircleOutlined style={{ color: item.tone }} />
                <Text type="secondary" style={{ fontSize: 11 }}>{item.label}</Text>
              </Space>
              <Text strong style={{ display: 'block', fontSize: 13, color: item.tone }}>
                {item.value}
              </Text>
              <Text type="secondary" ellipsis={{ tooltip: item.detail }} style={{ display: 'block', fontSize: 11 }}>
                {item.detail}
              </Text>
            </div>
          ))}
        </div>
      </div>

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
              <ClaudeCodeConfigSection {...providerSectionCommon} mode="claude" onReset={onResetClaude} />
            ),
          },
          {
            key: 'codex',
            label: t('claudeCodeConfig.gatewayCodexBlockTitle'),
            children: <ClaudeCodeConfigSection {...providerSectionCommon} mode="codex" />,
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
