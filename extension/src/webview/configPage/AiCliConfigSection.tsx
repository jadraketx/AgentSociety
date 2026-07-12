import * as React from 'react';
import { Divider, Space, Switch, Tooltip, Typography, Button, Tag } from 'antd';
import { CheckCircleOutlined, LinkOutlined, QuestionCircleOutlined, ReloadOutlined, CheckOutlined } from '@ant-design/icons';
import type { TFunction } from 'i18next';
import type { VscodeThemePalette } from '../theme';
import { ClaudeCodeConfigSection, type ProviderSectionCommonProps } from './ClaudeCodeConfigSection';
import { GatewayUsagePanel } from './GatewayUsagePanel';
import { tabBodyStyle } from './configPageStyles';
import type { TokenUsageRecord } from './gatewayUsageTypes';
import { providerHasApiUpstream } from './providerAuth';
import type { ModelPricingMap } from './modelPricing';

const { Text } = Typography;

export interface AiCliConfigSectionProps extends ProviderSectionCommonProps {
  onResetClaude: () => void;
  failoverEnabled: boolean;
  onFailoverToggle: (enabled: boolean) => void;
  onToggleFailoverProvider: (id: string, role: 'claude' | 'codex') => void;
  onShowGatewayLog: () => void;
  usageRecords: TokenUsageRecord[];
  usageLoading: boolean;
  onRefreshUsage: () => void;
  onClearUsage: () => void;
  customPricing: ModelPricingMap;
  onGetPricing: () => void;
  onRefreshPricing: () => void;
  onSavePricing: (pricing: ModelPricingMap) => void;
  onClearPricing: () => void;
}

