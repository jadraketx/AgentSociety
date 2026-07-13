import * as React from 'react';
import { Alert, Button, Modal, Space, Tag, Tooltip, Typography } from 'antd';
import { CloudDownloadOutlined, CopyOutlined, LinkOutlined } from '@ant-design/icons';
import type { TFunction } from 'i18next';
import type { VscodeThemePalette } from '../theme';
import { formatGatewayClaudeModels } from '../../services/webConfigGatewayImport';
import type { ClaudeCodeConfigValues } from './claudeCodeTypes';
import type { ConfigValues, ImportedModelOptions, EasyPaperConfigValues, VSCodeAPI } from './types';

const { Text, Title } = Typography;

export type WebImportGatewayProviderDraft = {
  name: string;
  baseUrl: string;
  apiKey: string;
  apiKind?: 'anthropic' | 'openai';
  model?: string;
  sonnetModel?: string;
  opusModel?: string;
  fableModel?: string;
  haikuModel?: string;
  declareSonnet1m?: boolean;
  declareOpus1m?: boolean;
  declareFable1m?: boolean;
  codexEnable1m?: boolean;
};

export type DeviceAuthState = {
  status: 'idle' | 'starting' | 'waiting' | 'polling';
  userCode?: string;
  verificationUri?: string;
  verificationUriComplete?: string;
  expiresIn?: number;
  authPath?: string;
};

export type PendingWebImport = {
  config?: Partial<ConfigValues>;
  claudeConfig?: Partial<ClaudeCodeConfigValues>;
  easyPaperConfig?: Partial<EasyPaperConfigValues>;
  gatewayProvider?: WebImportGatewayProviderDraft;
  gatewayProviderHasApiKey?: boolean;
  modelOptions?: ImportedModelOptions;
  authPath?: string;
};

type Props = {
  t: TFunction;
  palette: VscodeThemePalette;
  vscode: VSCodeAPI;
  deviceAuth: DeviceAuthState;
  pendingImport: PendingWebImport | null;
  applying: boolean;
  onStart: () => void;
  onCancel: () => void;
  onConfirm: (imported: PendingWebImport) => void;
  onDismissConfirm: () => void;
  notify: (type: 'success' | 'error', message: string, description?: string) => void;
  prominent?: boolean;
  compact?: boolean;
};

