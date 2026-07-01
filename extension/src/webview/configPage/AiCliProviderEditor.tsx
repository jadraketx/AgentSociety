import * as React from 'react';
import {
  Alert,
  Button,
  Checkbox,
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
  type AiCliApiKind,
} from './officialEndpoints';
import { ClaudeModelSelect } from './ClaudeModelSelect';
import type { AiCliProviderRecord } from './aiCliProviderTypes';
import { autoMapClaudeRoleModels } from './aiCliProviderTypes';
import { inferProviderAuthMode } from './providerAuth';

const { Text } = Typography;

const CUSTOM_PRESET = 'custom';
const MODEL_FIELDS = [
  { key: 'model' as const, labelKey: 'claudeCodeConfig.defaultModel', hintKey: 'claudeCodeConfig.modelDefaultHint' },
  { key: 'sonnetModel' as const, labelKey: 'claudeCodeConfig.sonnetModel', hintKey: 'claudeCodeConfig.modelSonnetHint' },
  { key: 'opusModel' as const, labelKey: 'claudeCodeConfig.opusModel', hintKey: 'claudeCodeConfig.modelOpusHint' },
  { key: 'haikuModel' as const, labelKey: 'claudeCodeConfig.haikuModel', hintKey: 'claudeCodeConfig.modelHaikuHint' },
];

const sectionStyle = (palette: VscodeThemePalette): React.CSSProperties => ({
  borderTop: `1px solid ${palette.panelBorder}`,
  paddingTop: 10,
});

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  display: 'block',
  marginBottom: 4,
};

type ProviderEditorProps = {
  t: TFunction;
  palette: VscodeThemePalette;
  provider: AiCliProviderRecord;
  isNew?: boolean;
  models: ClaudeModelOption[];
  modelsLoading: boolean;
  modelsError: string | null;
  availability?: ProviderAvailabilityResult;
  availabilityResults?: Record<string, ProviderAvailabilityResult>;
  onSave: (p: AiCliProviderRecord) => void;
  onActivate?: (role: 'claude' | 'codex') => void;
  onRemove?: () => void;
  onCheckAvailability: (baseUrl: string, apiKey: string, apiKind?: AiCliApiKind) => void;
  onFetchModels: (baseUrl: string, apiKey: string, apiKind?: AiCliApiKind) => void;
  onRestartCodex?: () => void;
};

