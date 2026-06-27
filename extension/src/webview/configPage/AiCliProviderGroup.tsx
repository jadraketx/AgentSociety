import * as React from 'react';
import { Button, Card, Space, Switch, Tag, Tooltip, Typography } from 'antd';
import { BarChartOutlined, EditOutlined, PlusOutlined, QuestionCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import type { TFunction } from 'i18next';
import type { VscodeThemePalette } from '../theme';
import type { ClaudeModelOption, ProviderUsageQueryResult, ProviderAvailabilityResult } from './claudeCodeTypes';
import { inferApiKindFromBaseUrl, isOfficialAnthropicBaseUrl, type AiCliApiKind } from './officialEndpoints';
import type { AiCliProviderRecord } from './aiCliProviderTypes';
import { EMPTY_PROVIDER_DRAFT } from './aiCliProviderTypes';
import { ProviderEditor } from './AiCliProviderEditor';
import { inferProviderAuthMode } from './providerAuth';
import { supportsProviderUsageQuery } from './providerUsageSupport';

const { Text } = Typography;

export type ProviderRole = 'claude' | 'codex' | 'unified';

export type AiCliProviderGroupProps = {
  t: TFunction;
  palette: VscodeThemePalette;
  role: ProviderRole;
  providers: AiCliProviderRecord[];
  loading: boolean;
  proxyEnabled: boolean;
  onSave: (provider: AiCliProviderRecord) => void;
  onAdd: (draft: Omit<AiCliProviderRecord, 'id' | 'activeClaude' | 'activeCodex'>) => void;
  onActivate: (id: string, role: 'claude' | 'codex') => void;
  onRemove: (id: string) => void;
  onCheckAvailability: (baseUrl: string, apiKey: string, apiKind?: AiCliApiKind) => void;
  availabilityResults: Record<string, ProviderAvailabilityResult>;
  providerUsage: Record<string, ProviderUsageQueryResult & { loading?: boolean }>;
  onQueryProviderUsage: (id: string) => void;
  modelsByProvider: Record<string, ClaudeModelOption[]>;
  modelsLoadingByProvider: Record<string, boolean>;
  modelsErrorByProvider: Record<string, string | null>;
  onFetchModels: (providerId: string, baseUrl: string, apiKey: string, apiKind?: AiCliApiKind) => void;
  onRestartCodex?: () => void;
};

export function AiCliProviderGroup({
  t,
  palette,
  providers,
  loading,
  proxyEnabled,
  onSave,
  onAdd,
  onActivate,
  onRemove,
  onCheckAvailability,
  availabilityResults,
  providerUsage,
  onQueryProviderUsage,
  modelsByProvider,
  modelsLoadingByProvider,
  modelsErrorByProvider,
  onFetchModels,
  onRestartCodex,
}: AiCliProviderGroupProps) {
  const NEW_ID = `__new__`;
  const [showNew, setShowNew] = React.useState(false);
  const [newApiKind, setNewApiKind] = React.useState<'anthropic' | 'openai'>('anthropic');
  const [editingIds, setEditingIds] = React.useState<Set<string>>(() => new Set());
  const queriedUsageIds = React.useRef(new Set<string>());

  React.useEffect(() => {
    const currentIds = new Set(providers.map((p) => p.id));
    for (const id of queriedUsageIds.current) {
      if (!currentIds.has(id)) {
        queriedUsageIds.current.delete(id);
      }
    }
    for (const provider of providers) {
      const apiKind = provider.apiKind ?? inferApiKindFromBaseUrl(provider.baseUrl);
      const supported = supportsProviderUsageQuery(provider.baseUrl, {
        apiKind,
        authMode: inferProviderAuthMode(provider),
      });
      if (supported && !providerUsage[provider.id] && !queriedUsageIds.current.has(provider.id)) {
        queriedUsageIds.current.add(provider.id);
        onQueryProviderUsage(provider.id);
      }
    }
  }, [providers, onQueryProviderUsage, providerUsage]);

  const renderUsage = (provider: AiCliProviderRecord) => {
    const apiKind = provider.apiKind ?? inferApiKindFromBaseUrl(provider.baseUrl);
    if (!supportsProviderUsageQuery(provider.baseUrl, {
      apiKind,
      authMode: inferProviderAuthMode(provider),
    })) {
      return null;
    }
    const usage = providerUsage[provider.id];
    const refresh = (
      <Button
        type="text"
        size="small"
        loading={usage?.loading}
        icon={<ReloadOutlined />}
        aria-label={t('claudeCodeConfig.providerQueryQuota')}
        onClick={() => onQueryProviderUsage(provider.id)}
      />
    );
    if (usage?.ok && usage.summary) {
      return (
        <Space size={4}>
          <BarChartOutlined style={{ color: palette.linkForeground }} />
          <Tooltip title={usage.plans?.map((plan) => `${plan.name}: ${plan.remaining}`).join('\n')}>
            <Text style={{ fontSize: 11 }}>{usage.summary}</Text>
          </Tooltip>
          {refresh}
        </Space>
      );
    }
    if (usage && !usage.ok && usage.error) {
      const errorKey = `claudeCodeConfig.providerUsageErrors.${usage.error}`;
      const errorText = t(errorKey) !== errorKey ? t(errorKey) : usage.error;
      return (
        <Space size={4}>
          <Tooltip title={errorText}>
            <Tag color="error" style={{ margin: 0, fontSize: 10 }}>{errorText}</Tag>
          </Tooltip>
          {refresh}
        </Space>
      );
    }
    return (
      <Space size={4}>
        <Text type="secondary" style={{ fontSize: 11 }}>
          {usage?.loading
            ? t('claudeCodeConfig.providerQuotaLoading')
            : t('claudeCodeConfig.providerQueryQuota')}
        </Text>
        {refresh}
      </Space>
    );
  };

  // Compact role toggle row: Claude/Codex primary switch only
  const renderRoleToggles = (provider: AiCliProviderRecord) => {
    const apiKind = provider.apiKind ?? inferApiKindFromBaseUrl(provider.baseUrl);
    const isOpenAi = apiKind === 'openai';
    const hasCredentials = inferProviderAuthMode(provider) === 'api' || provider.apiKey.trim();

    const roleSwitch = (label: string, active: boolean, isApplicable: boolean) => {
      if (!isApplicable) {
        return (
          <Text type="secondary" style={{ fontSize: 10, width: 130 }}>
            {t('claudeCodeConfig.providerCodexNotSupported')}
          </Text>
        );
      }
      return (
        <Tooltip title={!hasCredentials ? t('claudeCodeConfig.providerNeedCredentialsHint') : undefined}>
          <Space size={4}>
            <Switch
              size="small"
              checked={active}
              disabled={!hasCredentials}
              onChange={() => onActivate(provider.id, label === 'Claude' ? 'claude' : 'codex')}
            />
            <Text style={{ fontSize: 11, color: active ? palette.linkForeground : palette.descriptionForeground, minWidth: 40 }}>
              {label}
            </Text>
            {active ? (
              <Tag color="blue" style={{ margin: 0, fontSize: 10, lineHeight: '16px' }}>
                {t('claudeCodeConfig.providerRolePrimary')}
              </Tag>
            ) : null}
          </Space>
        </Tooltip>
      );
    };

    return (
      <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
        {roleSwitch('Claude', provider.activeClaude, true)}
        {roleSwitch('Codex', provider.activeCodex, isOpenAi)}
      </div>
    );
  };

  const newDraft: AiCliProviderRecord = {
    id: NEW_ID,
    activeClaude: false,
    activeCodex: false,
    ...EMPTY_PROVIDER_DRAFT,
    apiKind: newApiKind,
    authMode: 'api',
    baseUrl: '',
    name: '',
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <Space size={5} style={{ marginBottom: 8 }}>
        <Text strong style={{ fontSize: 13 }}>
          {t('claudeCodeConfig.providersDivider')}
        </Text>
        <Tooltip title={t('claudeCodeConfig.providerCenterHint')}>
          <QuestionCircleOutlined style={{ opacity: 0.65, cursor: 'help' }} />
        </Tooltip>
      </Space>
      <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 10 }}>
        {t('claudeCodeConfig.providerListHint')}
      </Text>
      <Space direction="vertical" style={{ width: '100%' }} size={10}>
        {providers.map((p) => {
          const apiKind = p.apiKind ?? inferApiKindFromBaseUrl(p.baseUrl);
          const isOpenAi = apiKind === 'openai';
          const authMode = inferProviderAuthMode(p);
          const editing = editingIds.has(p.id);
          const hasAnyActive = p.activeClaude || p.activeCodex;
          const toggleEditing = () => {
            setEditingIds((current) => {
              const next = new Set(current);
              if (next.has(p.id)) {
                next.delete(p.id);
              } else {
                next.add(p.id);
              }
              return next;
            });
          };

          return (
            <Card
              key={p.id}
              size="small"
              style={{
                borderRadius: 8,
                borderColor: hasAnyActive ? palette.focusBorder : undefined,
                background: hasAnyActive ? palette.codeBlockBackground : undefined,
              }}
              title={
                <Space size={6} wrap>
                  <Text strong style={{ fontSize: 13 }}>{p.name || p.baseUrl || t('claudeCodeConfig.providerUnnamed')}</Text>
                  {isOpenAi ? (
                    <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>{t('claudeCodeConfig.providerKindOpenAi')}</Tag>
                  ) : authMode === 'subscription' && isOfficialAnthropicBaseUrl(p.baseUrl) ? (
                    <Tag color="purple" style={{ margin: 0, fontSize: 10 }}>
                      {t('claudeCodeConfig.providerKindClaudeOfficial')}
                    </Tag>
                  ) : null}
                  {hasAnyActive && proxyEnabled ? (
                    <Tag color="green" style={{ margin: 0, fontSize: 10 }}>
                      {t('claudeCodeConfig.providerGatewayActive')}
                    </Tag>
                  ) : null}
                </Space>
              }
              extra={
                <Button size="small" icon={<EditOutlined />} onClick={toggleEditing}>
                  {t(editing ? 'claudeCodeConfig.providerCloseEditor' : 'claudeCodeConfig.providerEdit')}
                </Button>
              }
            >
              {!editing ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                    <Text
                      type="secondary"
                      ellipsis={{ tooltip: p.baseUrl || t('claudeCodeConfig.providerSubscriptionDirect') }}
                      style={{ display: 'block', minWidth: 0, fontSize: 11 }}
                    >
                      {p.baseUrl || t('claudeCodeConfig.providerSubscriptionDirect')}
                    </Text>
                    {renderUsage(p)}
                  </div>
                  {renderRoleToggles(p)}
                </div>
              ) : (
                <ProviderEditor
                  t={t}
                  palette={palette}
                  editorRole={isOpenAi ? 'codex' : 'claude'}
                  provider={p}
                  models={modelsByProvider[p.id] ?? []}
                  modelsLoading={modelsLoadingByProvider[p.id] ?? false}
                  modelsError={modelsErrorByProvider[p.id] ?? null}
                  availability={availabilityResults[p.baseUrl]}
                  onSave={(provider) => {
                    onSave(provider);
                    toggleEditing();
                  }}
                  onRemove={hasAnyActive ? undefined : () => onRemove(p.id)}
                  onCheckAvailability={onCheckAvailability}
                  onFetchModels={(baseUrl, apiKey, kind) =>
                    onFetchModels(p.id, baseUrl, apiKey, kind ?? apiKind)
                  }
                  onRestartCodex={isOpenAi ? onRestartCodex : undefined}
                />
              )}
            </Card>
          );
        })}
        {providers.length === 0 && !showNew ? (
          <Text type="secondary" style={{ fontSize: 11 }}>{t('claudeCodeConfig.providerEmpty')}</Text>
        ) : null}
        {showNew ? (
          <Card size="small" title={t('claudeCodeConfig.providerAddTitle')} style={{ borderRadius: 8 }}>
            <Space size={6} style={{ marginBottom: 8 }}>
              <Button
                size="small"
                type={newApiKind === 'anthropic' ? 'primary' : 'default'}
                onClick={() => setNewApiKind('anthropic')}
              >
                {t('claudeCodeConfig.providerKindClaude')}
              </Button>
              <Button
                size="small"
                type={newApiKind === 'openai' ? 'primary' : 'default'}
                onClick={() => setNewApiKind('openai')}
              >
                {t('claudeCodeConfig.providerKindOpenAi')}
              </Button>
            </Space>
            <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 8 }}>
              {t('claudeCodeConfig.providerAddHint')}
            </Text>
            <ProviderEditor
              t={t}
              palette={palette}
              editorRole={newApiKind === 'openai' ? 'codex' : 'claude'}
              provider={newDraft}
              isNew
              models={modelsByProvider[NEW_ID] ?? []}
              modelsLoading={modelsLoadingByProvider[NEW_ID] ?? false}
              modelsError={modelsErrorByProvider[NEW_ID] ?? null}
              onSave={(d) => {
                onAdd({
                  name: d.name,
                  baseUrl: d.baseUrl,
                  apiKey: d.apiKey,
                  apiKind: newApiKind,
                  authMode: d.authMode,
                  model: d.model,
                  sonnetModel: d.sonnetModel,
                  opusModel: d.opusModel,
                  haikuModel: d.haikuModel,
                  permissionMode: d.permissionMode,
                });
                setShowNew(false);
              }}
              onCheckAvailability={onCheckAvailability}
              onFetchModels={(baseUrl, apiKey, kind) =>
                onFetchModels(NEW_ID, baseUrl, apiKey, kind ?? newApiKind)
              }
              onRestartCodex={newApiKind === 'openai' ? onRestartCodex : undefined}
            />
            <Button size="small" type="link" onClick={() => setShowNew(false)} style={{ marginTop: 4, padding: 0 }}>
              {t('claudeCodeConfig.providerCancelAdd')}
            </Button>
          </Card>
        ) : (
          <Button
            type="dashed"
            block
            icon={<PlusOutlined />}
            onClick={() => setShowNew(true)}
            style={{ marginTop: providers.length > 0 ? 4 : 0 }}
          >
            {t('claudeCodeConfig.providerAdd')}
          </Button>
        )}
      </Space>
    </div>
  );
}