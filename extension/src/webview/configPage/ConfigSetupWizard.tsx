import * as React from 'react';
import { Alert, Button, Card, Space, Steps, Typography } from 'antd';
import { LeftOutlined, RightOutlined, UnorderedListOutlined } from '@ant-design/icons';
import type { TFunction } from 'i18next';
import type { VscodeThemePalette } from '../theme';
import type { BackendStatus, ValidationState } from './types';

const { Text, Title } = Typography;

export type WizardStepKey = 'import' | 'simulation' | 'save' | 'backend' | 'literature' | 'easypaper' | 'cli';

export const WIZARD_STEPS: Array<{
  key: WizardStepKey;
  tab: 'simulation' | 'literature' | 'cli';
  optional?: boolean;
}> = [
    { key: 'import', tab: 'simulation', optional: true },
    { key: 'simulation', tab: 'simulation' },
    { key: 'save', tab: 'simulation' },
    { key: 'backend', tab: 'simulation' },
    { key: 'literature', tab: 'literature', optional: true },
    { key: 'easypaper', tab: 'simulation', optional: true },
    { key: 'cli', tab: 'cli', optional: true },
  ];

export function wizardStepIndex(key: WizardStepKey): number {
  const index = WIZARD_STEPS.findIndex((step) => step.key === key);
  return index >= 0 ? index : 0;
}

type Props = {
  t: TFunction;
  palette: VscodeThemePalette;
  step: number;
  hasWorkspace: boolean;
  hasLlmKey: boolean;
  defaultValidation: ValidationState;
  backendStatus: BackendStatus;
  canSave: boolean;
  canSaveAndStart: boolean;
  saving: boolean;
  startingBackend: boolean;
  onStepChange: (step: number) => void;
  onExitWizard: () => void;
  onCompleteWizard: () => void;
  onSave: () => void;
  onSaveAndStart: () => void;
  onValidateDefault: () => void;
};

