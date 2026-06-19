import { randomUUID } from 'crypto';

type JsonObject = Record<string, unknown>;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}

function flattenContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    const texts = content
      .filter(
        (part): part is { type?: string; text?: string } =>
          Boolean(part) &&
          typeof part === 'object' &&
          (part.type === 'text' || part.type === 'input_text' || part.type === 'output_text') &&
          typeof (part as { text?: string }).text === 'string'
      )
      .map((part) => part.text as string);
    if (texts.length > 0) {
      return texts.join('\n');
    }
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  if (content === null || content === undefined) {
    return '';
  }
  return String(content);
}

function extractReasoningText(message: JsonObject): string {
  for (const key of ['reasoning_content', 'reasoning', 'thinking']) {
    const value = message[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return '';
}

function computeDelta(prev: string, incoming: string): { delta: string; next: string } {
  if (!incoming) {
    return { delta: '', next: prev };
  }
  if (!prev) {
    return { delta: incoming, next: incoming };
  }
  if (incoming.startsWith(prev)) {
    return { delta: incoming.slice(prev.length), next: incoming };
  }
  if (prev.endsWith(incoming)) {
    return { delta: '', next: prev };
  }
  return { delta: incoming, next: prev + incoming };
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeChatUsageForResponses(usageRaw: unknown): JsonObject | null {
  if (!usageRaw || typeof usageRaw !== 'object') {
    return null;
  }
  const usage = usageRaw as JsonObject;
  const promptDetails =
    usage.prompt_tokens_details && typeof usage.prompt_tokens_details === 'object'
      ? (usage.prompt_tokens_details as JsonObject)
      : {};
  const completionDetails =
    usage.completion_tokens_details && typeof usage.completion_tokens_details === 'object'
      ? (usage.completion_tokens_details as JsonObject)
      : {};
  return {
    input_tokens: numberValue(usage.prompt_tokens ?? usage.input_tokens),
    output_tokens: numberValue(usage.completion_tokens ?? usage.output_tokens),
    total_tokens: numberValue(usage.total_tokens),
    input_tokens_details: {
      cached_tokens: numberValue(promptDetails.cached_tokens),
    },
    output_tokens_details: {
      reasoning_tokens: numberValue(completionDetails.reasoning_tokens),
    },
  };
}

export function buildResponseShell(request: JsonObject, ids: {
  responseId: string;
  createdAt: number;
  status: string;
  output?: unknown[];
  usage?: JsonObject | null;
  error?: JsonObject | null;
  completedAt?: number | null;
}): JsonObject {
  return {
    id: ids.responseId,
    object: 'response',
    created_at: ids.createdAt,
    status: ids.status,
    completed_at: ids.completedAt ?? null,
    error: ids.error ?? null,
    incomplete_details: null,
    input: request.input ?? [],
    instructions: request.instructions ?? null,
    max_output_tokens: request.max_output_tokens ?? null,
    model: request.model ?? 'gpt-4o',
    output: ids.output ?? [],
    previous_response_id: request.previous_response_id ?? null,
    reasoning_effort:
      request.reasoning && typeof request.reasoning === 'object'
        ? (request.reasoning as JsonObject).effort ?? null
        : null,
    store: false,
    temperature: request.temperature ?? 1,
    text: request.text ?? { format: { type: 'text' } },
    tool_choice: request.tool_choice ?? 'auto',
    tools: request.tools ?? [],
    top_p: request.top_p ?? 1,
    truncation: 'disabled',
    usage: ids.usage ?? null,
    user: request.user ?? null,
    metadata: request.metadata ?? {},
  };
}

export function translateResponsesRequestToChat(
  request: JsonObject,
  upstreamModel?: string
): JsonObject {
  const messages: JsonObject[] = [];

  if (request.instructions) {
    messages.push({
      role: 'system',
      content: String(request.instructions),
    });
  }

  const input = request.input;
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const row = item as JsonObject;
      if (row.type === 'function_call_output') {
        messages.push({
          role: 'tool',
          tool_call_id: String(row.call_id ?? row.tool_call_id ?? ''),
          content:
            typeof row.output === 'string'
              ? row.output
              : JSON.stringify(row.output ?? row.content ?? ''),
        });
        continue;
      }
      if (!row.role) {
        continue;
      }
      let role = String(row.role);
      if (role === 'developer') {
        role = 'user';
      }
      if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') {
        continue;
      }
      const msg: JsonObject = {
        role,
        content: flattenContent(row.content),
      };
      if (Array.isArray(row.tool_calls)) {
        msg.tool_calls = row.tool_calls;
      }
      if (row.tool_call_id) {
        msg.tool_call_id = row.tool_call_id;
      }
      messages.push(msg);
    }
  }

  const chat: JsonObject = {
    model: upstreamModel?.trim() || String(request.model ?? 'gpt-4o'),
    messages,
    stream: request.stream !== false,
  };

  if (chat.stream) {
    chat.stream_options = { include_usage: true };
  }

  if (request.max_output_tokens !== undefined && request.max_output_tokens !== null) {
    chat.max_tokens = request.max_output_tokens;
  }
  if (request.temperature !== undefined) {
    chat.temperature = request.temperature;
  }
  if (request.top_p !== undefined) {
    chat.top_p = request.top_p;
  }
  if (request.reasoning !== undefined) {
    chat.reasoning = request.reasoning;
  }

  if (Array.isArray(request.tools) && request.tools.length > 0) {
    const tools: JsonObject[] = [];
    for (const tool of request.tools) {
      if (!tool || typeof tool !== 'object') {
        continue;
      }
      const row = tool as JsonObject;
      if (row.type !== 'function') {
        continue;
      }
      const fn =
        row.function && typeof row.function === 'object'
          ? (row.function as JsonObject)
          : row;
      const name = String(fn.name ?? row.name ?? '').trim();
      if (!name) {
        continue;
      }
      const entry: JsonObject = {
        type: 'function',
        function: {
          name,
          parameters: fn.parameters ?? row.parameters ?? { type: 'object', properties: {} },
        },
      };
      const description = fn.description ?? row.description;
      if (description) {
        (entry.function as JsonObject).description = description;
      }
      tools.push(entry);
    }
    if (tools.length > 0) {
      chat.tools = tools;
      if (request.tool_choice !== undefined) {
        chat.tool_choice = request.tool_choice;
      }
    }
  }

  return chat;
}

