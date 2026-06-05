import type { ClaudeModelOption } from './claudeCodeModels';

export const OFFICIAL_ANTHROPIC_MODELS: ClaudeModelOption[] = [
  { id: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  { id: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet' },
  { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
  { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
  { id: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
  { id: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' },
];

export const OFFICIAL_OPENAI_MODELS: ClaudeModelOption[] = [
  { id: 'gpt-5', label: 'GPT-5' },
  { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
  { id: 'o3', label: 'o3' },
  { id: 'o3-mini', label: 'o3 mini' },
  { id: 'o4-mini', label: 'o4 mini' },
];
