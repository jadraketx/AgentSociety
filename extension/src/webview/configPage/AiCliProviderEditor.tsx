import * as React from 'react';
import {
  Button,
  Input,
  Popconfirm,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import type { TFunction } from 'i18next';
import type { VscodeThemePalette } from '../theme';
import type { ClaudeModelOption, ProviderAvailabilityResult } from './claudeCodeTypes';
import { getProviderPresetsForRole, CODEX_SUGGESTED_MODELS } from './aiCliProviderPresets';
import {
  isOfficialAnthropicBaseUrl,
  isOfficialOpenAiBaseUrl,
  resolveProviderBaseUrl,
  type AiCliApiKind,
} from './officialEndpoints';
import { ClaudeModelSelect } from './ClaudeModelSelect';
import type { AiCliProviderRecord } from './aiCliProviderTypes';
import { autoMapClaudeRoleModels } from './aiCliProviderTypes';
import { inferProviderAuthMode } from './providerAuth';

const { Text } = Typography;

const CUSTOM_PRESET = 'custom';
const MODEL_FIELDS = [
  { key: 'model' as const, envVar: 'ANTHROPIC_MODEL', labelKey: 'claudeCodeConfig.defaultModel' },
  { key: 'sonnetModel' as const, envVar: 'ANTHROPIC_DEFAULT_SONNET_MODEL', labelKey: 'claudeCodeConfig.sonnetModel' },
  { key: 'opusModel' as const, envVar: 'ANTHROPIC_DEFAULT_OPUS_MODEL', labelKey: 'claudeCodeConfig.opusModel' },
  { key: 'haikuModel' as const, envVar: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', labelKey: 'claudeCodeConfig.haikuModel' },
];
const HINT_STYLE: React.CSSProperties = { display: 'block', fontSize: 11, marginBottom: 6 };
const FIELD_LABEL_STYLE: React.CSSProperties = { fontSize: 11, display: 'block', marginBottom: 4 };

type ProviderEditorProps = {
  t: TFunction;
  palette: VscodeThemePalette;
  editorRole: 'claude' | 'codex';
  provider: AiCliProviderRecord;
  isNew?: boolean;
  models: ClaudeModelOption[];
  modelsLoading: boolean;
  modelsError: string | null;
  availability?: ProviderAvailabilityResult;
  onSave: (p: AiCliProviderRecord) => void;
  onActivate?: (role: 'claude' | 'codex') => void;
  onRemove?: () => void;
  onCheckAvailability: (baseUrl: string, apiKey: string, apiKind: AiCliApiKind) => void;
  onFetchModels: (baseUrl: string, apiKey: string, apiKind?: AiCliApiKind) => void;
  onRestartCodex?: () => void;
};

export function ProviderEditor({
  t,
  palette,
  editorRole,
  provider,
  isNew,
  models,
  modelsLoading,
  modelsError,
  availability,
  onSave,
  onActivate,
  onRemove,
  onCheckAvailability,
  onFetchModels,
  onRestartCodex,
}: ProviderEditorProps) {
  const [draft, setDraft] = React.useState(provider);

  React.useEffect(() => {
    setDraft(provider);
  }, [provider]);

  const apiKind = editorRole === 'codex' ? 'openai' : (draft.apiKind ?? 'anthropic');
  const rolePresets =
    editorRole === 'claude' && apiKind === 'openai'
      ? getProviderPresetsForRole('codex')
      : getProviderPresetsForRole(editorRole);
  const resolvedBase = resolveProviderBaseUrl(draft.baseUrl, apiKind);
  const isOfficialUrl = (baseUrl: string) => {
    const trimmed = baseUrl.trim();
    if (!trimmed) {
      return false;
    }
    return apiKind === 'openai' ? isOfficialOpenAiBaseUrl(trimmed) : isOfficialAnthropicBaseUrl(trimmed);
  };
  const officialUrl = isOfficialUrl(draft.baseUrl);
  const authMode = inferProviderAuthMode({ ...draft, apiKind });
  const isSubscription = authMode === 'subscription';
  const matchedPreset =
    rolePresets.find(
      (p) => p.url === draft.baseUrl.trim() || p.url === resolvedBase
    )?.id ?? CUSTOM_PRESET;

  const presetOptions = [
    ...rolePresets.map((p) => ({
      value: p.id,
      label: t(`claudeCodeConfig.baseUrlPresets.${p.id}`),
    })),
    { value: CUSTOM_PRESET, label: t('claudeCodeConfig.baseUrlCustom') },
  ];

  const canFetch = Boolean(draft.apiKey.trim()) && !isSubscription;
  const isCodex = editorRole === 'codex';

  const patch = (partial: Partial<AiCliProviderRecord>) => {
    setDraft((prev) => ({ ...prev, ...partial }));
  };

  const handleAutoMap = () => {
    if (models.length === 0) {
      return;
    }
    patch(autoMapClaudeRoleModels(models, draft));
  };

  const availabilityTag = () => {
    if (!availability) {
      return null;
    }
    if (!availability.ok) {
      const errorKey = availability.error
        ? `claudeCodeConfig.modelsFetchErrors.${availability.error}`
        : '';
      const errorText =
        errorKey && t(errorKey) !== errorKey
          ? t(errorKey)
          : availability.error ?? t('claudeCodeConfig.providerUnavailable');
      return (
        <Tag color="error" style={{ margin: 0, fontSize: 11 }}>
          <CloseCircleOutlined /> {errorText}
        </Tag>
      );
    }
    return (
      <Tag color="success" style={{ margin: 0, fontSize: 11 }}>
        <CheckCircleOutlined /> {t('claudeCodeConfig.providerAvailable', { count: availability.models })}
      </Tag>
    );
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={8}>
      <Input
        size="small"
        placeholder={t('claudeCodeConfig.providerNamePlaceholder')}
        value={draft.name}
        onChange={(e) => patch({ name: e.target.value })}
      />
      {editorRole === 'claude' ? (
        <Select
          size="small"
          value={apiKind}
          style={{ width: '100%' }}
          options={[
            { value: 'anthropic', label: t('claudeCodeConfig.providerKindClaude') },
            { value: 'openai', label: t('claudeCodeConfig.providerKindOpenAiCompatible') },
          ]}
          onChange={(value) => patch({
            apiKind: value,
            baseUrl: '',
            authMode: value === 'openai' ? 'api' : draft.authMode,
            model: '',
            sonnetModel: value === 'openai' ? '' : draft.sonnetModel,
            opusModel: value === 'openai' ? '' : draft.opusModel,
            haikuModel: value === 'openai' ? '' : draft.haikuModel,
          })}
        />
      ) : null}
      {editorRole === 'claude' && apiKind === 'openai' ? (
        <Text type="secondary" style={{ fontSize: 11 }}>
          {t('claudeCodeConfig.providerClaudeOpenAiBridgeHint')}
        </Text>
      ) : null}
      <Space.Compact style={{ width: '100%' }}>
        <Select
          size="small"
          value={matchedPreset}
          options={presetOptions}
          style={{ width: 140, flexShrink: 0 }}
          popupMatchSelectWidth={false}
          onChange={(id) => {
            if (id === CUSTOM_PRESET) {
              patch({
                baseUrl: '',
                apiKind,
                authMode: 'api',
                name: draft.name.trim() ? draft.name : '',
              });
              return;
            }
            const preset = rolePresets.find((p) => p.id === id);
            if (preset) {
              patch({
                baseUrl: preset.url,
                apiKind: preset.apiKind,
                authMode: preset.official ? 'subscription' : 'api',
                name: draft.name.trim()
                  ? draft.name
                  : t(`claudeCodeConfig.baseUrlPresets.${preset.id}`),
              });
            }
          }}
        />
        <Input
          size="small"
          placeholder={
            isCodex
              ? isOfficialUrl(draft.baseUrl)
                ? t('claudeCodeConfig.providerUrlPlaceholderOpenAi')
                : t('claudeCodeConfig.providerUrlPlaceholderCodex')
              : isOfficialUrl(draft.baseUrl)
                ? t('claudeCodeConfig.providerUrlOfficialAnthropic')
                : t('claudeCodeConfig.providerUrlPlaceholder')
          }
          value={draft.baseUrl}
          onChange={(e) => {
            const nextBaseUrl = e.target.value;
            const nextOfficial = isOfficialUrl(nextBaseUrl);
            patch({
              baseUrl: nextBaseUrl,
              apiKind,
              authMode: nextOfficial && draft.authMode !== 'api' ? 'subscription' : 'api',
            });
          }}
        />
      </Space.Compact>
      {apiKind === 'openai' ? (
        <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>
          {t('claudeCodeConfig.providerKindOpenAiCompatible')}
        </Tag>
      ) : isOfficialUrl(draft.baseUrl) ? (
        <Tag color="purple" style={{ margin: 0, fontSize: 10 }}>
          {t('claudeCodeConfig.providerKindClaudeOfficial')}
        </Tag>
      ) : null}
      {isSubscription ? (
        <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
          {isCodex
            ? t('claudeCodeConfig.providerCodexSubscriptionHint')
            : t('claudeCodeConfig.providerClaudeSubscriptionHint')}
        </Text>
      ) : null}
      {officialUrl ? (
        <Select
          size="small"
          value={authMode}
          style={{ width: '100%' }}
          options={[
            {
              value: 'subscription',
              label: t(isCodex ? 'claudeCodeConfig.providerAuthCodexLogin' : 'claudeCodeConfig.providerAuthClaudeLogin'),
            },
            { value: 'api', label: t('claudeCodeConfig.providerAuthApiKey') },
          ]}
          onChange={(value) => patch({ authMode: value })}
        />
      ) : null}
      {!isSubscription ? (
        <Input.Password
          size="small"
          placeholder={t('claudeCodeConfig.providerKeyPlaceholder')}
          value={draft.apiKey}
          onChange={(e) => patch({ apiKey: e.target.value, authMode: 'api' })}
          autoComplete="off"
        />
      ) : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <Button
          size="small"
          icon={<CheckCircleOutlined />}
          onClick={() => onCheckAvailability(draft.baseUrl, draft.apiKey, apiKind)}
          disabled={!canFetch}
        >
          {t('claudeCodeConfig.providerCheckAvailability')}
        </Button>
        {availabilityTag()}
      </div>

      {!isCodex ? (
        <>
          <Text strong style={{ fontSize: 12 }}>{t('claudeCodeConfig.modelMapping')}</Text>
          <Text type="secondary" style={HINT_STYLE}>
            {t('claudeCodeConfig.modelHotSwitchClaudeHint')}
          </Text>
          <Text type="secondary" style={HINT_STYLE}>
            {t('claudeCodeConfig.modelContextClaudeHint')}
          </Text>
          <Space size={8} wrap>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={modelsLoading}
              disabled={!canFetch}
              onClick={() => onFetchModels(draft.baseUrl, draft.apiKey, apiKind)}
            >
              {t('claudeCodeConfig.fetchModels')}
            </Button>
            <Button size="small" icon={<ReloadOutlined />} disabled={models.length === 0} onClick={handleAutoMap}>
              {t('claudeCodeConfig.autoMapModels')}
            </Button>
            {modelsError ? (
              <Tag color="error" style={{ margin: 0 }}>{t('claudeCodeConfig.modelsFetchFailed')}</Tag>
            ) : models.length > 0 ? (
              <Tag color="success" style={{ margin: 0 }}>{t('claudeCodeConfig.modelsCount', { count: models.length })}</Tag>
            ) : null}
          </Space>

          {MODEL_FIELDS.map((field) => (
            <div key={field.key}>
              <Text type="secondary" style={FIELD_LABEL_STYLE}>
                {t(field.labelKey)}
              </Text>
              <ClaudeModelSelect
                models={models}
                value={draft[field.key] ?? ''}
                onChange={(v) => patch({ [field.key]: v })}
                placeholder={t('claudeCodeConfig.selectOrManual')}
                disabled={modelsLoading}
              />
            </div>
          ))}

          <div>
            <Text type="secondary" style={FIELD_LABEL_STYLE}>
              {t('claudeCodeConfig.permissionMode')}
            </Text>
            <Select
              size="small"
              style={{ width: '100%' }}
              allowClear
              value={draft.permissionMode || undefined}
              placeholder={t('claudeCodeConfig.permissionModePlaceholder')}
              onChange={(v) => patch({ permissionMode: v ?? '' })}
              options={[
                { value: '', label: t('claudeCodeConfig.permissionModeDefault') },
                { value: 'bypassPermissions', label: t('claudeCodeConfig.permissionModeBypass') },
              ]}
            />
          </div>
        </>
      ) : (
        <>
          <Text type="secondary" style={HINT_STYLE}>
            {t('claudeCodeConfig.providerOpenAiHint')}
          </Text>
          <Text strong style={{ fontSize: 12 }}>{t('claudeCodeConfig.providerCodexModel')}</Text>
          <Text type="secondary" style={HINT_STYLE}>
            {t('claudeCodeConfig.providerCodexModelConfigHint')}
          </Text>
          <Text type="secondary" style={HINT_STYLE}>
            {t('claudeCodeConfig.modelHotSwitchCodexHint')}
          </Text>
          {!isSubscription ? (
            <Text type="secondary" style={HINT_STYLE}>
              {t('claudeCodeConfig.providerCodexModelUpstreamHint')}
            </Text>
          ) : null}
          <Space size={8} wrap style={{ marginBottom: 6 }}>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={modelsLoading}
              disabled={!canFetch}
              onClick={() => onFetchModels(draft.baseUrl, draft.apiKey, 'openai')}
            >
              {t('claudeCodeConfig.fetchModels')}
            </Button>
            {onRestartCodex ? (
              <Button size="small" icon={<ReloadOutlined />} onClick={onRestartCodex}>
                {t('claudeCodeConfig.restartCodex')}
              </Button>
            ) : null}
            {models.length > 0 ? (
              <Tag color="success" style={{ margin: 0 }}>{t('claudeCodeConfig.modelsCount', { count: models.length })}</Tag>
            ) : isSubscription ? (
              <Tag style={{ margin: 0, fontSize: 10 }}>{t('claudeCodeConfig.providerCodexModelSubscriptionDefault')}</Tag>
            ) : null}
            {modelsError ? (
              <Tag color="error" style={{ margin: 0, fontSize: 10, maxWidth: 360, whiteSpace: 'normal' }}>
                {modelsError}
              </Tag>
            ) : null}
          </Space>
          <ClaudeModelSelect
            models={models.length > 0 ? models : CODEX_SUGGESTED_MODELS}
            value={draft.model ?? ''}
            onChange={(v) => patch({ model: v })}
            placeholder={t('claudeCodeConfig.providerCodexModelPlaceholder')}
            disabled={modelsLoading}
          />
        </>
      )}

      <Space wrap>
        <Button
          size="small"
          type="primary"
          icon={<SaveOutlined />}
          disabled={!isSubscription && !canFetch}
          onClick={() =>
            onSave({
              ...draft,
              apiKind,
              authMode: officialUrl
                ? authMode
                : inferProviderAuthMode({ ...draft, apiKind, authMode: 'api' }),
              ...(isCodex
                ? { sonnetModel: '', opusModel: '', haikuModel: '', permissionMode: '' }
                : {}),
            })
          }
        >
          {isNew ? t('claudeCodeConfig.providerAdd') : t('claudeCodeConfig.providerSave')}
        </Button>
        {!isNew && onActivate && editorRole === 'claude' && !provider.activeClaude ? (
          <Button size="small" onClick={() => onActivate('claude')}>
            {t('claudeCodeConfig.providerSwitchClaude')}
          </Button>
        ) : null}
        {!isNew && onActivate && editorRole === 'codex' && !provider.activeCodex ? (
          <Button size="small" onClick={() => onActivate('codex')}>
            {t('claudeCodeConfig.providerSwitchCodex')}
          </Button>
        ) : null}
        {!isNew && onRemove ? (
          <Popconfirm title={t('claudeCodeConfig.providerRemoveConfirm')} onConfirm={onRemove}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        ) : null}
      </Space>
    </Space>
  );
}
