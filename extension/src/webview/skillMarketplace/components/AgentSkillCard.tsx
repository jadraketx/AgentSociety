import * as React from 'react';
import { Button, Card, Dropdown, Space, Switch, Tag, Tooltip, Typography } from 'antd';
import type { MenuProps } from 'antd';
import {
  BookOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  MoreOutlined,
  RobotOutlined,
  SyncOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import type { TFunction } from 'i18next';
import type { VscodeThemePalette } from '../../theme';
import type { AgentSkill, AgentSkillDetailPayload } from '../types';
import { MarkdownRenderer } from '../../components/MarkdownRenderer';
import { SkillDetailCollapse } from './SkillDetailCollapse';

const { Text, Title } = Typography;

type Props = {
  skill: AgentSkill;
  isBuiltin: boolean;
  palette: VscodeThemePalette;
  isDark: boolean;
  detail?: AgentSkillDetailPayload;
  detailLoading: boolean;
  t: TFunction;
  onToggleEnabled: (name: string, enabled: boolean) => void;
  onReload: (name: string) => void;
  onOpenDoc: (skill: AgentSkill) => void;
  onOpenFolder: (path: string) => void;
  onRemove: (name: string) => void;
  onExpandDetail: (skill: AgentSkill) => void;
};

export function AgentSkillCard({
  skill,
  isBuiltin,
  palette,
  isDark,
  detail,
  detailLoading,
  t,
  onToggleEnabled,
  onReload,
  onOpenDoc,
  onOpenFolder,
  onRemove,
  onExpandDetail,
}: Props) {
  const scriptText = (detail?.script ?? skill.script ?? '').trim();
  const mdBody = (detail?.skill_md ?? '').trim();
  const accent = isBuiltin ? palette.linkForeground : palette.successForeground;

  const menuItems: MenuProps['items'] = [
    {
      key: 'doc',
      label: t('skillManagement.viewDocumentation'),
      icon: <BookOutlined />,
      disabled: !skill.has_skill_md && !mdBody,
      onClick: () => onOpenDoc(skill),
    },
    {
      key: 'folder',
      label: t('skillManagement.openFolder'),
      icon: <FolderOpenOutlined />,
      onClick: () => onOpenFolder(skill.path),
    },
    ...(!isBuiltin
      ? [
          {
            key: 'reload',
            label: t('skillManagement.reload'),
            icon: <SyncOutlined />,
            onClick: () => onReload(skill.name),
          },
          { type: 'divider' as const },
          {
            key: 'remove',
            label: t('skillManagement.archiveAgentTooltip'),
            icon: <DeleteOutlined />,
            danger: true,
            onClick: () => onRemove(skill.name),
          },
        ]
      : []),
  ];

  return (
    <Card
      hoverable
      style={{
        height: '100%',
        background: palette.surfaceMuted,
        border: `1px solid ${palette.panelBorder}`,
        borderRadius: 12,
        boxShadow: '0 1px 0 rgba(0,0,0,0.04)',
      }}
      styles={{ body: { padding: '16px 18px' } }}
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 42,
            height: 42,
            borderRadius: 12,
            flexShrink: 0,
            background: `linear-gradient(135deg, ${accent}22 0%, ${accent}10 100%)`,
            color: accent,
          }}
        >
          {isBuiltin ? <ThunderboltOutlined style={{ fontSize: 18 }} /> : <RobotOutlined style={{ fontSize: 18 }} />}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <Title level={5} style={{ margin: 0, fontSize: 15, lineHeight: 1.3, wordBreak: 'break-word' }}>
                {skill.name}
              </Title>
              <Space size={[4, 4]} wrap style={{ marginTop: 6 }}>
                <Tag color={isBuiltin ? 'blue' : 'green'} style={{ margin: 0 }}>
                  {isBuiltin ? t('skillManagement.tagAgentBackend') : t('skillManagement.tagAgentRegistered')}
                </Tag>
                {skill.has_skill_md ? (
                  <Tag icon={<BookOutlined />} style={{ margin: 0 }}>
                    SKILL.md
                  </Tag>
                ) : null}
                {scriptText ? (
                  <Tag icon={<ToolOutlined />} style={{ margin: 0 }}>
                    {scriptText}
                  </Tag>
                ) : null}
              </Space>
            </div>
            <Space size={4} style={{ flexShrink: 0 }}>
              {isBuiltin ? (
                <Tag color="blue" style={{ margin: 0 }}>
                  {t('skillManagement.builtinAgentSkillTag')}
                </Tag>
              ) : (
                <Tooltip title={t('skillManagement.agentCatalogToggleHint')}>
                  <Switch
                    size="small"
                    checked={skill.enabled}
                    checkedChildren={t('skillManagement.enable')}
                    unCheckedChildren={t('skillManagement.disable')}
                    onChange={(checked) => onToggleEnabled(skill.name, checked)}
                  />
                </Tooltip>
              )}
              <Dropdown trigger={['click']} menu={{ items: menuItems }}>
                <Button type="text" size="small" icon={<MoreOutlined />} aria-label={t('skillManagement.moreActions')} />
              </Dropdown>
            </Space>
          </div>
          <Text type="secondary" style={{ display: 'block', marginTop: 10, fontSize: 13, lineHeight: 1.5 }}>
            {skill.description || t('skillManagement.noDescription')}
          </Text>
        </div>
      </div>

      <SkillDetailCollapse
        panelLabel={t('skillManagement.skillDetails')}
        onPanelOpen={() => onExpandDetail(skill)}
        loading={detailLoading && !detail}
        borderColor={palette.panelBorder}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
              {t('skillManagement.detailPath')}
            </Text>
            <Text style={{ fontSize: 12, wordBreak: 'break-all' }}>{detail?.path ?? skill.path}</Text>
          </div>
          {mdBody ? (
            <div
              style={{
                borderRadius: 8,
                border: `1px solid ${palette.panelBorder}`,
                background: palette.codeBlockBackground,
                padding: '10px 12px',
                maxHeight: 280,
                overflow: 'auto',
              }}
            >
              <MarkdownRenderer content={mdBody} isDark={isDark} style={{ fontSize: 12 }} />
            </div>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('skillManagement.detailNoMarkdownBody')}
            </Text>
          )}
        </div>
      </SkillDetailCollapse>
    </Card>
  );
}
