import type { AiCliGatewayUpstream } from './aiCliGatewayUpstream';

export const ONE_M_CONTEXT_MARKER = '[1M]';

export function stripOneMContextMarker(model: string): string {
  const trimmed = model.trimEnd();
  const suffix = trimmed.slice(-ONE_M_CONTEXT_MARKER.length);
  if (suffix.toLowerCase() !== ONE_M_CONTEXT_MARKER.toLowerCase()) {
    return model;
  }
  return trimmed.slice(0, -ONE_M_CONTEXT_MARKER.length).trimEnd();
}

export function resolveAnthropicGatewayModel(
  requestedModel: unknown,
  upstream: Pick<
    AiCliGatewayUpstream,
    'model' | 'sonnetModel' | 'opusModel' | 'haikuModel'
  >
): string {
  const requested = typeof requestedModel === 'string' ? requestedModel.trim() : '';
  const normalizedRequested = stripOneMContextMarker(requested);
  const lower = normalizedRequested.toLowerCase();

  if (lower.includes('fable')) {
    return upstream.opusModel?.trim() || upstream.model?.trim() || normalizedRequested;
  }
  if (lower.includes('haiku') && upstream.haikuModel?.trim()) {
    return upstream.haikuModel.trim();
  }
  if (lower.includes('opus') && upstream.opusModel?.trim()) {
    return upstream.opusModel.trim();
  }
  if (lower.includes('sonnet') && upstream.sonnetModel?.trim()) {
    return upstream.sonnetModel.trim();
  }
  if (upstream.model?.trim()) {
    return upstream.model.trim();
  }
  return normalizedRequested;
}

export function applyAnthropicModelMapping(
  body: Record<string, unknown>,
  upstream: Pick<AiCliGatewayUpstream, 'model' | 'sonnetModel' | 'opusModel' | 'haikuModel'>
): { body: Record<string, unknown>; originalModel?: string; mappedModel?: string } {
  const originalModel = typeof body.model === 'string' ? body.model : undefined;
  if (!originalModel) {
    return { body };
  }

  const mappedModel = resolveAnthropicGatewayModel(originalModel, upstream);
  if (!mappedModel || mappedModel === originalModel) {
    return { body, originalModel };
  }

  return {
    body: { ...body, model: mappedModel },
    originalModel,
    mappedModel,
  };
}