export function WebConfigImportPanel({
  t,
  vscode,
  deviceAuth,
  pendingImport,
  applying,
  onStart,
  onCancel,
  onConfirm,
  onDismissConfirm,
  notify,
  prominent = false,
  compact = false,
}: Props) {
  const copyToClipboard = React.useCallback(
    (value: string, message: string) => {
      void navigator.clipboard.writeText(value).then(() => {
        notify('success', message);
      });
    },
    [notify]
  );

  const importBusy = deviceAuth.status === 'starting' || deviceAuth.status === 'polling';
  const gateway = pendingImport?.gatewayProvider;

  return (
    <>
      <Modal
        open={Boolean(pendingImport)}
        title={t('configPage.webImport.confirmTitle')}
        okText={t('configPage.webImport.confirmApply')}
        cancelText={t('configPage.webImport.confirmCancel')}
        confirmLoading={applying}
        cancelButtonProps={{ disabled: applying }}
        closable={!applying}
        maskClosable={!applying}
        onOk={() => {
          if (pendingImport) {
            onConfirm(pendingImport);
          }
        }}
        onCancel={onDismissConfirm}
      >
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Text type="secondary">{t('configPage.webImport.confirmDesc')}</Text>
          <Text strong style={{ fontSize: 12 }}>
            {t('configPage.webImport.sectionSimulation')}
          </Text>
          <Text>
            {t('configPage.llm.apiBase')}: <code>{pendingImport?.config?.llmApiBase || '-'}</code>
          </Text>
          <Text>
            {t('configPage.llm.modelName')}: <code>{pendingImport?.config?.llmModel || '-'}</code>
          </Text>
          <Text>
            {t('configPage.llm.apiKey')}:{' '}
            <code>{pendingImport?.config?.llmApiKey ? '********' : '-'}</code>
          </Text>
          {gateway ? (
            <>
              <Text strong style={{ fontSize: 12, marginTop: 4 }}>
                {t('configPage.webImport.sectionGateway')}
              </Text>
              <Text>
                {t('configPage.webImport.gatewayName')}: <code>{gateway.name}</code>
              </Text>
              <Text>
                {t('configPage.llm.apiBase')}: <code>{gateway.baseUrl}</code>
              </Text>
              <Text>
                {t('configPage.llm.modelName')}: <code>{gateway.model || '-'}</code>
              </Text>
              <Text>
                {t('configPage.llm.apiKey')}:{' '}
                <code>
                  {pendingImport?.gatewayProviderHasApiKey || pendingImport?.config?.llmApiKey
                    ? '********'
                    : '-'}
                </code>
              </Text>
              <Text>
                Sonnet / Opus / Fable / Haiku:{' '}
                <code>{formatGatewayClaudeModels(gateway)}</code>
              </Text>
              {gateway.declareSonnet1m || gateway.declareOpus1m || gateway.declareFable1m ? (
                <Text>
                  Claude 1M:{' '}
                  <code>
                    {[
                      gateway.declareSonnet1m ? 'Sonnet' : '',
                      gateway.declareOpus1m ? 'Opus' : '',
                      gateway.declareFable1m ? 'Fable' : '',
                    ]
                      .filter(Boolean)
                      .join(' · ') || '-'}
                  </code>
                </Text>
              ) : null}
              {gateway.codexEnable1m ? (
                <Text>
                  Codex 1M: <code>{t('configPage.webImport.codex1mEnabled')}</code>
                </Text>
              ) : null}
            </>
          ) : null}
          <Text strong style={{ fontSize: 12, marginTop: 4 }}>
            {t('configPage.webImport.sectionEasyPaper')}
          </Text>
          <Text>
            EasyPaper LLM: <code>{pendingImport?.easyPaperConfig?.llmModelName || '-'}</code>
          </Text>
          <Text>
            EasyPaper VLM: <code>{pendingImport?.easyPaperConfig?.vlmModel || '-'}</code>
          </Text>
        </Space>
      </Modal>

      {prominent && !compact ? (
        <div style={{ marginBottom: 16 }}>
          <Title level={5} style={{ margin: '0 0 8px', fontSize: 14 }}>
            {t('configPage.webImport.prominentTitle')}
          </Title>
          <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 12 }}>
            {t('configPage.webImport.prominentDesc')}
          </Text>
        </div>
      ) : null}

      <div style={{ marginBottom: compact ? 0 : 14, display: compact ? 'inline-flex' : undefined, alignItems: compact ? 'center' : undefined }}>
        <Space wrap={!compact} align="center" size={compact ? 8 : undefined}>
          <Button
            type={prominent && !compact ? 'primary' : 'default'}
            size="middle"
            icon={<CloudDownloadOutlined />}
            loading={importBusy}
            onClick={onStart}
          >
            {t('configPage.webImport.button')}
          </Button>
          {deviceAuth.authPath ? (
            compact ? (
              <Tooltip title={deviceAuth.authPath}>
                <Tag style={{ margin: 0, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t('configPage.webImport.cachedShort')}
                </Tag>
              </Tooltip>
            ) : (
              <Text
                type="secondary"
                ellipsis={{ tooltip: deviceAuth.authPath }}
                style={{ fontSize: 12, maxWidth: 420, display: 'inline-block', verticalAlign: 'middle' }}
              >
                {t('configPage.webImport.cachedAt', { path: deviceAuth.authPath })}
              </Text>
            )
          ) : null}
        </Space>
      </div>

      {deviceAuth.status !== 'idle' ? (
        <Alert
          type="info"
          showIcon
          style={{ marginTop: compact ? 10 : 0, marginBottom: compact ? 0 : 14, borderRadius: 10 }}
          message={t('configPage.webImport.deviceTitle')}
          description={(
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {deviceAuth.userCode ? (
                <Text>
                  {t('configPage.webImport.userCode')}: <code>{deviceAuth.userCode}</code>
                </Text>
              ) : null}
              {deviceAuth.verificationUri ? (
                <>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('configPage.webImport.openedLogin')}
                  </Text>
                  <Text style={{ fontSize: 12, wordBreak: 'break-all' }}>
                    {t('configPage.webImport.loginUrl')}:{' '}
                    <code>{deviceAuth.verificationUriComplete || deviceAuth.verificationUri}</code>
                  </Text>
                </>
              ) : null}
              <Space wrap>
                {deviceAuth.userCode ? (
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() =>
                      copyToClipboard(deviceAuth.userCode || '', t('configPage.webImport.codeCopied'))
                    }
                  >
                    {t('configPage.webImport.copyCode')}
                  </Button>
                ) : null}
                {deviceAuth.verificationUri ? (
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() =>
                      copyToClipboard(
                        deviceAuth.verificationUriComplete || deviceAuth.verificationUri || '',
                        t('configPage.webImport.linkCopied')
                      )
                    }
                  >
                    {t('configPage.webImport.copyLoginUrl')}
                  </Button>
                ) : null}
                {deviceAuth.verificationUri ? (
                  <Button
                    size="small"
                    icon={<LinkOutlined />}
                    onClick={() =>
                      vscode.postMessage({
                        command: 'openUrl',
                        url: deviceAuth.verificationUriComplete || deviceAuth.verificationUri,
                      })
                    }
                  >
                    {t('configPage.webImport.openLogin')}
                  </Button>
                ) : null}
                <Button size="small" onClick={onCancel}>
                  {t('configPage.webImport.cancel')}
                </Button>
              </Space>
            </Space>
          )}
        />
      ) : null}
    </>
  );
}
