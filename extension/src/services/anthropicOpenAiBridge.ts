type JsonObject = Record<string, unknown>;

const BILLING_HEADER_PREFIX = 'x-anthropic-billing-header:';

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stripLeadingAnthropicBillingHeader(text: string): string {
  if (!text.startsWith(BILLING_HEADER_PREFIX)) {
    return text;
  }
  const lineEnd = text.search(/\r?\n/);
  if (lineEnd < 0) {
    return '';
  }
  return text.slice(lineEnd).replace(/^\r?\n\r?\n?/, '');
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
}

function textFromAnthropicContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter((block): block is JsonObject => isObject(block))
    .filter((block) => block.type === 'text')
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('\n');
}

function anthropicContentToOpenAiContent(content: unknown): unknown {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  const parts: JsonObject[] = [];
  for (const raw of content) {
    if (!isObject(raw)) {
      continue;
    }
    if (raw.type === 'text') {
      parts.push({ type: 'text', text: typeof raw.text === 'string' ? raw.text : '' });
    } else if (raw.type === 'image' && isObject(raw.source)) {
      const source = raw.source;
      const mediaType = typeof source.media_type === 'string' ? source.media_type : 'image/png';
      if (typeof source.data === 'string') {
        parts.push({ type: 'image_url', image_url: { url: `data:${mediaType};base64,${source.data}` } });
      } else if (typeof source.url === 'string') {
        parts.push({ type: 'image_url', image_url: { url: source.url } });
      }
    }
  }
  if (parts.length === 1 && parts[0].type === 'text') {
    return parts[0].text ?? '';
  }
  return parts;
}

function mapToolChoiceToOpenAi(toolChoice: unknown): unknown {
  if (typeof toolChoice === 'string') {
    return toolChoice === 'any' ? 'required' : toolChoice;
  }
  if (!isObject(toolChoice)) {
    return undefined;
  }
  const type = toolChoice.type;
  if (type === 'any') {
    return 'required';
  }
  if (type === 'auto' || type === 'none') {
    return type;
  }
  if (type === 'tool' && typeof toolChoice.name === 'string') {
    return { type: 'function', function: { name: toolChoice.name } };
  }
  return undefined;
}

function supportsReasoningEffort(model: string): boolean {
  const lower = model.toLowerCase();
  return /^o\d/.test(lower) || /^gpt-[5-9]/.test(lower);
}

function resolveReasoningEffort(body: JsonObject): string | undefined {
  const outputConfig = isObject(body.output_config) ? body.output_config : {};
  if (typeof outputConfig.effort === 'string') {
    return outputConfig.effort === 'max' ? 'xhigh' : outputConfig.effort;
  }
  const thinking = isObject(body.thinking) ? body.thinking : {};
  if (thinking.type === 'adaptive') {
    return 'xhigh';
  }
  if (thinking.type === 'enabled') {
    const budget = typeof thinking.budget_tokens === 'number' ? thinking.budget_tokens : undefined;
    if (budget === undefined) {
      return 'high';
    }
    if (budget < 4000) {
      return 'low';
    }
    if (budget < 16000) {
      return 'medium';
    }
    return 'high';
  }
  return undefined;
}

export function translateAnthropicMessagesToOpenAiChat(
  body: JsonObject,
  model: string
): JsonObject {
  const messages: JsonObject[] = [];
  const system = body.system;
  if (typeof system === 'string') {
    const text = stripLeadingAnthropicBillingHeader(system);
    if (text) {
      messages.push({ role: 'system', content: text });
    }
  } else if (Array.isArray(system)) {
    const text = system
      .filter((part): part is JsonObject => isObject(part))
      .map((part) => (typeof part.text === 'string' ? stripLeadingAnthropicBillingHeader(part.text) : ''))
      .filter(Boolean)
      .join('\n\n');
    if (text) {
      messages.push({ role: 'system', content: text });
    }
  }

  for (const rawMessage of Array.isArray(body.messages) ? body.messages : []) {
    if (!isObject(rawMessage)) {
      continue;
    }
    const role = rawMessage.role === 'assistant' ? 'assistant' : 'user';
    const content = rawMessage.content;
    if (Array.isArray(content)) {
      const toolResults = content.filter((block): block is JsonObject => isObject(block) && block.type === 'tool_result');
      const toolUses = content.filter((block): block is JsonObject => isObject(block) && block.type === 'tool_use');
      const textContent = textFromAnthropicContent(content);
      if (role === 'assistant') {
        messages.push({
          role,
          content: textContent || null,
          ...(toolUses.length
            ? {
                tool_calls: toolUses.map((block, index) => ({
                  id: typeof block.id === 'string' ? block.id : `toolu_${index}`,
                  type: 'function',
                  function: {
                    name: typeof block.name === 'string' ? block.name : 'tool',
                    arguments: safeJson(block.input),
                  },
                })),
              }
            : {}),
        });
      } else {
        const regularContent = anthropicContentToOpenAiContent(
          content.filter((block) => !(isObject(block) && block.type === 'tool_result'))
        );
        if ((typeof regularContent === 'string' && regularContent) || Array.isArray(regularContent)) {
          messages.push({ role: 'user', content: regularContent });
        }
        for (const block of toolResults) {
          messages.push({
            role: 'tool',
            tool_call_id: typeof block.tool_use_id === 'string' ? block.tool_use_id : '',
            content: textFromAnthropicContent(block.content) || (typeof block.content === 'string' ? block.content : safeJson(block.content)),
          });
        }
      }
    } else {
      messages.push({ role, content: anthropicContentToOpenAiContent(content) });
    }
  }

  const out: JsonObject = {
    model,
    messages,
    stream: body.stream !== false,
  };
  if (body.max_tokens !== undefined) {
    if (/^o\d/i.test(model)) {
      out.max_completion_tokens = body.max_tokens;
    } else {
      out.max_tokens = body.max_tokens;
    }
  }
  for (const key of ['temperature', 'top_p', 'metadata']) {
    if (body[key] !== undefined) {
      out[key] = body[key];
    }
  }
  if (body.stop_sequences !== undefined) {
    out.stop = body.stop_sequences;
  }
  const effort = supportsReasoningEffort(model) ? resolveReasoningEffort(body) : undefined;
  if (effort) {
    out.reasoning_effort = effort;
  }
  if (Array.isArray(body.tools)) {
    out.tools = body.tools
      .filter((tool): tool is JsonObject => isObject(tool) && tool.type !== 'BatchTool')
      .map((tool) => ({
        type: 'function',
        function: {
          name: typeof tool.name === 'string' ? tool.name : '',
          description: typeof tool.description === 'string' ? tool.description : undefined,
          parameters: isObject(tool.input_schema) ? tool.input_schema : {},
        },
      }));
  }
  const toolChoice = mapToolChoiceToOpenAi(body.tool_choice);
  if (toolChoice) {
    out.tool_choice = toolChoice;
  }
  if (out.stream) {
    out.stream_options = { include_usage: true };
  }
  return out;
}

