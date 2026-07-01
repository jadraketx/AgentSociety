const assert = require('node:assert/strict');
const test = require('node:test');

const {
  inferOpenAiApiFormat,
  isCodexResponsesPath,
  resolveChatCompletionsTargetUrl,
} = require('./out/services/codexApiFormat');
const {
  translateResponsesRequestToChat,
  translateChatCompletionToResponses,
  CodexChatStreamTranslator,
  formatResponsesSseEvent,
} = require('./out/services/codexResponsesBridge');
const { buildOpenAiModelsUrl } = require('./out/services/claudeCodeModels');
const { resolveCodexChatModel } = require('./out/services/codexModelMapping');
const {
  applyAnthropicModelMapping,
  resolveAnthropicGatewayModel,
  stripOneMContextMarker,
} = require('./out/services/anthropicModelMapping');
const {
  translateAnthropicMessagesToOpenAiChat,
  translateOpenAiChatToAnthropicMessage,
  OpenAiChatToAnthropicStreamTranslator,
} = require('./out/services/anthropicOpenAiBridge');
const {
  translateResponsesRequestToAnthropicMessages,
  translateAnthropicMessageToResponses,
} = require('./out/services/responsesAnthropicBridge');
const {
  normalizePricingModelId,
  selectObservedRemotePricing,
} = require('./out/services/gatewayRemotePricing');
const {
  calculateCost,
} = require('./out/services/gatewayModelPricing');
const {
  extractTokenUsage,
  parseSseMessages,
} = require('./out/services/gatewayUsageTracker');

