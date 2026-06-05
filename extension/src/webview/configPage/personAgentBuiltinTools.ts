export type PersonAgentToolControl = 'always' | 'bash' | 'disable';

export type PersonAgentBuiltinToolMeta = {
  name: string;
  mode: 'read' | 'write' | 'run' | 'control';
  control: PersonAgentToolControl;
};

export const PERSON_AGENT_BUILTIN_TOOLS: PersonAgentBuiltinToolMeta[] = [
  { name: 'execute_skill', mode: 'run', control: 'always' },
  { name: 'read_skill', mode: 'read', control: 'always' },
  { name: 'activate_skill', mode: 'control', control: 'always' },
  { name: 'workspace_read', mode: 'read', control: 'always' },
  { name: 'workspace_list', mode: 'read', control: 'always' },
  { name: 'glob', mode: 'read', control: 'always' },
  { name: 'grep', mode: 'read', control: 'always' },
  { name: 'done', mode: 'control', control: 'always' },
  { name: 'finish', mode: 'control', control: 'always' },
  { name: 'bash', mode: 'run', control: 'bash' },
  { name: 'codegen', mode: 'run', control: 'disable' },
  { name: 'workspace_write', mode: 'write', control: 'disable' },
  { name: 'batch', mode: 'control', control: 'disable' },
];

export const PERSON_AGENT_DISABLEABLE_TOOLS = PERSON_AGENT_BUILTIN_TOOLS.filter(
  (t) => t.control === 'disable'
).map((t) => t.name);
