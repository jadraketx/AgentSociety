const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveAnthropicGatewayModel } = require('./out/services/anthropicModelMapping');
const { buildAnthropicGatewayModelsResponse } = require('./out/services/anthropicGatewayModels');
const { shouldDisableCodexWebSearch } = require('./out/services/codexWebSearchPolicy');
const { buildCodexModelCatalogDocument, inferCodexContextWindow } = require('./out/services/codexModelCatalog');
const { upstreamHealth } = require('./out/services/gatewayFailover');

test('resolveAnthropicGatewayModel maps 1M sonnet to the same upstream model', () => {
  const mapped = resolveAnthropicGatewayModel('claude-sonnet-4-6[1M]', {
    sonnetModel: 'glm-5',
    declareSonnet1m: true,
  });
  assert.equal(mapped, 'glm-5');
});

test('resolveAnthropicGatewayModel maps fable role independently', () => {
  const mapped = resolveAnthropicGatewayModel('claude-fable-5[1M]', {
    fableModel: 'glm-5.1',
    opusModel: 'glm-5.1',
    declareFable1m: true,
  });
  assert.equal(mapped, 'glm-5.1');
});

test('buildAnthropicGatewayModelsResponse emits 1M variants when declared', () => {
  const doc = buildAnthropicGatewayModelsResponse({
    sonnetModel: 'glm-5',
    sonnetDisplayName: 'glm-5',
    declareSonnet1m: true,
  });
  const ids = doc.data.map((entry) => entry.id);
  assert.ok(ids.includes('claude-sonnet-4-6'));
  assert.ok(ids.includes('claude-sonnet-4-6[1M]'));
  const oneM = doc.data.find((entry) => entry.id === 'claude-sonnet-4-6[1M]');
  assert.equal(oneM.context_window, 1_048_576);
});

test('shouldDisableCodexWebSearch matches host and model prefix blacklist', () => {
  assert.equal(shouldDisableCodexWebSearch('https://api.xiaomimimo.com/v1', 'mimo-v2'), true);
  assert.equal(shouldDisableCodexWebSearch('https://api.longcat.chat/openai/v1', 'LongCat-2.0'), true);
  assert.equal(shouldDisableCodexWebSearch('https://api.openai.com/v1', 'gpt-5.5'), false);
  assert.equal(shouldDisableCodexWebSearch('https://dashscope.aliyuncs.com/v1', 'qwen3-coder-plus'), true);
  assert.equal(shouldDisableCodexWebSearch('https://dashscope.aliyuncs.com/v1', 'qwen-plus'), false);
});

test('buildCodexModelCatalogDocument uses 1M window when enabled', () => {
  const doc = buildCodexModelCatalogDocument([
    {
      modelId: 'deepseek-v4-pro',
      contextWindow: inferCodexContextWindow('deepseek-v4-pro', true),
      effectiveContextPercent: 100,
    },
  ]);
  assert.equal(doc.models[0].context_window, 1_048_576);
  assert.equal(doc.models[0].effective_context_window_percent, 100);
});

test('extractTokenUsage reads nested response.completed usage', () => {
  const { extractTokenUsage } = require('./out/services/gatewayUsageTracker');
  const parsed = extractTokenUsage({
    type: 'response.completed',
    response: {
      model: 'gpt-5.5',
      usage: { input_tokens: 120, output_tokens: 45 },
    },
  });
  assert.equal(parsed?.inputTokens, 120);
  assert.equal(parsed?.outputTokens, 45);
  assert.equal(parsed?.model, 'gpt-5.5');
});

test('parseClaudeSessionUsageLine reads usage and keeps message id for dedupe', () => {
  const { parseClaudeSessionUsageLine } = require('./out/services/claudeSessionUsage');
  const parsed = parseClaudeSessionUsageLine(JSON.stringify({
    type: 'assistant',
    timestamp: '2026-07-12T04:08:30.302Z',
    message: {
      id: 'msg_123',
      role: 'assistant',
      model: 'glm-4.7',
      usage: {
        input_tokens: 24,
        output_tokens: 242,
        cache_read_input_tokens: 24896,
        cache_creation_input_tokens: 12,
      },
    },
  }), 'Fiblab');
  assert.equal(parsed?.requestId, 'msg_123');
  assert.equal(parsed?.source, 'session');
  assert.equal(parsed?.provider, 'Fiblab');
  assert.equal(parsed?.inputTokens, 24);
  assert.equal(parsed?.outputTokens, 242);
  assert.equal(parsed?.cacheReadTokens, 24896);
  assert.equal(parsed?.cacheCreationTokens, 12);
});