function assertNearlyEqual(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`
  );
}

test('inferOpenAiApiFormat distinguishes official vs third-party', () => {
  assert.equal(inferOpenAiApiFormat('https://api.openai.com/v1'), 'openai_responses');
  assert.equal(
    inferOpenAiApiFormat('https://open.bigmodel.cn/api/coding/paas/v4'),
    'openai_chat'
  );
});

test('buildOpenAiModelsUrl for versioned OpenAI-compatible bases', () => {
  assert.equal(
    buildOpenAiModelsUrl('https://open.bigmodel.cn/api/coding/paas/v4'),
    'https://open.bigmodel.cn/api/coding/paas/v4/models'
  );
  assert.equal(
    buildOpenAiModelsUrl('https://open.bigmodel.cn/api/paas/v4'),
    'https://open.bigmodel.cn/api/paas/v4/models'
  );
});

test('resolveChatCompletionsTargetUrl for zhipu bases', () => {
  assert.equal(
    resolveChatCompletionsTargetUrl('https://open.bigmodel.cn/api/coding/paas/v4'),
    'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions'
  );
  assert.equal(
    resolveChatCompletionsTargetUrl('https://open.bigmodel.cn/api/paas/v4'),
    'https://open.bigmodel.cn/api/paas/v4/chat/completions'
  );
});

test('resolveCodexChatModel maps gpt placeholder to glm on bigmodel', () => {
  const model = resolveCodexChatModel('gpt-5-codex', {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    codexApiFormat: 'openai_chat',
  });
  assert.equal(model, 'glm-4.7');
});

test('resolveCodexChatModel keeps provider-configured model', () => {
  const model = resolveCodexChatModel('gpt-5-codex', {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    codexApiFormat: 'openai_chat',
    codexModel: 'glm-4-flash',
  });
  assert.equal(model, 'glm-4-flash');
});

test('stripOneMContextMarker removes Claude Code local capability suffix', () => {
  assert.equal(stripOneMContextMarker('claude-fable-5[1M]'), 'claude-fable-5');
  assert.equal(stripOneMContextMarker('claude-sonnet-4[1m]'), 'claude-sonnet-4');
});

test('resolveAnthropicGatewayModel maps Claude role models like ccswitch', () => {
  const upstream = {
    model: 'fallback-model',
    sonnetModel: 'provider-sonnet',
    opusModel: 'provider-opus',
    haikuModel: 'provider-haiku',
  };
  assert.equal(resolveAnthropicGatewayModel('claude-sonnet-4[1M]', upstream), 'provider-sonnet');
  assert.equal(resolveAnthropicGatewayModel('claude-fable-5[1M]', upstream), 'provider-opus');
  assert.equal(resolveAnthropicGatewayModel('claude-haiku-4', upstream), 'provider-haiku');
});

test('applyAnthropicModelMapping rewrites request model only', () => {
  const mapped = applyAnthropicModelMapping(
    { model: 'claude-opus-4[1M]', messages: [{ role: 'user', content: 'hi' }] },
    { opusModel: 'provider-opus' }
  );
  assert.equal(mapped.originalModel, 'claude-opus-4[1M]');
  assert.equal(mapped.mappedModel, 'provider-opus');
  assert.equal(mapped.body.model, 'provider-opus');
  assert.deepEqual(mapped.body.messages, [{ role: 'user', content: 'hi' }]);
});

test('translateAnthropicMessagesToOpenAiChat maps Claude Code request to OpenAI chat', () => {
  const chat = translateAnthropicMessagesToOpenAiChat(
    {
      model: 'provider-sonnet',
      system: 'x-anthropic-billing-header: cch=test\n\nYou are helpful',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      max_tokens: 100,
      stream: true,
      tools: [{ name: 'Read', description: 'read file', input_schema: { type: 'object' } }],
      tool_choice: { type: 'any' },
    },
    'provider-sonnet'
  );
  assert.equal(chat.model, 'provider-sonnet');
  assert.equal(chat.messages[0].role, 'system');
  assert.equal(chat.messages[0].content, 'You are helpful');
  assert.equal(chat.messages[1].content, 'hello');
  assert.equal(chat.tool_choice, 'required');
  assert.equal(chat.stream_options.include_usage, true);
});

test('translateOpenAiChatToAnthropicMessage maps tool calls back to Anthropic', () => {
  const msg = translateOpenAiChatToAnthropicMessage(
    {
      id: 'chatcmpl-test',
      model: 'provider-sonnet',
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: 'I will read it',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'Read', arguments: '{"file_path":"README.md"}' },
          }],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 3 } },
    },
    'provider-sonnet'
  );
  assert.equal(msg.stop_reason, 'tool_use');
  assert.equal(msg.usage.input_tokens, 7);
  assert.equal(msg.usage.cache_read_input_tokens, 3);
  assert.equal(msg.content[1].type, 'tool_use');
  assert.deepEqual(msg.content[1].input, { file_path: 'README.md' });
});

test('selectObservedRemotePricing matches provider-prefixed and dated model ids', () => {
  const selected = selectObservedRemotePricing(
    {
      'anthropic/claude-sonnet-4-20250514': { inputPerMillion: 3, outputPerMillion: 15 },
      'gpt-5-codex': { inputPerMillion: 1.25, outputPerMillion: 10 },
    },
    ['claude-sonnet-4[1M]', 'openai/gpt-5-codex']
  );
  assert.equal(normalizePricingModelId('anthropic/claude-sonnet-4-20250514'), 'claude-sonnet-4');
  assert.equal(selected['claude-sonnet-4[1M]'].inputPerMillion, 3);
  assert.equal(selected['openai/gpt-5-codex'].outputPerMillion, 10);
});

test('calculateCost prices Codex cache reads separately from billable input', () => {
  const price = {
    'test-model': {
      inputPerMillion: 10,
      outputPerMillion: 20,
      cacheReadPerMillion: 1,
      cacheCreationPerMillion: 12,
    },
  };
  const codex = calculateCost('test-model', 1_000_000, 500_000, 400_000, 100_000, price, {
    app: 'codex',
  });
  assert.equal(codex.input, 6);
  assert.equal(codex.output, 10);
  assert.equal(codex.cacheRead, 0.4);
  assertNearlyEqual(codex.cacheCreation, 1.2);
  assertNearlyEqual(codex.total, 17.6);

  const claude = calculateCost('test-model', 1_000_000, 500_000, 400_000, 100_000, price, {
    app: 'claude',
  });
  assert.equal(claude.input, 10);
  assertNearlyEqual(claude.total, 21.6);
});

test('translateResponsesRequestToChat maps instructions and input', () => {
  const chat = translateResponsesRequestToChat(
    {
      model: 'gpt-5-codex',
      instructions: 'You are helpful',
      input: 'hello',
      stream: false,
    },
    'glm-4.7'
  );
  assert.equal(chat.model, 'glm-4.7');
  assert.equal(chat.stream, false);
  assert.equal(chat.messages[0].role, 'system');
  assert.equal(chat.messages[1].role, 'user');
  assert.equal(chat.messages[1].content, 'hello');
});

test('translateChatCompletionToResponses builds response shell', () => {
  const response = translateChatCompletionToResponses(
    {
      id: 'chatcmpl-test',
      choices: [{ message: { role: 'assistant', content: 'hi there' } }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    },
    { model: 'glm-4.7', input: 'hello' }
  );
  assert.equal(response.status, 'completed');
  assert.equal(response.model, 'glm-4.7');
  assert.ok(Array.isArray(response.output));
});

test('translateResponsesRequestToAnthropicMessages maps Codex Responses to Anthropic', () => {
  const msg = translateResponsesRequestToAnthropicMessages(
    {
      model: 'gpt-5-codex',
      instructions: 'You are helpful',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
      max_output_tokens: 100,
      stream: false,
      tools: [{ type: 'function', name: 'Read', parameters: { type: 'object' } }],
    },
    'claude-sonnet-4'
  );
  assert.equal(msg.model, 'claude-sonnet-4');
  assert.equal(msg.system, 'You are helpful');
  assert.equal(msg.messages[0].role, 'user');
  assert.equal(msg.messages[0].content, 'hello');
  assert.equal(msg.tools[0].name, 'Read');
  assert.equal(msg.stream, false);
});

test('translateResponsesRequestToAnthropicMessages preserves tool call context and tool choice', () => {
  const msg = translateResponsesRequestToAnthropicMessages(
    {
      model: 'gpt-5-codex',
      input: [
        { type: 'function_call', call_id: 'call_1', name: 'Read', arguments: '{"file_path":"README.md"}' },
        { type: 'function_call_output', call_id: 'call_1', output: 'contents' },
        { role: 'user', content: [{ type: 'input_text', text: 'continue' }] },
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'Read',
          description: 'read a file',
          parameters: { type: 'object', properties: { file_path: { type: 'string' } } },
        },
      }],
      tool_choice: { type: 'function', function: { name: 'Read' } },
      temperature: 0.2,
      top_p: 0.8,
      max_output_tokens: 123,
    },
    'claude-sonnet-4'
  );
  assert.equal(msg.max_tokens, 123);
  assert.equal(msg.temperature, 0.2);
  assert.equal(msg.top_p, 0.8);
  assert.equal(msg.messages[0].role, 'assistant');
  assert.equal(msg.messages[0].content[0].type, 'tool_use');
  assert.equal(msg.messages[0].content[0].id, 'call_1');
  assert.deepEqual(msg.messages[0].content[0].input, { file_path: 'README.md' });
  assert.equal(msg.messages[1].content[0].type, 'tool_result');
  assert.equal(msg.messages[1].content[0].tool_use_id, 'call_1');
  assert.equal(msg.tools[0].input_schema.properties.file_path.type, 'string');
  assert.deepEqual(msg.tool_choice, { type: 'tool', name: 'Read' });
});

test('translateAnthropicMessageToResponses maps text, tool use, and usage', () => {
  const response = translateAnthropicMessageToResponses(
    {
      id: 'msg_1',
      model: 'claude-sonnet-4',
      content: [
        { type: 'text', text: 'done' },
        { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'README.md' } },
      ],
      usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 2 },
    },
    { model: 'gpt-5-codex', input: 'hello' }
  );
  assert.equal(response.status, 'completed');
  assert.equal(response.model, 'claude-sonnet-4');
  assert.equal(response.output[0].content[0].text, 'done');
  assert.equal(response.output[1].type, 'function_call');
  assert.equal(response.usage.input_tokens, 9);
  assert.equal(response.usage.input_tokens_details.cached_tokens, 2);
});

test('parseSseMessages handles CRLF blocks and preserves usage chunks', () => {
  const raw = [
    'data: {"id":"chatcmpl_1","model":"glm-5.1","choices":[{"delta":{"content":"hi"}}]}',
    '',
    'data: {"id":"chatcmpl_1","model":"glm-5.1","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":4}}}',
    '',
    'data: [DONE]',
    '',
  ].join('\r\n');
  const messages = parseSseMessages(raw);
  assert.equal(messages.length, 3);
  const usage = extractTokenUsage(JSON.parse(messages[1].data));
  assert.equal(usage.inputTokens, 12);
  assert.equal(usage.outputTokens, 5);
  assert.equal(usage.cacheReadTokens, 4);
});

test('extractTokenUsage recognizes OpenAI chat usage instead of swallowing it as Anthropic', () => {
  const usage = extractTokenUsage({
    id: 'chatcmpl_1',
    model: 'glm-5.1',
    usage: {
      prompt_tokens: 12,
      completion_tokens: 5,
      prompt_tokens_details: { cached_tokens: 4 },
    },
  });
  assert.equal(usage.inputTokens, 12);
  assert.equal(usage.outputTokens, 5);
  assert.equal(usage.cacheReadTokens, 4);
});

test('extractTokenUsage keeps Anthropic cache usage fields', () => {
  const usage = extractTokenUsage({
    id: 'msg_1',
    model: 'claude-sonnet-4',
    usage: {
      input_tokens: 12,
      output_tokens: 5,
      cache_read_input_tokens: 7,
      cache_creation_input_tokens: 3,
    },
  });
  assert.equal(usage.inputTokens, 12);
  assert.equal(usage.outputTokens, 5);
  assert.equal(usage.cacheReadTokens, 7);
  assert.equal(usage.cacheCreationTokens, 3);
});

test('parseSseMessages joins multi-line data payloads', () => {
  const messages = parseSseMessages('event: message_delta\ndata: {"usage":\ndata: {"input_tokens":3,"output_tokens":2}}\n\n');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].event, 'message_delta');
  const usage = extractTokenUsage(JSON.parse(messages[0].data));
  assert.equal(usage.inputTokens, 3);
  assert.equal(usage.outputTokens, 2);
});

// --- Stream translator: multi-block index correctness ---------------------
// These cover reasoning + text + tool_use in the same response, where the
// old implementation mis-indexed deltas (text/tool deltas pointed at the
// wrong block).

// Parse the raw SSE strings a translator emits into a flat list of events.
function parseSseEvents(rawStrings) {
  const events = [];
  for (const raw of rawStrings) {
    for (const block of raw.split(/\n\n/)) {
      const evtLine = block.split(/\r?\n/).find((l) => l.startsWith('event:'));
      const dataLine = block.split(/\r?\n/).find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      events.push({
        type: evtLine ? evtLine.slice(6).trim() : null,
        data: JSON.parse(dataLine.slice(5).trim()),
      });
    }
  }
  return events;
}

test('OpenAiChatToAnthropicStreamTranslator indexes thinking+text+tool_use correctly', () => {
  const t = new OpenAiChatToAnthropicStreamTranslator('glm-5.1');
  const raw = [];
  // chunk 1: reasoning
  raw.push(...t.acceptChunk({
    id: 'msg_1', model: 'glm-5.1',
    choices: [{ index: 0, delta: { reasoning_content: 'think' } }],
  }));
  // chunk 2: text (closes thinking at index 0, opens text at index 1)
  raw.push(...t.acceptChunk({
    choices: [{ index: 0, delta: { content: 'hello' } }],
  }));
  // chunk 3: tool_call (closes text at index 1, opens tool_use at index 2)
  raw.push(...t.acceptChunk({
    choices: [{
      index: 0,
      delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'Bash', arguments: '{"a":1}' } }] },
    }],
  }));
  // chunk 4: finish
  raw.push(...t.acceptChunk({
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
  }));

  const events = parseSseEvents(raw);
  const byType = {};
  for (const e of events) (byType[e.type] ??= []).push(e.data);

  // thinking block opened and stopped at index 0
  assert.equal(byType['content_block_start'][0].index, 0);
  assert.equal(byType['content_block_start'][0].content_block.type, 'thinking');
  assert.equal(byType['content_block_delta'].filter((d) => d.delta.type === 'thinking_delta')[0].index, 0);

  // text block opened at index 1, delta also at 1 (NOT hardcoded 0)
  const textStart = byType['content_block_start'].find((d) => d.content_block.type === 'text');
  assert.equal(textStart.index, 1);
  assert.equal(byType['content_block_delta'].filter((d) => d.delta.type === 'text_delta')[0].index, 1);

  // tool_use block opened at index 2, its input_json_delta also at 2
  const toolStart = byType['content_block_start'].find((d) => d.content_block.type === 'tool_use');
  assert.equal(toolStart.index, 2);
  assert.equal(byType['content_block_delta'].filter((d) => d.delta.type === 'input_json_delta')[0].index, 2);

  // three content_block_stop events, one per block, with distinct indices 0,1,2
  const stopIndices = byType['content_block_stop'].map((d) => d.index).sort((a, b) => a - b);
  assert.deepEqual(stopIndices, [0, 1, 2]);

  // tool_use reflected in stop_reason
  assert.equal(byType['message_delta'][0].delta.stop_reason, 'tool_use');
});

test('OpenAiChatToAnthropicStreamTranslator handles two sequential tool_calls', () => {
  const t = new OpenAiChatToAnthropicStreamTranslator('glm-5.1');
  const raw = [];
  raw.push(...t.acceptChunk({
    choices: [{
      index: 0,
      delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'A', arguments: '{"x":1}' } }] },
    }],
  }));
  raw.push(...t.acceptChunk({
    choices: [{
      index: 0,
      delta: { tool_calls: [{ index: 1, id: 'c2', type: 'function', function: { name: 'B', arguments: '{"y":2}' } }] },
    }],
  }));
  raw.push(...t.acceptChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }));

  const events = parseSseEvents(raw);
  const toolStarts = events
    .filter((e) => e.type === 'content_block_start' && e.data.content_block.type === 'tool_use')
    .map((e) => e.data.index);
  // two tool_use blocks at indices 0 and 1 (no text/thinking before them)
  assert.deepEqual(toolStarts, [0, 1]);
  // both stopped
  assert.equal(events.filter((e) => e.type === 'content_block_stop').length, 2);
});

test('CodexChatStreamTranslator assigns correct output_index for reasoning+tool+text', () => {
  const t = new CodexChatStreamTranslator({ model: 'glm-4.7', input: [], stream: true });
  // Build SSE lines exactly as an OpenAI Chat upstream would send them.
  const line = (payload) => `data: ${JSON.stringify(payload)}`;
  const raw = [];
  raw.push(...t.consumeChatSseLine(line({
    id: 'chatcmpl-1', model: 'glm-4.7',
    choices: [{ index: 0, delta: { reasoning_content: 'reason' } }],
  })));
  // tool call arrives BEFORE text
  raw.push(...t.consumeChatSseLine(line({
    choices: [{
      index: 0,
      delta: { tool_calls: [{ index: 0, id: 'call_9', type: 'function', function: { name: 'Bash', arguments: '{"c":3}' } }] },
    }],
  })));
  // text arrives AFTER the tool call
  raw.push(...t.consumeChatSseLine(line({
    choices: [{ index: 0, delta: { content: 'done' } }],
  })));

  const indicesByType = {};
  for (const evt of raw) {
    const oi = evt.output_index;
    if (oi === undefined) continue;
    const key = evt.type;
    (indicesByType[key] ??= new Set()).add(oi);
  }

  // reasoning_text.delta must use the reasoning item's index (consistent within the type)
  assert.equal(indicesByType['response.reasoning_text.delta'].size, 1);
  // function_call_arguments.delta must use the tool item's index
  assert.equal(indicesByType['response.function_call_arguments.delta'].size, 1);
  // output_text.delta must NOT be hardcoded to a wrong index; it equals the message item's index
  // and differs from the reasoning/tool indices.
  const textIdx = [...indicesByType['response.output_text.delta']][0];
  const reasonIdx = [...indicesByType['response.reasoning_text.delta']][0];
  const toolIdx = [...indicesByType['response.function_call_arguments.delta']][0];
  assert.notEqual(textIdx, reasonIdx, 'text output_index must not collide with reasoning');
  assert.notEqual(textIdx, toolIdx, 'text output_index must not collide with tool_call');

  // completionEvent should surface all three output items
  const completion = t.completionEvent();
  const types = completion.response.output.map((o) => o.type);
  assert.ok(types.includes('reasoning'));
  assert.ok(types.includes('function_call'));
  assert.ok(types.includes('message'));
});