function anthropicUsageFromOpenAi(usage: unknown): JsonObject {
  if (!isObject(usage)) {
    return { input_tokens: 0, output_tokens: 0 };
  }
  const prompt = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
  const completion = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0;
  const promptDetails = isObject(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const cached = typeof promptDetails.cached_tokens === 'number' ? promptDetails.cached_tokens : 0;
  return {
    input_tokens: Math.max(prompt - cached, 0),
    output_tokens: completion,
    ...(cached > 0 ? { cache_read_input_tokens: cached } : {}),
  };
}

function mapFinishReason(reason: unknown, hasToolUse: boolean): string {
  if (hasToolUse) {
    return 'tool_use';
  }
  if (reason === 'length') {
    return 'max_tokens';
  }
  if (reason === 'stop') {
    return 'end_turn';
  }
  return 'end_turn';
}

export function translateOpenAiChatToAnthropicMessage(body: JsonObject, fallbackModel: string): JsonObject {
  const choice = Array.isArray(body.choices) && isObject(body.choices[0]) ? body.choices[0] : {};
  const message = isObject(choice.message) ? choice.message : {};
  const content: JsonObject[] = [];
  if (typeof message.content === 'string' && message.content) {
    content.push({ type: 'text', text: message.content });
  }
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls.filter(isObject) : [];
  for (const call of toolCalls) {
    const fn = isObject(call.function) ? call.function : {};
    let input: unknown = {};
    if (typeof fn.arguments === 'string' && fn.arguments) {
      try {
        input = JSON.parse(fn.arguments);
      } catch {
        input = {};
      }
    }
    content.push({
      type: 'tool_use',
      id: typeof call.id === 'string' ? call.id : '',
      name: typeof fn.name === 'string' ? fn.name : 'tool',
      input,
    });
  }
  return {
    id: typeof body.id === 'string' ? body.id : `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model: typeof body.model === 'string' ? body.model : fallbackModel,
    content,
    stop_reason: mapFinishReason(choice.finish_reason, toolCalls.length > 0),
    stop_sequence: null,
    usage: anthropicUsageFromOpenAi(body.usage),
  };
}

export function formatAnthropicSseEvent(event: string, data: JsonObject): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export class OpenAiChatToAnthropicStreamTranslator {
  private messageStarted = false;
  private textStarted = false;
  private textIndex = 0;
  private latestUsage: JsonObject | null = null;
  private messageId = `msg_${Date.now()}`;
  private model: string;

  constructor(model: string) {
    this.model = model;
  }

  acceptChunk(chunk: JsonObject): string[] {
    const events: string[] = [];
    if (typeof chunk.id === 'string') {
      this.messageId = chunk.id;
    }
    if (typeof chunk.model === 'string') {
      this.model = chunk.model;
    }
    if (chunk.usage) {
      this.latestUsage = anthropicUsageFromOpenAi(chunk.usage);
    }
    if (!this.messageStarted) {
      this.messageStarted = true;
      events.push(formatAnthropicSseEvent('message_start', {
        type: 'message_start',
        message: {
          id: this.messageId,
          type: 'message',
          role: 'assistant',
          model: this.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }));
    }
    const choice = Array.isArray(chunk.choices) && isObject(chunk.choices[0]) ? chunk.choices[0] : {};
    const delta = isObject(choice.delta) ? choice.delta : {};
    if (typeof delta.content === 'string' && delta.content) {
      if (!this.textStarted) {
        this.textStarted = true;
        events.push(formatAnthropicSseEvent('content_block_start', {
          type: 'content_block_start',
          index: this.textIndex,
          content_block: { type: 'text', text: '' },
        }));
      }
      events.push(formatAnthropicSseEvent('content_block_delta', {
        type: 'content_block_delta',
        index: this.textIndex,
        delta: { type: 'text_delta', text: delta.content },
      }));
    }
    if (choice.finish_reason) {
      if (this.textStarted) {
        events.push(formatAnthropicSseEvent('content_block_stop', {
          type: 'content_block_stop',
          index: this.textIndex,
        }));
      }
      events.push(formatAnthropicSseEvent('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: mapFinishReason(choice.finish_reason, false), stop_sequence: null },
        usage: this.latestUsage ?? { input_tokens: 0, output_tokens: 0 },
      }));
      events.push(formatAnthropicSseEvent('message_stop', { type: 'message_stop' }));
    }
    return events;
  }
}
