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

test('shouldRecordGatewayRequest counts models list and completion posts', () => {
  const { shouldRecordGatewayRequest } = require('./out/services/aiCliGateway');
  assert.equal(shouldRecordGatewayRequest('GET', '/v1/models?client_version=0.142.5'), true);
  assert.equal(shouldRecordGatewayRequest('POST', '/v1/responses'), true);
  assert.equal(shouldRecordGatewayRequest('GET', '/health'), false);
});

test('upstreamHealth reports degraded and unhealthy states', () => {
  assert.equal(upstreamHealth(undefined), 'healthy');
  assert.equal(upstreamHealth({ consecutiveFailures: 1, openUntil: 0 }), 'degraded');
  assert.equal(upstreamHealth({ consecutiveFailures: 3, openUntil: Date.now() + 60_000 }), 'unhealthy');
});
