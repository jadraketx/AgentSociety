import * as React from 'react';
import {
  Alert, Button, Card, Checkbox, Col, Divider, Empty, Input, Modal, Row, Select, Space, Switch, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  CloudServerOutlined, ImportOutlined, PlusOutlined, QuestionCircleOutlined, ReloadOutlined, SyncOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { VSCodeAPI, McpServerRecord, McpProbeResult, McpPresetCatalogItem } from '../types';
import type { VscodeThemePalette } from '../theme';

const { Text, Title } = Typography;

type Props = {
  vscode: VSCodeAPI;
  palette: VscodeThemePalette;
  servers: McpServerRecord[];
  presets: McpPresetCatalogItem[];
  loading: boolean;
  probeById: Record<string, McpProbeResult | undefined>;
  probingId?: string;
  onRefresh?: () => void;
  onProbeStart?: (id: string) => void;
};

const EMPTY_DRAFT = {
  name: '',
  transport: 'http' as const,
  url: '',
  command: '',
  args: '',
  enabledClaude: true,
  enabledCodex: false,
};

export function McpIntegrationsPanel({
  vscode,
  palette,
  servers,
  presets,
  loading,
  probeById,
  probingId,
  onRefresh,
  onProbeStart,
}: Props) {
  const { t } = useTranslation();
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(EMPTY_DRAFT);

  const builtinServers = servers.filter((row) => row.builtin === 'literature');
  const customServers = servers.filter((row) => row.builtin !== 'literature');

  const openCreate = () => {
    setDraft(EMPTY_DRAFT);
    setEditorOpen(true);
  };

  const saveDraft = () => {
    if (!draft.name.trim()) {
      message.warning(t('skillManagement.mcpNameRequired'));
      return;
    }
    if (draft.transport === 'http' && !draft.url.trim()) {
      message.warning(t('skillManagement.mcpUrlRequired'));
      return;
    }
    if (draft.transport === 'stdio' && !draft.command.trim()) {
      message.warning(t('skillManagement.mcpCommandRequired'));
      return;
    }
    vscode.postMessage({
      type: 'saveMcpServer',
      payload: {
        name: draft.name.trim(),
        transport: draft.transport,
        url: draft.url.trim() || undefined,
        command: draft.command.trim() || undefined,
        args: draft.args
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        enabledClaude: draft.enabledClaude,
        enabledCodex: draft.enabledCodex,
      },
    });
    onRefresh?.();
    setEditorOpen(false);
  };

  const renderStatus = (row: McpServerRecord) => {
    if (row.builtin === 'literature') {
      return <Tag color="blue">{t('skillManagement.mcpBuiltinLiterature')}</Tag>;
    }
    if (row.transport !== 'http') {
      return <Tag>{t('skillManagement.mcpStdioHint')}</Tag>;
    }
    const probe = probeById[row.id];
    if (probingId === row.id) {
      return <Tag color="processing">{t('skillManagement.mcpProbing')}</Tag>;
    }
    if (!probe) {
      return <Tag>{t('skillManagement.mcpNotProbed')}</Tag>;
    }
    return probe.ok ? (
      <Tag color="success">{t('skillManagement.mcpTools', { count: probe.tools.length })}</Tag>
    ) : (
      <Tag color="error">{probe.error || t('skillManagement.mcpProbeFailed')}</Tag>
    );
  };

  const renderServerCard = (row: McpServerRecord) => (
    <Card
      key={row.id}
      size="small"
      style={{
        borderRadius: 10,
        border: `1px solid ${palette.panelBorder}`,
        background: row.builtin === 'literature' ? palette.surfaceMuted : palette.codeBlockBackground,
        marginBottom: 10,
      }}
      styles={{ body: { padding: '14px 16px' } }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <Text strong style={{ fontSize: 13 }}>{row.name}</Text>
          {row.builtin === 'literature' ? (
            <div>
              <Text type="secondary" style={{ fontSize: 11, lineHeight: 1.45 }}>
                {t('skillManagement.mcpBuiltinLiteratureDesc')}
              </Text>
            </div>
          ) : null}
        </div>
        <Space size={4} wrap>
          <Tag>{row.transport}</Tag>
          {renderStatus(row)}
        </Space>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginBottom: 12,
          padding: '8px 10px',
          borderRadius: 8,
          background: palette.surfaceMuted,
          border: `1px solid ${palette.panelBorder}`,
        }}
      >
        <div>
          <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 4 }}>
            Claude Code
          </Text>
          <Switch
            size="small"
            checked={row.enabledClaude}
            disabled={row.builtin === 'literature'}
            onChange={(checked) =>
              vscode.postMessage({
                type: 'toggleMcpServerApp',
                payload: { id: row.id, app: 'claude', enabled: checked },
              })
            }
          />
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 10, display: 'block', marginBottom: 4 }}>
            Codex
          </Text>
          <Switch
            size="small"
            checked={row.enabledCodex}
            disabled={row.builtin === 'literature'}
            onChange={(checked) =>
              vscode.postMessage({
                type: 'toggleMcpServerApp',
                payload: { id: row.id, app: 'codex', enabled: checked },
              })
            }
          />
        </div>
      </div>

      <Space size={6} wrap>
        {row.transport === 'http' ? (
          <Button
            size="small"
            icon={<ThunderboltOutlined />}
            loading={probingId === row.id}
            onClick={() => {
              onProbeStart?.(row.id);
              vscode.postMessage({ type: 'probeMcpServer', payload: { id: row.id } });
            }}
          >
            {t('skillManagement.mcpProbe')}
          </Button>
        ) : null}
        {row.builtin === 'literature' ? (
          <Button
            size="small"
            type="primary"
            onClick={() => vscode.postMessage({ type: 'openLiteratureMcpConfig' })}
          >
            {t('skillManagement.mcpEditInConfig')}
          </Button>
        ) : (
          <Button
            size="small"
            danger
            onClick={() => vscode.postMessage({ type: 'removeMcpServer', payload: { id: row.id } })}
          >
            {t('skillManagement.mcpRemove')}
          </Button>
        )}
      </Space>
    </Card>
  );

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14, borderRadius: 10 }}
        message={t('skillManagement.mcpIntroTitle')}
        description={t('skillManagement.mcpIntroBody')}
      />

      {presets.length > 0 ? (
        <div style={{ marginBottom: 16 }}>
          <Title level={5} style={{ margin: '0 0 8px', fontSize: 13 }}>
            {t('skillManagement.mcpRecommended')}
          </Title>
          <Row gutter={[10, 10]}>
            {presets.map((preset) => (
              <Col key={preset.presetId} xs={24} sm={12}>
                <Card
                  size="small"
                  hoverable
                  style={{
                    borderRadius: 10,
                    border: `1px solid ${palette.panelBorder}`,
                    background: palette.surfaceBackground,
                  }}
                  styles={{ body: { padding: '12px 14px' } }}
                  onClick={() => {
                    onRefresh?.();
                    vscode.postMessage({ type: 'addMcpPreset', payload: { presetId: preset.presetId } });
                  }}
                >
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <Space size={8}>
                      <CloudServerOutlined style={{ color: palette.linkForeground }} />
                      <Text strong style={{ fontSize: 13 }}>{preset.name}</Text>
                      <Tag style={{ margin: 0 }}>{preset.transport}</Tag>
                    </Space>
                    <Text type="secondary" style={{ fontSize: 11, lineHeight: 1.45 }}>
                      {t(preset.descriptionKey)}
                    </Text>
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        </div>
      ) : null}

      <Divider style={{ margin: '16px 0' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <Title level={5} style={{ margin: 0, fontSize: 13 }}>
          {t('skillManagement.mcpBuiltinSection')}
        </Title>
        <Tooltip title={t('skillManagement.mcpBuiltinSectionHint')}>
          <QuestionCircleOutlined style={{ fontSize: 12, color: palette.descriptionForeground }} />
        </Tooltip>
      </div>
      {builtinServers.length === 0 ? (
        <Card size="small" style={{ marginBottom: 16, borderRadius: 10, border: `1px solid ${palette.panelBorder}` }}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('skillManagement.mcpBuiltinEmpty')}
            style={{ padding: '12px 0' }}
          >
            <Button size="small" onClick={() => vscode.postMessage({ type: 'openLiteratureMcpConfig' })}>
              {t('skillManagement.mcpEditInConfig')}
            </Button>
          </Empty>
        </Card>
      ) : (
        <div style={{ marginBottom: 16 }}>{builtinServers.map(renderServerCard)}</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Title level={5} style={{ margin: 0, fontSize: 13 }}>
            {t('skillManagement.mcpCustomSection')}
          </Title>
          <Tooltip title={t('skillManagement.mcpCustomSectionHint')}>
            <QuestionCircleOutlined style={{ fontSize: 12, color: palette.descriptionForeground }} />
          </Tooltip>
        </div>
        <Space wrap size={6}>
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            {t('skillManagement.mcpAdd')}
          </Button>
          <Button
            size="small"
            icon={<ImportOutlined />}
            onClick={() => {
              onRefresh?.();
              vscode.postMessage({ type: 'importMcpFromClaude' });
            }}
          >
            {t('skillManagement.mcpImportClaude')}
          </Button>
          <Button
            size="small"
            icon={<SyncOutlined />}
            onClick={() => {
              onRefresh?.();
              vscode.postMessage({ type: 'syncMcpServers' });
            }}
          >
            {t('skillManagement.mcpSync')}
          </Button>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => {
              onRefresh?.();
              vscode.postMessage({ type: 'listMcpServers' });
            }}
          >
            {t('skillManagement.refresh')}
          </Button>
        </Space>
      </div>

      {loading && customServers.length === 0 ? (
        <Card style={{ borderRadius: 10, border: `1px solid ${palette.panelBorder}` }}>
          <div style={{ padding: 32, textAlign: 'center' }}>
            <Text type="secondary">{t('skillManagement.loading')}</Text>
          </div>
        </Card>
      ) : customServers.length === 0 ? (
        <Empty description={t('skillManagement.mcpEmpty')} style={{ padding: '24px 0' }} />
      ) : (
        customServers.map(renderServerCard)
      )}

      <Modal
        title={t('skillManagement.mcpAdd')}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        onOk={saveDraft}
        okText={t('skillManagement.mcpSave')}
        cancelText={t('skillManagement.cancel')}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div>
            <Text style={{ fontSize: 12 }}>{t('skillManagement.mcpName')}</Text>
            <Input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </div>
          <div>
            <Text style={{ fontSize: 12 }}>{t('skillManagement.mcpTransport')}</Text>
            <Select
              style={{ width: '100%' }}
              value={draft.transport}
              onChange={(v) => setDraft((d) => ({ ...d, transport: v }))}
              options={[
                { value: 'http', label: 'HTTP' },
                { value: 'stdio', label: 'stdio' },
              ]}
            />
          </div>
          {draft.transport === 'http' ? (
            <div>
              <Text style={{ fontSize: 12 }}>URL</Text>
              <Input
                value={draft.url}
                placeholder={t('skillManagement.mcpUrlPlaceholder')}
                onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
              />
            </div>
          ) : (
            <>
              <div>
                <Text style={{ fontSize: 12 }}>{t('skillManagement.mcpTransportStdio')}</Text>
                <Input
                  value={draft.command}
                  placeholder={t('skillManagement.mcpCommandPlaceholder')}
                  onChange={(e) => setDraft((d) => ({ ...d, command: e.target.value }))}
                />
              </div>
              <div>
                <Text style={{ fontSize: 12 }}>{t('skillManagement.mcpArgs')}</Text>
                <Input
                  value={draft.args}
                  placeholder={t('skillManagement.mcpArgsPlaceholder')}
                  onChange={(e) => setDraft((d) => ({ ...d, args: e.target.value }))}
                />
              </div>
            </>
          )}
          <Space>
            <Checkbox
              checked={draft.enabledClaude}
              onChange={(e) => setDraft((d) => ({ ...d, enabledClaude: e.target.checked }))}
            >
              Claude Code
            </Checkbox>
            <Checkbox
              checked={draft.enabledCodex}
              onChange={(e) => setDraft((d) => ({ ...d, enabledCodex: e.target.checked }))}
            >
              Codex
            </Checkbox>
          </Space>
        </Space>
      </Modal>
    </div>
  );
}