export function translateChatCompletionToResponses(
  chatBody: JsonObject,
  request: JsonObject
): JsonObject {
  const choice = Array.isArray(chatBody.choices) ? (chatBody.choices[0] as JsonObject) : undefined;
  const message =
    choice?.message && typeof choice.message === 'object'
      ? (choice.message as JsonObject)
      : {};
  const output: JsonObject[] = [];
  const reasoningText = extractReasoningText(message);
  if (reasoningText) {
    output.push({
      id: newId('rs'),
      type: 'reasoning',
      status: 'completed',
      content: [{ type: 'reasoning_text', text: reasoningText }],
      summary: [],
    });
  }

  const text = typeof message.content === 'string' ? message.content : '';
  if (text) {
    output.push({
      id: newId('msg'),
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text, annotations: [] }],
    });
  }

  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      if (!tc || typeof tc !== 'object') {
        continue;
      }
      const row = tc as JsonObject;
      const fn =
        row.function && typeof row.function === 'object'
          ? (row.function as JsonObject)
          : {};
      const callId = String(row.id ?? newId('call'));
      output.push({
        id: callId,
        type: 'function_call',
        call_id: callId,
        name: String(fn.name ?? ''),
        arguments: String(fn.arguments ?? ''),
      });
    }
  }

  const usage = normalizeChatUsageForResponses(chatBody.usage);

  return buildResponseShell(request, {
    responseId: String(chatBody.id ?? newId('resp')).replace(/^chatcmpl-/, 'resp_'),
    createdAt: nowSec(),
    status: 'completed',
    completedAt: nowSec(),
    output,
    usage,
  });
}

export type ResponsesSseEvent = JsonObject;

export class CodexChatStreamTranslator {
  private seq = 1;
  private readonly responseId = newId('resp');
  private readonly messageId = newId('msg');
  private readonly createdAt = nowSec();
  private readonly request: JsonObject;
  private allOutputText = '';
  private allReasoningText = '';
  private usage: JsonObject | null = null;
  private messageStarted = false;
  private reasoningStarted = false;
  private completed = false;

