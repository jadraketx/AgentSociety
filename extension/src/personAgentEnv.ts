import type { EnvConfig } from './envManager';
import {
  formatDisabledToolsEnv,
  parseDisabledToolsEnv,
} from './personAgentBuiltinTools';
import type { ConfigValues } from './webview/configPage/types';
import {
  DEFAULT_PERSON_AGENT_CONTEXT_PRESET,
  DEFAULT_PERSON_AGENT_FIELD_VALUES,
} from './shared/personAgentDefaults';

export { DEFAULT_PERSON_AGENT_CONTEXT_PRESET };

export const DEFAULT_PERSON_AGENT_VALUES: Pick<
  ConfigValues,
  | 'agentContextPreset'
  | 'agentMaxToolRounds'
  | 'agentStepTimeout'
  | 'agentAllowBashTool'
  | 'agentAllowDynamicSkillCommands'
  | 'agentDisabledTools'
  | 'agentExternalQuestionContextMaxChars'
> = DEFAULT_PERSON_AGENT_FIELD_VALUES;

export const PERSON_AGENT_ENV_VAR_HINTS = [
  'AGENT_CONTEXT_PRESET',
  'AGENT_MAX_TOOL_ROUNDS',
  'AGENT_STEP_TIMEOUT',
  'AGENT_ALLOW_BASH_TOOL',
  'AGENT_ALLOW_DYNAMIC_SKILL_COMMANDS',
  'AGENT_DISABLED_TOOLS',
  'AGENT_EXTERNAL_QUESTION_CONTEXT_MAX_CHARS',
] as const;

function optionalEnvNumber(value: number | string | undefined): number | string {
  return typeof value === 'number' && !Number.isNaN(value) ? value : '';
}

export function personAgentConfigFromEnv(env: Partial<EnvConfig>): Partial<ConfigValues> {
  const allowBash = env.agentAllowBashTool?.trim();
  const allowDynamic = env.agentAllowDynamicSkillCommands?.trim();
  const maxRounds = env.agentMaxToolRounds;
  const stepTimeout = env.agentStepTimeout;
  const eqMax = env.agentExternalQuestionContextMaxChars;

  return {
    agentContextPreset: env.agentContextPreset || DEFAULT_PERSON_AGENT_CONTEXT_PRESET,
    agentMaxToolRounds: typeof maxRounds === 'number' ? maxRounds : undefined,
    agentStepTimeout: typeof stepTimeout === 'number' ? stepTimeout : undefined,
    agentAllowBashTool: allowBash === 'false' ? 'false' : allowBash === 'true' ? 'true' : '',
    agentAllowDynamicSkillCommands:
      allowDynamic === 'false' ? 'false' : allowDynamic === 'true' ? 'true' : '',
    agentDisabledTools: parseDisabledToolsEnv(env.agentDisabledTools),
    agentExternalQuestionContextMaxChars:
      typeof eqMax === 'number' ? eqMax : undefined,
  };
}

export function personAgentEnvFromConfig(
  config: Partial<ConfigValues>
): Partial<EnvConfig> {
  const preset =
    (config.agentContextPreset ?? DEFAULT_PERSON_AGENT_CONTEXT_PRESET).trim() ||
    DEFAULT_PERSON_AGENT_CONTEXT_PRESET;
  const allowBash = (config.agentAllowBashTool ?? '').trim();
  const allowDynamic = (config.agentAllowDynamicSkillCommands ?? '').trim();
  const disabled = config.agentDisabledTools ?? [];

  return {
    agentContextPreset: preset,
    agentMaxToolRounds: optionalEnvNumber(config.agentMaxToolRounds) as number,
    agentStepTimeout: optionalEnvNumber(config.agentStepTimeout) as number,
    agentAllowBashTool:
      allowBash === 'false' ? 'false' : allowBash === 'true' ? 'true' : '',
    agentAllowDynamicSkillCommands:
      allowDynamic === 'false' ? 'false' : allowDynamic === 'true' ? 'true' : '',
    agentDisabledTools:
      disabled.length > 0 ? formatDisabledToolsEnv(disabled) ?? '' : '',
    agentExternalQuestionContextMaxChars: optionalEnvNumber(
      config.agentExternalQuestionContextMaxChars
    ) as number,
  };
}

export function hasPersonAgentExpertOverrides(config: Partial<ConfigValues>): boolean {
  if (config.agentMaxToolRounds !== undefined || config.agentStepTimeout !== undefined) {
    return true;
  }
  if (config.agentExternalQuestionContextMaxChars !== undefined) {
    return true;
  }
  if (config.agentAllowBashTool === 'false' || config.agentAllowDynamicSkillCommands === 'false') {
    return true;
  }
  if (config.agentDisabledTools && config.agentDisabledTools.length > 0) {
    return true;
  }
  if (
    config.agentContextPreset &&
    config.agentContextPreset !== DEFAULT_PERSON_AGENT_CONTEXT_PRESET
  ) {
    return true;
  }
  return false;
}

export function applyPersonAgentEnv(
  target: Record<string, string>,
  config: Partial<EnvConfig>
): void {
  const setIf = (key: string, value: string | number | undefined): void => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    target[key] = String(value);
  };

  setIf('AGENT_CONTEXT_PRESET', config.agentContextPreset);
  setIf('AGENT_MAX_TOOL_ROUNDS', config.agentMaxToolRounds);
  setIf('AGENT_STEP_TIMEOUT', config.agentStepTimeout);
  setIf('AGENT_ALLOW_BASH_TOOL', config.agentAllowBashTool);
  setIf('AGENT_ALLOW_DYNAMIC_SKILL_COMMANDS', config.agentAllowDynamicSkillCommands);
  setIf('AGENT_DISABLED_TOOLS', config.agentDisabledTools);
  setIf(
    'AGENT_EXTERNAL_QUESTION_CONTEXT_MAX_CHARS',
    config.agentExternalQuestionContextMaxChars
  );
}

export function personAgentValuesForFormReset(): Partial<ConfigValues> {
  return { ...DEFAULT_PERSON_AGENT_VALUES };
}
