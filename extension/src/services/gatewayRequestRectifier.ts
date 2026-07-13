/**
 * Request shape fixes applied before forwarding Anthropic-compatible traffic.
 * Focused on common third-party / Coding Plan friction (thinking, images).
 */

export type GatewayRectifierSettings = {
  enabled: boolean;
  thinkingSignature: boolean;
  thinkingBudget: boolean;
  unsupportedImageDowngrade: boolean;
  heuristicTextOnlyModels: boolean;
};

export const DEFAULT_GATEWAY_RECTIFIER_SETTINGS: GatewayRectifierSettings = {
  enabled: true,
  thinkingSignature: true,
  thinkingBudget: true,
  unsupportedImageDowngrade: true,
  heuristicTextOnlyModels: true,
};

const TEXT_ONLY_MODEL_MARKERS = [
  'deepseek-v4',
  'deepseek-chat',
  'deepseek-reasoner',
  'glm-4',
  'glm-5',
  'kimi-k2',
  'kimi-for-coding',
  'minimax-m',
  'qwen3-coder',
  'qwen-plus',
  'mimo-v2',
  'longcat',
  'step-3',
];

const THINKING_SIGNATURE_ERROR =
  /thinking|signature|invalid.?request|illegal|incompatible/i;
const THINKING_BUDGET_ERROR = /budget_tokens|must be at least\s*1024|thinking\.budget/i;
const IMAGE_UNSUPPORTED_ERROR =
  /image|vision|multimodal|does not support.*(image|vision)|unsupported.*(image|media)/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isLikelyTextOnlyModel(model: string): boolean {
  const lower = model.trim().toLowerCase();
  if (!lower) {
    return false;
  }
  return TEXT_ONLY_MODEL_MARKERS.some((marker) => lower.includes(marker));
}

function stripThinkingBlocksFromContent(content: unknown): unknown {
  if (!Array.isArray(content)) {
    return content;
  }
  return content.filter((block) => {
    if (!isObject(block)) {
      return true;
    }
    return block.type !== 'thinking' && block.type !== 'redacted_thinking';
  });
}

export function stripIncompatibleThinking(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body };
  delete next.thinking;
  if (Array.isArray(next.messages)) {
    next.messages = next.messages.map((message) => {
      if (!isObject(message)) {
        return message;
      }
      return { ...message, content: stripThinkingBlocksFromContent(message.content) };
    });
  }
  return next;
}

export function applyThinkingBudgetFix(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body };
  const thinking: Record<string, unknown> = isObject(next.thinking)
    ? { ...next.thinking }
    : { type: 'enabled' };
  thinking.type = 'enabled';
  const existingBudget =
    typeof thinking.budget_tokens === 'number' ? thinking.budget_tokens : undefined;
  const budget = Math.min(
    existingBudget && existingBudget >= 1024 ? existingBudget : 1024,
    32_000
  );
  thinking.budget_tokens = budget;
  next.thinking = thinking;
  const maxTokens = typeof next.max_tokens === 'number' ? next.max_tokens : 0;
  if (maxTokens <= budget) {
    next.max_tokens = budget * 2;
  }
  return next;
}

function downgradeImageBlock(block: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'text',
    text: '[Unsupported Image]',
  };
}

export function downgradeUnsupportedImages(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body };
  if (!Array.isArray(next.messages)) {
    return next;
  }
  next.messages = next.messages.map((message) => {
    if (!isObject(message) || !Array.isArray(message.content)) {
      return message;
    }
    return {
      ...message,
      content: message.content.map((block) => {
        if (!isObject(block)) {
          return block;
        }
        if (block.type === 'image' || block.type === 'image_url') {
          return downgradeImageBlock(block);
        }
        return block;
      }),
    };
  });
  return next;
}

export function shouldHeuristicStripImages(
  settings: GatewayRectifierSettings,
  model: string
): boolean {
  return (
    settings.enabled &&
    settings.unsupportedImageDowngrade &&
    settings.heuristicTextOnlyModels &&
    isLikelyTextOnlyModel(model)
  );
}

export function applyPreflightRectifiers(
  body: Record<string, unknown>,
  settings: GatewayRectifierSettings,
  model: string
): Record<string, unknown> {
  if (!settings.enabled) {
    return body;
  }
  let next = body;
  if (shouldHeuristicStripImages(settings, model)) {
    next = downgradeUnsupportedImages(next);
  }
  return next;
}

export type RectifierRetryKind = 'thinking_signature' | 'thinking_budget' | 'unsupported_image';

export function classifyRectifierRetry(
  status: number,
  errorText: string,
  settings: GatewayRectifierSettings
): RectifierRetryKind | null {
  if (!settings.enabled || status < 400) {
    return null;
  }
  if (settings.thinkingBudget && THINKING_BUDGET_ERROR.test(errorText)) {
    return 'thinking_budget';
  }
  if (settings.thinkingSignature && THINKING_SIGNATURE_ERROR.test(errorText)) {
    if (/signature|thinking/i.test(errorText)) {
      return 'thinking_signature';
    }
  }
  if (settings.unsupportedImageDowngrade && IMAGE_UNSUPPORTED_ERROR.test(errorText)) {
    return 'unsupported_image';
  }
  return null;
}

export function applyRectifierRetryFix(
  body: Record<string, unknown>,
  kind: RectifierRetryKind
): Record<string, unknown> {
  if (kind === 'thinking_signature') {
    return stripIncompatibleThinking(body);
  }
  if (kind === 'thinking_budget') {
    return applyThinkingBudgetFix(body);
  }
  return downgradeUnsupportedImages(body);
}
