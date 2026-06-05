export const DEFAULT_PERSON_AGENT_CONTEXT_PRESET = 'standard-200k';

export const DEFAULT_PERSON_AGENT_FIELD_VALUES = {
  agentContextPreset: DEFAULT_PERSON_AGENT_CONTEXT_PRESET,
  agentMaxToolRounds: undefined as number | undefined,
  agentStepTimeout: undefined as number | undefined,
  agentAllowBashTool: '' as string,
  agentAllowDynamicSkillCommands: '' as string,
  agentDisabledTools: [] as string[],
  agentExternalQuestionContextMaxChars: undefined as number | undefined,
};
