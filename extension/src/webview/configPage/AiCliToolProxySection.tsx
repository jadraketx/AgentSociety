import * as React from 'react';
import { Space, Switch, Tag, Tooltip, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import type { TFunction } from 'i18next';
import type { VscodeThemePalette } from '../theme';

const { Text } = Typography;

export type AiCliToolProxySectionProps = {
  t: TFunction;
  palette: VscodeThemePalette;
  tool: 'claude' | 'codex';
  proxyEnabled: boolean;
  proxyAvailable: boolean;
  proxyToggling: boolean;
  routeMode: 'proxy' | 'direct' | 'off';
  configPath: string;
  authPath?: string;
  gatewayBaseUrl?: string;
  onProxyToggle: (enabled: boolean) => void;
};

export function AiCliToolProxySection({
  t,
  palette,
  tool,
  proxyEnabled,
  proxyAvailable,
  proxyToggling,
  routeMode,
  configPath,
  authPath,
  gatewayBaseUrl,
  onProxyToggle,
}: AiCliToolProxySectionProps) {
  const isClaude = tool === 'claude';
  const titleKey = isClaude ? 'claudeCodeConfig.gatewayClaudeSectionTitle' : 'claudeCodeConfig.gatewayCodexSectionTitle';
  const enableKey = isClaude ? 'claudeCodeConfig.gatewayClaudeProxyEnable' : 'claudeCodeConfig.gatewayCodexProxyEnable';
  const protocolKey = isClaude ? 'claudeCodeConfig.gatewayClaudeProtocol' : 'claudeCodeConfig.gatewayCodexProtocol';
  const hintKey = isClaude ? 'claudeCodeConfig.gatewayClaudeSectionHint' : 'claudeCodeConfig.gatewayCodexSectionHint';
  const unavailableKey = isClaude
    ? 'claudeCodeConfig.gatewayClaudeSubscriptionHint'
    : 'claudeCodeConfig.gatewayCodexSubscriptionHint';
  const detail = (
    <Space direction="vertical" size={3} style={{ maxWidth: 440 }}>
      <Text style={{ color: 'inherit', fontSize: 11 }}>{t(protocolKey)}</Text>
      <Text style={{ color: 'inherit', fontSize: 11 }}>
        {t(isClaude ? 'claudeCodeConfig.savePath' : 'claudeCodeConfig.gatewayCodexConfigPath')}: {configPath}
      </Text>
      {!isClaude && authPath ? (
        <Text style={{ color: 'inherit', fontSize: 11 }}>
          {t('claudeCodeConfig.gatewayCodexAuthPath')}: {authPath}
        </Text>
      ) : null}
      <Text style={{ color: 'inherit', fontSize: 11 }}>{t(hintKey)}</Text>
    </Space>
  );

  return (
    <div
      style={{
        marginBottom: 12,
        padding: '12px 14px',
        border: `1px solid ${proxyEnabled ? palette.focusBorder : palette.panelBorder}`,
        borderRadius: 10,
        background: proxyEnabled ? palette.codeBlockBackground : 'transparent',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <Space size={7} wrap>
          {routeMode === 'off' ? (
            <CloseCircleOutlined style={{ color: palette.descriptionForeground }} />
          ) : (
            <CheckCircleOutlined
              style={{ color: routeMode === 'proxy' ? palette.successForeground : palette.linkForeground }}
            />
          )}
          <Text strong>{t(titleKey)}</Text>
          <Tag
            color={routeMode === 'proxy' ? 'success' : routeMode === 'direct' ? 'processing' : 'default'}
            style={{ margin: 0, fontSize: 10 }}
          >
            {routeMode === 'proxy'
              ? t('claudeCodeConfig.gatewayRouteProxy')
              : routeMode === 'direct'
                ? t('claudeCodeConfig.gatewayRouteDirect')
                : t('claudeCodeConfig.gatewayRouteNotDetected')}
          </Tag>
          <Tooltip title={detail}>
            <QuestionCircleOutlined style={{ color: palette.descriptionForeground, cursor: 'help' }} />
          </Tooltip>
        </Space>
        <Space size={7}>
          <Text style={{ fontSize: 12 }}>{t(enableKey)}</Text>
          <Switch
            size="small"
            checked={proxyEnabled}
            loading={proxyToggling}
            disabled={!proxyAvailable && !proxyEnabled}
            onChange={onProxyToggle}
          />
        </Space>
      </div>
      {proxyEnabled && gatewayBaseUrl ? (
        <Text type="secondary" ellipsis={{ tooltip: gatewayBaseUrl }} style={{ display: 'block', marginTop: 8, fontSize: 11 }}>
          {gatewayBaseUrl}
        </Text>
      ) : !proxyAvailable ? (
        <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 11 }}>
          {t(unavailableKey)}
        </Text>
      ) : null}
    </div>
  );
}
