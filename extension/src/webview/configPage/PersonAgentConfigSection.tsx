import * as React from 'react';
import { Button, Collapse, Form, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { QuestionCircleOutlined, ReloadOutlined, RobotOutlined } from '@ant-design/icons';
import type { FormInstance } from 'antd';
import type { TFunction } from 'i18next';
import type { VscodeThemePalette } from '../theme';
import { hasPersonAgentExpertOverrides } from './personAgentForm';
import { PersonAgentBuiltinToolsSection } from './PersonAgentBuiltinToolsSection';
import { FieldHelpLabel, PersonAgentSettingsForm } from './PersonAgentSettingsForm';
import type { ConfigValues } from './types';
import { tabBodyStyle } from './configPageStyles';

const { Text } = Typography;

export interface PersonAgentConfigSectionProps {
  t: TFunction;
  palette: VscodeThemePalette;
  form: FormInstance<ConfigValues>;
  envFilePath?: string;
  advancedCollapseKeys: string[];
  onAdvancedCollapseKeysChange: (keys: string[]) => void;
  onReset: () => void;
}

export const PersonAgentConfigSection: React.FC<PersonAgentConfigSectionProps> = ({
  t,
  palette,
  form,
  envFilePath,
  advancedCollapseKeys,
  onAdvancedCollapseKeysChange,
  onReset,
}) => {
  const watched = Form.useWatch([], form) as Partial<ConfigValues> | undefined;
  const agentContextPreset = watched?.agentContextPreset;
  const presetLabel =
    agentContextPreset === 'long-1m'
      ? t('configPage.agent.contextPresetLong')
      : t('configPage.agent.contextPresetStandard');
  const hasOverrides = hasPersonAgentExpertOverrides(watched || {});

  const envHint = envFilePath
    ? envFilePath
    : t('configPage.agent.envPathFallback');

  return (
    <div style={tabBodyStyle}>
      <Space size={8} wrap style={{ marginBottom: 12 }}>
        <Tag icon={<RobotOutlined />} style={{ margin: 0 }}>
          PersonAgent
        </Tag>
        <Tag style={{ margin: 0 }}>{presetLabel}</Tag>
        {hasOverrides ? (
          <Tag color="orange" style={{ margin: 0 }}>
            {t('configPage.agent.expert.customizedTag')}
          </Tag>
        ) : null}
        <Tooltip title={`${t('configPage.agent.savePath')}: ${envHint}`}>
          <QuestionCircleOutlined style={{ color: palette.descriptionForeground, cursor: 'help' }} />
        </Tooltip>
      </Space>

      <Form.Item
        name="agentContextPreset"
        label={<FieldHelpLabel t={t} fieldKey="contextPreset" />}
      >
        <Select
          options={[
            { value: 'standard-200k', label: t('configPage.agent.contextPresetStandard') },
            { value: 'long-1m', label: t('configPage.agent.contextPresetLong') },
          ]}
        />
      </Form.Item>

      <Collapse
        bordered={false}
        activeKey={advancedCollapseKeys}
        onChange={(keys) =>
          onAdvancedCollapseKeysChange(
            Array.isArray(keys) ? keys.map(String) : [String(keys)]
          )
        }
        style={{
          marginBottom: 12,
          background: 'transparent',
        }}
        items={[
          {
            key: 'runtime',
            label: (
              <Text style={{ fontSize: 13 }}>{t('configPage.agent.sections.runtime')}</Text>
            ),
            children: <PersonAgentSettingsForm t={t} sections={['runtime']} />,
          },
          {
            key: 'tools',
            label: (
              <Text style={{ fontSize: 13 }}>{t('configPage.agent.sections.tools')}</Text>
            ),
            children: <PersonAgentBuiltinToolsSection t={t} form={form} />,
          },
          {
            key: 'survey',
            label: (
              <Text style={{ fontSize: 13 }}>{t('configPage.agent.sections.survey')}</Text>
            ),
            children: <PersonAgentSettingsForm t={t} sections={['survey']} />,
          },
        ]}
      />

      <Button icon={<ReloadOutlined />} onClick={onReset}>
        {t('configPage.resetPersonAgentDefaults')}
      </Button>
    </div>
  );
};