export function ConfigSetupWizard({
  t,
  palette,
  step,
  hasWorkspace,
  hasLlmKey,
  defaultValidation,
  backendStatus,
  canSave,
  canSaveAndStart,
  saving,
  startingBackend,
  onStepChange,
  onExitWizard,
  onCompleteWizard,
  onSave,
  onSaveAndStart,
  onValidateDefault,
}: Props) {
  const current = WIZARD_STEPS[step];
  const simulationReady = hasLlmKey && defaultValidation.valid === true && !defaultValidation.validating;
  const backendReady = backendStatus.isRunning;
  const simulationNeedsValidate =
    hasLlmKey &&
    !defaultValidation.validating &&
    defaultValidation.valid !== true;

  const stepFinished = (index: number): boolean => {
    const key = WIZARD_STEPS[index]?.key;
    if (key === 'import') {
      return hasLlmKey;
    }
    if (key === 'simulation' || key === 'save') {
      return simulationReady;
    }
    if (key === 'backend') {
      return backendReady;
    }
    return index < step;
  };

  const introTitle = t(`configPage.setupGuide.intro.${current.key}.title`);
  const introBody = t(`configPage.setupGuide.intro.${current.key}.body`);

  const handleNext = () => {
    if (current.key === 'import') {
      if (step < WIZARD_STEPS.length - 1) {
        onStepChange(step + 1);
      }
      return;
    }
    if (current.key === 'simulation') {
      if (simulationNeedsValidate) {
        onValidateDefault();
        return;
      }
      if (simulationReady && step < WIZARD_STEPS.length - 1) {
        onStepChange(step + 1);
      }
      return;
    }
    if (current.key === 'save') {
      if (canSave) {
        onSave();
      }
      return;
    }
    if (current.key === 'backend') {
      if (!backendReady && canSaveAndStart) {
        onSaveAndStart();
      } else if (backendReady) {
        if (step < WIZARD_STEPS.length - 1) {
          onStepChange(step + 1);
        } else {
          onCompleteWizard();
        }
      }
      return;
    }
    if (step >= WIZARD_STEPS.length - 1) {
      onCompleteWizard();
      return;
    }
    onStepChange(step + 1);
  };

  const handleSkip = () => {
    if (step >= WIZARD_STEPS.length - 1) {
      onCompleteWizard();
      return;
    }
    onStepChange(step + 1);
  };

  const handleStepClick = (index: number) => {
    if (index <= step) {
      onStepChange(index);
    }
  };

  const nextLabel = React.useMemo(() => {
    if (current.key === 'import') {
      return hasLlmKey
        ? t('configPage.setupGuide.actionNext')
        : t('configPage.setupGuide.actionManual');
    }
    if (current.key === 'simulation') {
      if (simulationNeedsValidate) {
        return t('configPage.setupGuide.actionValidate');
      }
      return t('configPage.setupGuide.actionNext');
    }
    if (current.key === 'save') {
      return t('configPage.setupGuide.actionSave');
    }
    if (current.key === 'backend') {
      return backendReady
        ? t('configPage.setupGuide.actionNext')
        : t('configPage.setupGuide.actionSaveAndStart');
    }
    if (step >= WIZARD_STEPS.length - 1) {
      return t('configPage.setupGuide.actionFinish');
    }
    return t('configPage.setupGuide.actionNext');
  }, [backendReady, current.key, hasLlmKey, simulationNeedsValidate, step, t]);

  const nextDisabled = React.useMemo(() => {
    if (current.key === 'import') {
      return false;
    }
    if (current.key === 'simulation') {
      if (!hasWorkspace || !hasLlmKey) {
        return true;
      }
      if (defaultValidation.validating) {
        return true;
      }
      return false;
    }
    if (current.key === 'save') {
      return !canSave || saving;
    }
    if (current.key === 'backend') {
      if (backendReady) {
        return false;
      }
      return !canSaveAndStart || startingBackend;
    }
    return false;
  }, [
    backendReady,
    canSave,
    canSaveAndStart,
    current.key,
    defaultValidation.validating,
    hasLlmKey,
    hasWorkspace,
    saving,
    startingBackend,
  ]);

  const nextLoading =
    (current.key === 'simulation' && defaultValidation.validating) ||
    (current.key === 'save' && saving) ||
    (current.key === 'backend' && startingBackend);

  return (
    <Card
      size="small"
      style={{
        marginBottom: 16,
        borderRadius: 12,
        border: `1px solid ${palette.panelBorder}`,
        background: palette.surfaceMuted,
      }}
      styles={{ body: { padding: '16px 18px' } }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <Title level={5} style={{ margin: 0, fontSize: 14 }}>
            {t('configPage.setupGuide.wizardTitle')}
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('configPage.setupGuide.wizardSubtitle')}
          </Text>
        </div>
        <Button type="link" size="small" icon={<UnorderedListOutlined />} onClick={onExitWizard} style={{ padding: 0, height: 'auto' }}>
          {t('configPage.setupGuide.exitWizard')}
        </Button>
      </div>

      <Steps
        size="small"
        current={step}
        style={{ marginBottom: 14 }}
        onChange={handleStepClick}
        items={WIZARD_STEPS.map((item, index) => ({
          title: t(`configPage.setupGuide.step${item.key.charAt(0).toUpperCase()}${item.key.slice(1)}`),
          status: stepFinished(index) ? 'finish' : index === step ? 'process' : 'wait',
        }))}
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14, borderRadius: 8 }}
        message={introTitle}
        description={<span style={{ fontSize: 12 }}>{introBody}</span>}
      />

      <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
        <Button
          icon={<LeftOutlined />}
          disabled={step <= 0}
          onClick={() => onStepChange(step - 1)}
        >
          {t('configPage.setupGuide.actionPrev')}
        </Button>
        <Space wrap>
          {current.optional ? (
            <Button onClick={handleSkip}>{t('configPage.setupGuide.actionSkip')}</Button>
          ) : null}
          <Button
            type="primary"
            icon={<RightOutlined />}
            iconPosition="end"
            loading={nextLoading}
            disabled={nextDisabled}
            onClick={handleNext}
          >
            {nextLabel}
          </Button>
        </Space>
      </Space>
    </Card>
  );
}
