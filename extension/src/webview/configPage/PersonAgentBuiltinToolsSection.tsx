import * as React from 'react';
import { Form, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import type { FormInstance } from 'antd';
import type { TFunction } from 'i18next';
import { PERSON_AGENT_BUILTIN_TOOLS } from './personAgentBuiltinTools';
import type { ConfigValues } from './types';

const { Text } = Typography;

function FormFieldHolder(_props: { value?: unknown; onChange?: (v: unknown) => void }) {
  return null;
}

export interface PersonAgentBuiltinToolsSectionProps {
  t: TFunction;
  form: FormInstance<ConfigValues>;
}

export const PersonAgentBuiltinToolsSection: React.FC<PersonAgentBuiltinToolsSectionProps> = ({
  t,
  form,
}) => {
  const allowBash = Form.useWatch('agentAllowBashTool', form);
  const allowDynamic = Form.useWatch('agentAllowDynamicSkillCommands', form);
  const disabledList: string[] = Form.useWatch('agentDisabledTools', form) || [];

  const bashOn = allowBash !== 'false';
  const dynamicOn = allowDynamic !== 'false';

  const toggleDisabled = (name: string, checked: boolean) => {
    const next = new Set(disabledList);
    if (checked) {
      next.add(name);
    } else {
      next.delete(name);
    }
    form.setFieldValue('agentDisabledTools', [...next]);
  };

  const columns = [
    {
      title: t('configPage.agent.tools.colName'),
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <code style={{ fontSize: 12 }}>{name}</code>,
    },
    {
      title: t('configPage.agent.tools.colMode'),
      dataIndex: 'mode',
      key: 'mode',
      width: 72,
      render: (mode: string) => (
        <Tag style={{ margin: 0 }}>{t(`configPage.agent.tools.mode.${mode}`)}</Tag>
      ),
    },
    {
      title: t('configPage.agent.tools.colPurpose'),
      dataIndex: 'name',
      key: 'purpose',
      render: (name: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t(`configPage.agent.tools.purpose.${name}`)}
        </Text>
      ),
    },
    {
      title: t('configPage.agent.tools.colEnabled'),
      key: 'enabled',
      width: 88,
      align: 'center' as const,
      render: (_: unknown, row: (typeof PERSON_AGENT_BUILTIN_TOOLS)[number]) => {
        if (row.control === 'always') {
          return (
            <Tag color="default" style={{ margin: 0 }}>
              {t('configPage.agent.tools.alwaysOn')}
            </Tag>
          );
        }
        if (row.control === 'bash') {
          return (
            <Switch
              size="small"
              checked={bashOn}
              onChange={(on) => form.setFieldValue('agentAllowBashTool', on ? 'true' : 'false')}
            />
          );
        }
        const off = disabledList.includes(row.name);
        return (
          <Switch
            size="small"
            checked={!off}
            onChange={(on) => toggleDisabled(row.name, !on)}
          />
        );
      },
    },
  ];

  return (
    <>
      <Space size={5} style={{ marginBottom: 10 }}>
        <Text strong style={{ fontSize: 12 }}>{t('configPage.agent.sections.tools')}</Text>
        <Tooltip title={t('configPage.agent.tools.sectionHint')}>
          <QuestionCircleOutlined style={{ opacity: 0.65, cursor: 'help' }} />
        </Tooltip>
      </Space>
      <Table
        size="small"
        pagination={false}
        rowKey="name"
        dataSource={PERSON_AGENT_BUILTIN_TOOLS}
        columns={columns}
        style={{ marginBottom: 12 }}
      />
      <Form.Item name="agentDisabledTools" initialValue={[]} noStyle>
        <FormFieldHolder />
      </Form.Item>
      <Form.Item name="agentAllowBashTool" noStyle>
        <FormFieldHolder />
      </Form.Item>
      <Form.Item name="agentAllowDynamicSkillCommands" noStyle>
        <FormFieldHolder />
      </Form.Item>
      <Form.Item
        label={
          <Space size={5}>
            <span>{t('configPage.agent.fields.allowDynamicSkills.label')}</span>
            <Tooltip title={t('configPage.agent.fields.allowDynamicSkills.help')}>
              <QuestionCircleOutlined style={{ opacity: 0.65, cursor: 'help' }} />
            </Tooltip>
          </Space>
        }
        style={{ marginBottom: 0 }}
      >
        <Switch
          checked={dynamicOn}
          onChange={(on) =>
            form.setFieldValue('agentAllowDynamicSkillCommands', on ? 'true' : 'false')
          }
        />
      </Form.Item>
    </>
  );
};
