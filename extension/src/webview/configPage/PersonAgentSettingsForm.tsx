import * as React from 'react';
import { Form, InputNumber, Space, Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import type { TFunction } from 'i18next';

export function FieldHelpLabel({ t, fieldKey }: { t: TFunction; fieldKey: string }) {
  return (
    <Space size={5}>
      <span>{t(`configPage.agent.fields.${fieldKey}.label`)}</span>
      <Tooltip title={t(`configPage.agent.fields.${fieldKey}.help`)}>
        <QuestionCircleOutlined style={{ opacity: 0.65, cursor: 'help' }} />
      </Tooltip>
    </Space>
  );
}

export type PersonAgentSettingsSection = 'runtime' | 'survey';

export interface PersonAgentSettingsFormProps {
  t: TFunction;
  sections: PersonAgentSettingsSection[];
}

export const PersonAgentSettingsForm: React.FC<PersonAgentSettingsFormProps> = ({
  t,
  sections,
}) => {
  const showRuntime = sections.includes('runtime');
  const showSurvey = sections.includes('survey');

  return (
    <>
      {showRuntime ? (
        <>
          <Form.Item
            name="agentMaxToolRounds"
            label={<FieldHelpLabel t={t} fieldKey="maxToolRounds" />}
          >
            <InputNumber min={1} max={64} style={{ width: '100%' }} placeholder="24" />
          </Form.Item>
          <Form.Item
            name="agentStepTimeout"
            label={<FieldHelpLabel t={t} fieldKey="stepTimeout" />}
            style={{ marginBottom: 0 }}
          >
            <InputNumber min={60} max={3600} style={{ width: '100%' }} placeholder="600" />
          </Form.Item>
        </>
      ) : null}
      {showSurvey ? (
        <Form.Item
          name="agentExternalQuestionContextMaxChars"
          label={<FieldHelpLabel t={t} fieldKey="eqContextMaxChars" />}
          style={{ marginBottom: 0 }}
        >
          <InputNumber
            min={8000}
            max={256_000}
            style={{ width: '100%' }}
            placeholder={t('configPage.agent.fields.eqContextMaxChars.placeholder')}
          />
        </Form.Item>
      ) : null}
    </>
  );
};
