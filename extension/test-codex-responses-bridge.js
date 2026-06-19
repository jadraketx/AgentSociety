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
} = require('./out/services/anthropicOpenAiBridge');
const {
  normalizePricingModelId,
  selectObservedRemotePricing,
} = require('./out/services/gatewayRemotePricing');
const {
  calculateCost,
} = require('./out/services/gatewayModelPricing');

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