export function ProviderEditor({
  t,
  palette,
  provider,
  isNew,
  models,
  modelsLoading,
  modelsError,
  availability,
  availabilityResults,
  onSave,
  onActivate,
  onRemove,
  onCheckAvailability,
  onFetchModels,
  onRestartCodex,
}: ProviderEditorProps) {
  const [draft, setDraft] = React.useState(provider);
  const providerIdRef = React.useRef(provider.id);

  React.useEffect(() => {
    if (providerIdRef.current !== provider.id) {
      providerIdRef.current = provider.id;
      setDraft(provider);
    }
  }, [provider]);

  const presets = React.useMemo(() => {
    const seen = new Set<string>();
    return [...getProviderPresetsForRole('claude'), ...getProviderPresetsForRole('codex')]
      .filter((preset) => {
        if (seen.has(preset.url)) {
          return false;
        }
        seen.add(preset.url);
        return true;
      });
  }, []);

  const patch = (partial: Partial<AiCliProviderRecord>) => {
    setDraft((prev) => ({ ...prev, ...partial }));
  };

  const isOfficialUrl = (baseUrl: string) => {
    const trimmed = baseUrl.trim();
    return Boolean(trimmed) && (isOfficialOpenAiBaseUrl(trimmed) || isOfficialAnthropicBaseUrl(trimmed));
  };
  const officialUrl = isOfficialUrl(draft.baseUrl);
  const effectiveAvailability = availabilityResults?.[draft.baseUrl.trim()] ?? availability;
  const effectiveDetectedApiKind = effectiveAvailability?.ok ? effectiveAvailability.apiKind : draft.apiKind;
  const authMode = inferProviderAuthMode({ ...draft, apiKind: effectiveDetectedApiKind });
  const isSubscription = authMode === 'subscription';
  const canUseApi = isSubscription || Boolean(draft.apiKey.trim());
  const canProbe = Boolean(draft.baseUrl.trim()) && Boolean(draft.apiKey.trim()) && !isSubscription;
  const canSave = isSubscription || (Boolean(draft.baseUrl.trim()) && Boolean(draft.apiKey.trim()));
  const matchedPreset = presets.find((p) => p.url === draft.baseUrl.trim())?.id ?? CUSTOM_PRESET;
  const selectedForClaude = draft.activeClaude;
  const selectedForCodex = draft.activeCodex;

  const presetOptions = [
    ...presets.map((p) => ({
      value: p.id,
      label: t(`claudeCodeConfig.baseUrlPresets.${p.id}`),
    })),
    { value: CUSTOM_PRESET, label: t('claudeCodeConfig.baseUrlCustom') },
  ];

  const protocolTag = () => {
    if (!effectiveDetectedApiKind) {
      return <Tag style={{ margin: 0, fontSize: 10 }}>{t('claudeCodeConfig.providerProtocolAuto')}</Tag>;
    }
    return (
      <Tag color={effectiveDetectedApiKind === 'openai' ? 'blue' : 'purple'} style={{ margin: 0, fontSize: 10 }}>
        {effectiveDetectedApiKind === 'openai'
          ? t('claudeCodeConfig.providerProtocolOpenAiDetected')
          : t('claudeCodeConfig.providerProtocolAnthropicDetected')}
      </Tag>
    );
  };

  const availabilityTag = () => {
    if (!effectiveAvailability) {
      return <Tag style={{ margin: 0, fontSize: 10 }}>{t('claudeCodeConfig.providerCheckNotRun')}</Tag>;
    }
    if (!effectiveAvailability.ok) {
      const errorKey = effectiveAvailability.error ? `claudeCodeConfig.modelsFetchErrors.${effectiveAvailability.error}` : '';
      const errorText =
        errorKey && t(errorKey) !== errorKey
          ? t(errorKey)
          : effectiveAvailability.error ?? t('claudeCodeConfig.providerUnavailable');
      return (
        <Tag color="error" style={{ margin: 0, fontSize: 11 }}>
          <CloseCircleOutlined /> {errorText}
        </Tag>
      );
    }
    return (
      <Tag color="success" style={{ margin: 0, fontSize: 11 }}>
        <CheckCircleOutlined /> {t('claudeCodeConfig.providerAvailableWithProtocol', {
          count: effectiveAvailability.models,
          protocol: effectiveAvailability.apiKind === 'openai'
            ? t('claudeCodeConfig.providerProtocolOpenAiDetected')
            : t('claudeCodeConfig.providerProtocolAnthropicDetected'),
        })}
      </Tag>
    );
  };

  const handlePresetChange = (id: string) => {
    if (id === CUSTOM_PRESET) {
      patch({
        name: draft.name.trim() ? draft.name : '',
        baseUrl: '',
        apiKind: undefined,
        authMode: 'api',
      });
      return;
    }
    const preset = presets.find((p) => p.id === id);
    if (!preset) {
      return;
    }
    patch({
      baseUrl: preset.url,
      apiKind: preset.apiKind,
      authMode: preset.official ? 'subscription' : 'api',
      name: draft.name.trim() ? draft.name : t(`claudeCodeConfig.baseUrlPresets.${preset.id}`),
      activeClaude: draft.activeClaude || preset.apiKind === 'anthropic',
      activeCodex: draft.activeCodex || preset.apiKind === 'openai',
    });
  };

  const handleAutoMap = () => {
    if (models.length === 0) {
      return;
    }
    patch(autoMapClaudeRoleModels(models, draft));
  };

  const save = () => {
    const finalKind = effectiveDetectedApiKind ?? draft.apiKind;
    onSave({
      ...draft,
      apiKind: finalKind,
      authMode: officialUrl
        ? authMode
        : inferProviderAuthMode({ ...draft, apiKind: finalKind, authMode: 'api' }),
    });
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Alert
        type="info"
        showIcon
        message={t('claudeCodeConfig.providerEditorTitle')}
        description={t('claudeCodeConfig.providerEditorHint')}
      />

      <div>
        <Text strong style={{ fontSize: 12 }}>{t('claudeCodeConfig.providerConnectionSection')}</Text>
        <Text type="secondary" style={{ display: 'block', fontSize: 11, margin: '2px 0 8px' }}>
          {t('claudeCodeConfig.providerConnectionHint')}
        </Text>
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          <Input
            size="small"
            placeholder={t('claudeCodeConfig.providerNamePlaceholder')}
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
          <Space.Compact style={{ width: '100%' }}>
            <Select
              size="small"
              value={matchedPreset}
              options={presetOptions}
              style={{ width: 168, flexShrink: 0 }}
              popupMatchSelectWidth={false}
              onChange={handlePresetChange}
            />
            <Input
              size="small"
              placeholder={t('claudeCodeConfig.providerUrlPlaceholder')}
              value={draft.baseUrl}
              onChange={(e) => {
                const nextBaseUrl = e.target.value;
                const matched = presets.find((p) => p.url === nextBaseUrl.trim());
                patch({
                  baseUrl: nextBaseUrl,
                  apiKind: matched?.apiKind,
                  authMode: isOfficialUrl(nextBaseUrl) && draft.authMode !== 'api' ? 'subscription' : 'api',
                });
              }}
            />
          </Space.Compact>
          <Space size={6} wrap>
            {protocolTag()}
            <Tag color={isSubscription ? 'gold' : 'default'} style={{ margin: 0, fontSize: 10 }}>
              {isSubscription ? t('claudeCodeConfig.providerAuthSubscription') : t('claudeCodeConfig.providerAuthApiKey')}
            </Tag>
            {availabilityTag()}
          </Space>
          {officialUrl ? (
            <Select
              size="small"
              value={authMode}
              style={{ width: '100%' }}
              options={[
                {
                  value: 'subscription',
                  label: t(isOfficialOpenAiBaseUrl(draft.baseUrl) ? 'claudeCodeConfig.providerAuthCodexLogin' : 'claudeCodeConfig.providerAuthClaudeLogin'),
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
          ) : (
            <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
              {isOfficialOpenAiBaseUrl(draft.baseUrl)
                ? t('claudeCodeConfig.providerCodexSubscriptionHint')
                : t('claudeCodeConfig.providerClaudeSubscriptionHint')}
            </Text>
          )}
          <Space size={8} wrap>
            <Button
              size="small"
              icon={<CheckCircleOutlined />}
              onClick={() => onCheckAvailability(draft.baseUrl, draft.apiKey)}
              disabled={!canProbe}
            >
              {t('claudeCodeConfig.providerCheckAvailability')}
            </Button>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={modelsLoading}
              disabled={!canProbe}
              onClick={() => onFetchModels(draft.baseUrl, draft.apiKey)}
            >
              {t('claudeCodeConfig.fetchModels')}
            </Button>
          </Space>
        </Space>
      </div>

      <div style={sectionStyle(palette)}>
        <Text strong style={{ fontSize: 12 }}>{t('claudeCodeConfig.providerUsageSection')}</Text>
        <Text type="secondary" style={{ display: 'block', fontSize: 11, margin: '2px 0 8px' }}>
          {t('claudeCodeConfig.providerUsageHint')}
        </Text>
        <Space direction="vertical" style={{ width: '100%' }} size={6}>
          <Checkbox
            checked={selectedForClaude}
            disabled={!canUseApi}
            onChange={(e) => patch({ activeClaude: e.target.checked })}
          >
            <Text style={{ fontSize: 12 }}>{t('claudeCodeConfig.providerUseForClaude')}</Text>
          </Checkbox>
          <Checkbox
            checked={selectedForCodex}
            disabled={!canUseApi}
            onChange={(e) => patch({ activeCodex: e.target.checked })}
          >
            <Text style={{ fontSize: 12 }}>{t('claudeCodeConfig.providerUseForCodex')}</Text>
          </Checkbox>
          <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
            {isSubscription
              ? t('claudeCodeConfig.providerSubscriptionRoutingHint')
              : t('claudeCodeConfig.providerApiRoutingHint')}
          </Text>
        </Space>
      </div>

      <div style={sectionStyle(palette)}>
        <Text strong style={{ fontSize: 12 }}>{t('claudeCodeConfig.modelMapping')}</Text>
        <Text type="secondary" style={{ display: 'block', fontSize: 11, margin: '2px 0 8px' }}>
          {t('claudeCodeConfig.providerUnifiedModelHint')}
        </Text>
        <Space size={8} wrap style={{ marginBottom: 8 }}>
          <Button size="small" icon={<ReloadOutlined />} disabled={models.length === 0} onClick={handleAutoMap}>
            {t('claudeCodeConfig.autoMapModels')}
          </Button>
          {onRestartCodex ? (
            <Button size="small" icon={<ReloadOutlined />} onClick={onRestartCodex}>
              {t('claudeCodeConfig.restartCodex')}
            </Button>
          ) : null}
          {modelsError ? (
            <Tag color="error" style={{ margin: 0 }}>{t('claudeCodeConfig.modelsFetchFailed')}</Tag>
          ) : models.length > 0 ? (
            <Tag color="success" style={{ margin: 0 }}>{t('claudeCodeConfig.modelsCount', { count: models.length })}</Tag>
          ) : null}
        </Space>
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          {MODEL_FIELDS.map((field) => (
            <div key={field.key}>
              <Text type="secondary" style={labelStyle}>{t(field.labelKey)}</Text>
              <ClaudeModelSelect
                models={models.length > 0 ? models : CODEX_SUGGESTED_MODELS}
                value={draft[field.key] ?? ''}
                onChange={(v) => patch({ [field.key]: v })}
                placeholder={t('claudeCodeConfig.selectOrManual')}
                disabled={modelsLoading}
              />
              <Text type="secondary" style={{ display: 'block', fontSize: 10, marginTop: 2 }}>
                {t(field.hintKey)}
              </Text>
            </div>
          ))}
        </Space>
      </div>

      <div style={sectionStyle(palette)}>
        <Text type="secondary" style={labelStyle}>{t('claudeCodeConfig.permissionMode')}</Text>
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

      <Space wrap>
        <Button
          size="small"
          type="primary"
          icon={<SaveOutlined />}
          disabled={!canSave}
          onClick={save}
        >
          {isNew ? t('claudeCodeConfig.providerAdd') : t('claudeCodeConfig.providerSave')}
        </Button>
        {!isNew && onActivate && !provider.activeClaude ? (
          <Button size="small" onClick={() => onActivate('claude')}>
            {t('claudeCodeConfig.providerSwitchClaude')}
          </Button>
        ) : null}
        {!isNew && onActivate && !provider.activeCodex ? (
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