export function AiCliConfigSection(props: AiCliConfigSectionProps) {
  const {
    onResetClaude,
    gatewayStatus,
    gatewayToggling,
    onRouteClaudeToggle,
    onRouteCodexToggle,
    failoverEnabled,
    onFailoverToggle,
    onToggleFailoverProvider,
    usageRecords,
    usageLoading,
    onRefreshUsage,
    onClearUsage,
    customPricing,
    onGetPricing,
    onRefreshPricing,
    onSavePricing,
    onClearPricing,
    onShowGatewayLog,
    ...providerSectionCommon
  } = props;
  const { t, palette, providers } = providerSectionCommon;

  const routeClaude = gatewayStatus.routeClaude ?? false;
  const routeCodex = gatewayStatus.routeCodex ?? false;
  const gatewayRunning = gatewayStatus.running;
  const gatewayBaseUrl = gatewayRunning ? gatewayStatus.baseUrl : undefined;
  const claudeProxyAvailable = gatewayStatus.claudeProxyAvailable ?? false;
  const codexProxyAvailable = gatewayStatus.codexProxyAvailable ?? false;
  const claudeUpstreamCount = providers.filter((p) => providerHasApiUpstream(p)).length;
  const codexUpstreamCount = providers.filter((p) => providerHasApiUpstream(p)).length;
  const showFailoverToggle =
    (routeClaude && claudeUpstreamCount >= 2) || (routeCodex && codexUpstreamCount >= 2);
  const activeClaudeProvider = providers.find((p) => p.activeClaude);
  const activeCodexProvider = providers.find((p) => p.activeCodex);

  const summaryItems = [
    {
      key: 'gateway',
      label: t('claudeCodeConfig.gatewaySummaryService'),
      value: gatewayRunning
        ? t('claudeCodeConfig.gatewaySummaryRunning')
        : routeClaude || routeCodex
          ? t('claudeCodeConfig.gatewaySummaryStopped')
          : t('claudeCodeConfig.gatewaySummaryDirect'),
      tone: gatewayRunning ? '#52c41a' : routeClaude || routeCodex ? '#faad14' : palette.descriptionForeground,
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
      {/* Topology summary */}
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

      {gatewayRunning && gatewayStatus.stats ? (
        <div
          style={{
            marginBottom: 12,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 8,
          }}
        >
          {[
            {
              key: 'requests',
              label: t('claudeCodeConfig.gatewayStatsRequests'),
              value: String(gatewayStatus.stats.totalRequests),
            },
            {
              key: 'success',
              label: t('claudeCodeConfig.gatewayStatsSuccessRate'),
              value: `${gatewayStatus.stats.successRate}%`,
            },
            {
              key: 'active',
              label: t('claudeCodeConfig.gatewayStatsActive'),
              value: String(gatewayStatus.stats.activeConnections),
            },
            {
              key: 'uptime',
              label: t('claudeCodeConfig.gatewayStatsUptime'),
              value: `${Math.floor(gatewayStatus.stats.uptimeMs / 1000)}s`,
            },
          ].map((item) => (
            <div
              key={item.key}
              style={{
                border: `1px solid ${palette.panelBorder}`,
                borderRadius: 8,
                padding: '8px 10px',
                background: palette.codeBlockBackground,
              }}
            >
              <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>{item.label}</Text>
              <Text strong style={{ fontSize: 14 }}>{item.value}</Text>
            </div>
          ))}
        </div>
      ) : null}

      {/* Unified routing panel — Claude + Codex proxy toggles inline */}
      <div
        style={{
          marginBottom: 16,
          padding: '12px 14px',
          border: `1px solid ${palette.panelBorder}`,
          borderRadius: 10,
          background: palette.codeBlockBackground,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Text strong style={{ fontSize: 13 }}>{t('claudeCodeConfig.gatewayTitle')}</Text>
          <Button size="small" icon={<ReloadOutlined />} onClick={onShowGatewayLog}>
            {t('claudeCodeConfig.showGatewayLog')}
          </Button>
        </div>

        {/* Claude Code route */}
        <div style={routeRowStyle(routeClaude, gatewayRunning)}>
          <Space size={6}>
            <span style={dotStyle(routeClaude, gatewayRunning, palette.descriptionForeground)} />
            <Text style={{ fontSize: 12, fontWeight: 500 }}>Claude Code</Text>
            <Tag color={routeStatusColor(routeClaude, gatewayRunning)} style={{ margin: 0, fontSize: 10 }}>
              {routeClaude
                ? gatewayRunning ? t('claudeCodeConfig.gatewayRouteProxy') : t('claudeCodeConfig.gatewayRouteNotDetected')
                : t('claudeCodeConfig.gatewayRouteDirect')}
            </Tag>
          </Space>
          <Space size={6}>
            <Text style={{ fontSize: 11 }}>{t('claudeCodeConfig.gatewayClaudeProxyEnable')}</Text>
            <Switch
              size="small"
              checked={routeClaude}
              loading={gatewayToggling}
              disabled={!claudeProxyAvailable && !routeClaude}
              onChange={onRouteClaudeToggle}
            />
          </Space>
        </div>

        {/* Codex route */}
        <div style={routeRowStyle(routeCodex, gatewayRunning)}>
          <Space size={6}>
            <span style={dotStyle(routeCodex, gatewayRunning, palette.descriptionForeground)} />
            <Text style={{ fontSize: 12, fontWeight: 500 }}>Codex</Text>
            <Tag color={routeStatusColor(routeCodex, gatewayRunning)} style={{ margin: 0, fontSize: 10 }}>
              {routeCodex
                ? gatewayRunning ? t('claudeCodeConfig.gatewayRouteProxy') : t('claudeCodeConfig.gatewayRouteNotDetected')
                : t('claudeCodeConfig.gatewayRouteDirect')}
            </Tag>
          </Space>
          <Space size={6}>
            <Text style={{ fontSize: 11 }}>{t('claudeCodeConfig.gatewayCodexProxyEnable')}</Text>
            <Switch
              size="small"
              checked={routeCodex}
              loading={gatewayToggling}
              disabled={!codexProxyAvailable && !routeCodex}
              onChange={onRouteCodexToggle}
            />
          </Space>
        </div>

        {/* Failover section */}
        {(routeClaude || routeCodex) ? (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${palette.panelBorder}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <Space size={6}>
                <Switch
                  size="small"
                  checked={failoverEnabled && showFailoverToggle}
                  disabled={!showFailoverToggle}
                  onChange={onFailoverToggle}
                />
                <Text style={{ fontSize: 12 }}>{t('claudeCodeConfig.failoverEnable')}</Text>
                <Tag color={failoverEnabled && showFailoverToggle ? 'blue' : 'default'} style={{ margin: 0, fontSize: 10 }}>
                  {t(showFailoverToggle ? (failoverEnabled ? 'claudeCodeConfig.failoverReady' : 'claudeCodeConfig.failoverNeedBackup') : 'claudeCodeConfig.failoverNeedBackup')}
                </Tag>
                <Tooltip title={t('claudeCodeConfig.failoverHint')}>
                  <QuestionCircleOutlined style={{ opacity: 0.65, cursor: 'help' }} />
                </Tooltip>
              </Space>
            </div>
            {/* Backup provider selection — only visible when failover is enabled */}
            {failoverEnabled && showFailoverToggle ? (
              <div style={{ marginTop: 10, padding: '10px 12px', border: `1px solid ${palette.panelBorder}`, borderRadius: 8, background: palette.codeBlockBackground }}>
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
                  {t('claudeCodeConfig.failoverSelectBackups')}
                </Text>
                {/* Claude backups */}
                {routeClaude ? (
                  <div style={{ marginBottom: 8 }}>
                    <Text strong style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                      {t('claudeCodeConfig.failoverBackupsFor', { role: 'Claude' })}
                    </Text>
                    {providers.filter((p) => !p.activeClaude && providerHasApiUpstream(p)).map((p) => (
                      <div
                        key={p.id}
                        onClick={() => onToggleFailoverProvider(p.id, 'claude')}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '3px 10px',
                          margin: '2px 4px 2px 0',
                          borderRadius: 4,
                          cursor: 'pointer',
                          border: `1px solid ${p.failoverClaude ? '#fa8c16' : palette.panelBorder}`,
                          background: p.failoverClaude ? 'rgba(250, 140, 22, 0.08)' : 'transparent',
                          fontSize: 11,
                          color: p.failoverClaude ? '#fa8c16' : palette.descriptionForeground,
                        }}
                      >
                        {p.failoverClaude ? <CheckOutlined style={{ fontSize: 10 }} /> : null}
                        {p.name || p.baseUrl || t('claudeCodeConfig.providerUnnamed')}
                      </div>
                    ))}
                    {providers.filter((p) => !p.activeClaude && providerHasApiUpstream(p)).length === 0 ? (
                      <Text type="secondary" style={{ fontSize: 10 }}>{t('claudeCodeConfig.failoverNoBackups')}</Text>
                    ) : null}
                  </div>
                ) : null}
                {/* Codex backups */}
                {routeCodex ? (
                  <div>
                    <Text strong style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
                      {t('claudeCodeConfig.failoverBackupsFor', { role: 'Codex' })}
                    </Text>
                    {providers.filter((p) => !p.activeCodex && providerHasApiUpstream(p)).map((p) => (
                      <div
                        key={p.id}
                        onClick={() => onToggleFailoverProvider(p.id, 'codex')}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '3px 10px',
                          margin: '2px 4px 2px 0',
                          borderRadius: 4,
                          cursor: 'pointer',
                          border: `1px solid ${p.failoverCodex ? '#fa8c16' : palette.panelBorder}`,
                          background: p.failoverCodex ? 'rgba(250, 140, 22, 0.08)' : 'transparent',
                          fontSize: 11,
                          color: p.failoverCodex ? '#fa8c16' : palette.descriptionForeground,
                        }}
                      >
                        {p.failoverCodex ? <CheckOutlined style={{ fontSize: 10 }} /> : null}
                        {p.name || p.baseUrl || t('claudeCodeConfig.providerUnnamed')}
                      </div>
                    ))}
                    {providers.filter((p) => !p.activeCodex && providerHasApiUpstream(p)).length === 0 ? (
                      <Text type="secondary" style={{ fontSize: 10 }}>{t('claudeCodeConfig.failoverNoBackups')}</Text>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Unified provider list — no sub-tabs */}
      <ClaudeCodeConfigSection {...providerSectionCommon} mode="unified" onReset={onResetClaude} />

      <Divider orientation="left" plain style={{ margin: '20px 0 12px', fontSize: 12 }}>
        {t('claudeCodeConfig.usageDivider')}
      </Divider>
      <GatewayUsagePanel
        t={t}
        palette={palette}
        gatewayStatus={gatewayStatus}
        records={usageRecords}
        loading={usageLoading}
        onRefresh={onRefreshUsage}
        onClear={onClearUsage}
        customPricing={customPricing}
        onGetPricing={onGetPricing}
        onRefreshPricing={onRefreshPricing}
        onSavePricing={onSavePricing}
        onClearPricing={onClearPricing}
      />
    </div>
  );
}

function routeRowStyle(active: boolean, running: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '8px 10px',
    borderRadius: 6,
    marginBottom: 6,
    background: active ? 'rgba(22, 119, 255, 0.04)' : 'transparent',
    border: active ? '1px solid rgba(22, 119, 255, 0.15)' : '1px solid transparent',
  };
}

function dotStyle(active: boolean, running: boolean, fallback: string): React.CSSProperties {
  return {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: active ? (running ? '#52c41a' : '#1677ff') : fallback,
    flexShrink: 0,
  };
}

function routeStatusColor(active: boolean, running: boolean): 'success' | 'processing' | 'default' {
  if (!active) return 'default';
  return running ? 'success' : 'processing';
}