test('web import config retains key and fills Claude role models', () => {
  const {
    buildGatewayProviderFromWebImport,
    resolveWebImportClaudeConfig,
  } = require('./out/services/webConfigGatewayImport');
  const claude = resolveWebImportClaudeConfig({
    openaiCompatible: ['glm-4.7', 'deepseek-v4-flash'],
    claudeCode: [],
    embedding: [],
  }, {
    simulation: 'glm-4.7',
    claudeCodeHaiku: 'deepseek-v4-flash',
  });
  const provider = buildGatewayProviderFromWebImport(
    ' sk-fiblab ',
    ' https://llmapi.fiblab.net/v1 ',
    claude,
    { enableCodex1m: true }
  );
  assert.equal(provider?.name, 'Fiblab');
  assert.equal(provider?.apiKey, 'sk-fiblab');
  assert.equal(provider?.baseUrl, 'https://llmapi.fiblab.net/v1');
  assert.equal(provider?.model, 'glm-4.7');
  assert.equal(provider?.sonnetModel, 'glm-4.7');
  assert.equal(provider?.opusModel, 'glm-4.7');
  assert.equal(provider?.haikuModel, 'deepseek-v4-flash');
  assert.equal(provider?.apiKind, 'openai');
  assert.equal(provider?.codexEnable1m, true);
});

test('selectAccountingUsageRecords deduplicates proxy and session sources', () => {
  const { selectAccountingUsageRecords } = require('./out/services/gatewayUsageTracker');
  const base = {
    app: 'claude',
    model: 'glm-4.7',
    inputTokens: 24,
    outputTokens: 242,
    cacheReadTokens: 24896,
    cacheCreationTokens: 0,
    serverToolUseTokens: 0,
    status: 200,
  };
  const proxy = {
    ...base,
    source: 'proxy',
    requestId: '',
    upstream: 'https://llmapi.fiblab.net/v1',
    ts: '2026-07-12T04:08:28.000Z',
  };
  const session = {
    ...base,
    source: 'session',
    requestId: 'msg_123',
    upstream: 'claude-session',
    ts: '2026-07-12T04:08:30.302Z',
  };
  assert.deepEqual(selectAccountingUsageRecords([proxy, session]), [proxy]);

  const emptyProxy = {
    ...proxy,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
  };
  assert.deepEqual(selectAccountingUsageRecords([emptyProxy, session]), [session]);
});

test('shouldRecordGatewayRequest counts completion posts but not models list', () => {
  const {
    normalizeGatewayRequestPath,
    shouldRecordGatewayRequest,
  } = require('./out/services/aiCliGateway');
  assert.equal(shouldRecordGatewayRequest('GET', '/v1/models?client_version=0.142.5'), false);
  assert.equal(shouldRecordGatewayRequest('POST', '/v1/responses'), true);
  assert.equal(shouldRecordGatewayRequest('GET', '/health'), false);
  assert.equal(normalizeGatewayRequestPath('/api/anthropic/v1/messages'), '/v1/messages');
  assert.equal(
    normalizeGatewayRequestPath('/api/anthropic/v1/models?client_version=2.1.207'),
    '/v1/models?client_version=2.1.207'
  );
});

test('upstreamHealth reports degraded and unhealthy states', () => {
  assert.equal(upstreamHealth(undefined), 'healthy');
  assert.equal(upstreamHealth({ consecutiveFailures: 1, openUntil: 0 }), 'degraded');
  assert.equal(upstreamHealth({ consecutiveFailures: 3, openUntil: Date.now() + 60_000 }), 'unhealthy');
});