  constructor(request: JsonObject) {
    this.request = request;
  }

  initialEvents(): ResponsesSseEvent[] {
    const shell = buildResponseShell(this.request, {
      responseId: this.responseId,
      createdAt: this.createdAt,
      status: 'in_progress',
      output: [],
    });
    return [
      { type: 'response.created', response: shell, sequence_number: this.seq++ },
      { type: 'response.in_progress', response: shell, sequence_number: this.seq++ },
    ];
  }

  consumeChatSseLine(line: string): ResponsesSseEvent[] {
    if (!line.startsWith('data:')) {
      return [];
    }
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') {
      return [];
    }
    let parsed: JsonObject;
    try {
      parsed = JSON.parse(payload) as JsonObject;
    } catch {
      return [];
    }
    const usage = normalizeChatUsageForResponses(parsed.usage);
    if (usage) {
      this.usage = usage;
    }
    const choice = Array.isArray(parsed.choices) ? (parsed.choices[0] as JsonObject) : undefined;
    const delta =
      choice?.delta && typeof choice.delta === 'object'
        ? (choice.delta as JsonObject)
        : {};
    const events: ResponsesSseEvent[] = [];

    const reasoningDelta = extractReasoningText(delta);
    if (reasoningDelta) {
      const computed = computeDelta(this.allReasoningText, reasoningDelta);
      this.allReasoningText = computed.next;
      if (computed.delta) {
        if (!this.reasoningStarted) {
          this.reasoningStarted = true;
          events.push({
            type: 'response.output_item.added',
            output_index: 0,
            item: {
              id: newId('rs'),
              type: 'reasoning',
              status: 'in_progress',
              content: [],
              summary: [],
            },
            sequence_number: this.seq++,
          });
        }
        events.push({
          type: 'response.reasoning_text.delta',
          item_id: this.messageId,
          output_index: 0,
          content_index: 0,
          delta: computed.delta,
          sequence_number: this.seq++,
        });
      }
    }

    if (typeof delta.content === 'string' && delta.content.length > 0) {
      const computed = computeDelta(this.allOutputText, delta.content);
      this.allOutputText = computed.next;
      if (computed.delta) {
        if (!this.messageStarted) {
          this.messageStarted = true;
          events.push({
            type: 'response.output_item.added',
            output_index: this.reasoningStarted ? 1 : 0,
            item: {
              id: this.messageId,
              type: 'message',
              status: 'in_progress',
              role: 'assistant',
              content: [],
            },
            sequence_number: this.seq++,
          });
          events.push({
            type: 'response.content_part.added',
            item_id: this.messageId,
            output_index: this.reasoningStarted ? 1 : 0,
            content_index: 0,
            part: { type: 'output_text', annotations: [] },
            sequence_number: this.seq++,
          });
        }
        events.push({
          type: 'response.output_text.delta',
          item_id: this.messageId,
          output_index: this.reasoningStarted ? 1 : 0,
          content_index: 0,
          delta: computed.delta,
          sequence_number: this.seq++,
        });
      }
    }

    return events;
  }

  completionEvent(usage?: JsonObject | null): ResponsesSseEvent {
    const output: JsonObject[] = [];
    if (this.allReasoningText) {
      output.push({
        id: newId('rs'),
        type: 'reasoning',
        status: 'completed',
        content: [{ type: 'reasoning_text', text: this.allReasoningText }],
        summary: [],
      });
    }
    if (this.allOutputText) {
      output.push({
        id: this.messageId,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: this.allOutputText, annotations: [] }],
      });
    }
    const response = buildResponseShell(this.request, {
      responseId: this.responseId,
      createdAt: this.createdAt,
      status: 'completed',
      completedAt: nowSec(),
      output,
      usage: usage ?? this.usage,
    });
    this.completed = true;
    return { type: 'response.completed', response, sequence_number: this.seq++ };
  }

  isCompleted(): boolean {
    return this.completed;
  }
}

export function formatResponsesSseEvent(event: ResponsesSseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
