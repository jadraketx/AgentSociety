import type { ConfigValues } from './types';

export const DEFAULT_PERSON_AGENT_CONTEXT_PRESET = 'standard-200k';

const DEFAULT_PERSON_AGENT_VALUES: Pick<
  ConfigValues,
  | 'agentContextPreset'
  | 'agentMaxToolRounds'
  | 'agentStepTimeout'
  | 'agentAllowBashTool'
  | 'agentAllowDynamicSkillCommands'
  | 'agentDisabledTools'
  | 'agentExternalQuestionContextMaxChars'
> = {
  agentContextPreset: DEFAULT_PERSON_AGENT_CONTEXT_PRESET,
  agentMaxToolRounds: undefined,
  agentStepTimeout: undefined,
  agentAllowBashTool: '',
  agentAllowDynamicSkillCommands: '',
  agentDisabledTools: [],
  agentExternalQuestionContextMaxChars: undefined,
};

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

export function personAgentValuesForFormReset(): Partial<ConfigValues> {
  return { ...DEFAULT_PERSON_AGENT_VALUES };
}
