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
