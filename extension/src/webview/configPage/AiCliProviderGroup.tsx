import * as React from 'react';
import { Button, Card, Space, Tag, Tooltip, Typography } from 'antd';
import { BarChartOutlined, EditOutlined, PlusOutlined, QuestionCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import type { TFunction } from 'i18next';
import type { VscodeThemePalette } from '../theme';
import type { ClaudeModelOption, ProviderUsageQueryResult, ProviderAvailabilityResult } from './claudeCodeTypes';
import { inferApiKindFromBaseUrl, isOfficialAnthropicBaseUrl, type AiCliApiKind } from './officialEndpoints';
import type { AiCliProviderRecord } from './aiCliProviderTypes';
import { EMPTY_PROVIDER_DRAFT, isAnthropicProvider } from './aiCliProviderTypes';
import { ProviderEditor } from './AiCliProviderEditor';
import { inferProviderAuthMode } from './providerAuth';
import { supportsProviderUsageQuery } from './providerUsageSupport';

const { Text } = Typography;

export type AiCliProviderGroupProps = {
  t: TFunction;
  palette: VscodeThemePalette;
  role: 'claude' | 'codex';
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
  role,
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
  const NEW_ID = `__new_${role}__`;
  const [showNew, setShowNew] = React.useState(false);
  const [editingIds, setEditingIds] = React.useState<Set<string>>(() => new Set());
  const queriedUsageIds = React.useRef(new Set<string>());
  const isClaude = role === 'claude';
  const filtered = providers.filter((p) =>
    isClaude ? true : !isAnthropicProvider(p)
  );
  const newDraft: AiCliProviderRecord = {
    id: NEW_ID,
    activeClaude: false,
    activeCodex: false,
    ...EMPTY_PROVIDER_DRAFT,
    apiKind: isClaude ? 'anthropic' : 'openai',
    authMode: 'api',
    baseUrl: '',
    name: '',
  };

  React.useEffect(() => {
    const currentIds = new Set(filtered.map((provider) => provider.id));
    for (const id of queriedUsageIds.current) {
      if (!currentIds.has(id)) {
        queriedUsageIds.current.delete(id);
      }
    }
    for (const provider of filtered) {
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
  }, [filtered, onQueryProviderUsage, providerUsage]);

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

  return (
    <div style={{ marginBottom: 16 }}>
      <Space size={5} style={{ marginBottom: 8 }}>
        <Text strong style={{ fontSize: 13 }}>
          {t(isClaude ? 'claudeCodeConfig.providersClaudeDivider' : 'claudeCodeConfig.providersCodexDivider')}
        </Text>
        <Tooltip title={t(isClaude ? 'claudeCodeConfig.providersClaudeHint' : 'claudeCodeConfig.providersCodexHint')}>
          <QuestionCircleOutlined style={{ opacity: 0.65, cursor: 'help' }} />
        </Tooltip>
      </Space>
      <Space direction="vertical" style={{ width: '100%' }} size={10}>
        {filtered.map((p) => {
          const apiKind = p.apiKind ?? inferApiKindFromBaseUrl(p.baseUrl);
          const active = isClaude ? p.activeClaude : p.activeCodex;
          const activeAny = p.activeClaude || p.activeCodex;
          const editing = editingIds.has(p.id);
          const authMode = inferProviderAuthMode(p);
          const canApplyClaude = apiKind !== 'openai' || authMode === 'api';
          const canApplyCodex = apiKind === 'openai';
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
                borderColor: active ? palette.focusBorder : undefined,
                background: active ? palette.codeBlockBackground : undefined,
              }}
              title={
                <Space size={6} wrap>
                  <Text strong style={{ fontSize: 13 }}>{p.name || p.baseUrl || t('claudeCodeConfig.providerUnnamed')}</Text>
                  {apiKind === 'openai' ? (
                    <Tag style={{ margin: 0, fontSize: 10 }}>{t('claudeCodeConfig.providerKindOpenAiCompatible')}</Tag>
                  ) : authMode === 'subscription' && isOfficialAnthropicBaseUrl(p.baseUrl) ? (
                    <Tag color="purple" style={{ margin: 0, fontSize: 10 }}>
                      {t('claudeCodeConfig.providerKindClaudeOfficial')}
                    </Tag>
                  ) : null}
                  {p.activeClaude ? (
                    <Tag color="processing" style={{ margin: 0 }}>
                      {t('claudeCodeConfig.providerActiveClaude')}
                    </Tag>
                  ) : null}
                  {p.activeCodex ? (
                    <Tag color="cyan" style={{ margin: 0 }}>
                      {t('claudeCodeConfig.providerActiveCodex')}
                    </Tag>
                  ) : null}
                  {proxyEnabled && active ? (
                    <Tag color="green" style={{ margin: 0, fontSize: 10 }}>
                      {t(isClaude ? 'claudeCodeConfig.providerGatewayClaude' : 'claudeCodeConfig.providerGatewayCodex')}
                    </Tag>
                  ) : null}
                </Space>
              }
              extra={
                <Space size={6}>
                  {canApplyClaude && !p.activeClaude ? (
                    <Button size="small" onClick={() => onActivate(p.id, 'claude')}>
                      {t('claudeCodeConfig.providerApplyClaude')}
                    </Button>
                  ) : null}
                  {canApplyCodex && !p.activeCodex ? (
                    <Button size="small" onClick={() => onActivate(p.id, 'codex')}>
                      {t('claudeCodeConfig.providerApplyCodex')}
                    </Button>
                  ) : null}
                  <Button size="small" icon={<EditOutlined />} onClick={toggleEditing}>
                    {t(editing ? 'claudeCodeConfig.providerCloseEditor' : 'claudeCodeConfig.providerEdit')}
                  </Button>
                </Space>
              }
            >
              {!editing ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <Text
                    type="secondary"
                    ellipsis={{ tooltip: p.baseUrl || t('claudeCodeConfig.providerSubscriptionDirect') }}
                    style={{ display: 'block', minWidth: 0, fontSize: 11 }}
                  >
                    {p.baseUrl || t('claudeCodeConfig.providerSubscriptionDirect')}
                  </Text>
                  {renderUsage(p)}
                </div>
              ) : (
                <ProviderEditor
                  t={t}
                  palette={palette}
                  editorRole={role}
                  provider={p}
                  models={modelsByProvider[p.id] ?? []}
                  modelsLoading={modelsLoadingByProvider[p.id] ?? false}
                  modelsError={modelsErrorByProvider[p.id] ?? null}
                  availability={availabilityResults[p.baseUrl]}
                  onSave={(provider) => {
                    onSave(provider);
                    toggleEditing();
                  }}
                  onRemove={activeAny ? undefined : () => onRemove(p.id)}
                  onCheckAvailability={onCheckAvailability}
                  onFetchModels={(baseUrl, apiKey, kind) =>
                    onFetchModels(p.id, baseUrl, apiKey, kind ?? apiKind)
                  }
                  onRestartCodex={role === 'codex' ? onRestartCodex : undefined}
                />
              )}
            </Card>
          );
        })}
        {filtered.length === 0 && !showNew ? (
          <Text type="secondary" style={{ fontSize: 11 }}>{t('claudeCodeConfig.providerEmptyRole')}</Text>
        ) : null}
        {showNew ? (
          <Card size="small" title={t('claudeCodeConfig.providerAddTitle')} style={{ borderRadius: 8 }}>
            <ProviderEditor
              t={t}
              palette={palette}
              editorRole={role}
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
                  apiKind: d.apiKind ?? (isClaude ? 'anthropic' : 'openai'),
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
                onFetchModels(NEW_ID, baseUrl, apiKey, kind ?? (isClaude ? 'anthropic' : 'openai'))
              }
              onRestartCodex={role === 'codex' ? onRestartCodex : undefined}
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
            style={{ marginTop: filtered.length > 0 ? 4 : 0 }}
          >
            {t('claudeCodeConfig.providerAdd')}
          </Button>
        )}
      </Space>
    </div>
  );
}
