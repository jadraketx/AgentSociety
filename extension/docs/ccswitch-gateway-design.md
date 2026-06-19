# CC Switch Gateway Design Notes

This note summarizes the CC Switch proxy design points that are worth mirroring in the AI Social Scientist VS Code extension gateway.

## Core Shape

CC Switch uses one local proxy as the stable endpoint for coding CLIs. Each CLI is "taken over" by rewriting its live configuration to point at `127.0.0.1:<port>`, while the proxy routes requests to the active provider for that app.

The important separation is:

- App route: Claude Code, Codex, Gemini, etc.
- Provider: API base URL, auth, model mapping, API format, health state.
- Adapter: provider-specific URL, auth headers, request transform, response transform.
- Router: chooses the active provider and failover candidates.

## Provider API Formats

For Claude routes, CC Switch does not assume every provider speaks Anthropic. It records an API format:

- `anthropic`: passthrough Anthropic Messages API.
- `openai_chat`: Anthropic Messages request is transformed to OpenAI Chat Completions; response/SSE is transformed back to Anthropic.
- `openai_responses`: Anthropic Messages request is transformed to OpenAI Responses; response/SSE is transformed back to Anthropic.
- `gemini_native`: Anthropic Messages is transformed to Gemini native.

The key takeaway for this extension: Claude Code should be able to talk to OpenAI-compatible providers through the local gateway, because the gateway presents Anthropic-compatible `/v1/messages` locally and translates upstream.

## Routing And Failover

CC Switch keeps failover per app. When failover is enabled:

- Providers are tried in configured priority order.
- Provider health is tracked separately for each app.
- Circuit breakers suppress providers after repeated failures.
- A successful failover updates the active provider so the UI reflects reality.

For this extension, the current gateway should preserve separate Claude and Codex routes, keep independent active providers, and keep circuit/failure state per upstream.

## Model Mapping

CC Switch maps Claude Code role models before forwarding:

- `sonnet` requests use `ANTHROPIC_DEFAULT_SONNET_MODEL`.
- `opus` requests use `ANTHROPIC_DEFAULT_OPUS_MODEL`.
- `haiku` requests use `ANTHROPIC_DEFAULT_HAIKU_MODEL`.
- `fable` falls back to the opus slot when no dedicated fable slot exists.
- A provider default model is used as fallback.
- Local capability suffixes such as `[1M]` are stripped before sending upstream.

This avoids leaking Claude Code-local model aliases or capability markers to providers that do not understand them.

## Request Rectification

CC Switch includes compatibility rectifiers for provider quirks:

- Strip Claude Code's leading `x-anthropic-billing-header` before OpenAI transforms to improve cache reuse.
- Convert Anthropic `tool_choice` to OpenAI-compatible forms.
- Inject `stream_options.include_usage` for OpenAI streaming so usage is not lost.
- Normalize some provider-specific thinking/reasoning fields.
- Downgrade unsupported media for text-only providers.

For this extension, the first three are the highest-value low-risk features.

## Usage Accounting

CC Switch extracts usage from multiple formats:

- Anthropic: `usage.input_tokens`, `output_tokens`, cache fields.
- OpenAI Chat: `prompt_tokens`, `completion_tokens`, cached token details.
- OpenAI Responses/Codex: `input_tokens`, `output_tokens`, cache details.
- Streaming: parse terminal usage chunks/events where available.

It also avoids writing meaningless all-zero usage rows unless there is a stable message/session id.

## Pricing And Cost Estimation

CC Switch stores model prices in a dedicated `model_pricing` table seeded with built-in prices. Each request log stores token buckets plus calculated costs:

- input cost
- output cost
- cache read cost
- cache creation cost
- total cost

The calculator treats cache semantics differently by app:

- Claude/Anthropic usage reports fresh input separately from cache read, so input cost uses `input_tokens` directly.
- Codex/OpenAI/Gemini often report `input_tokens`/`prompt_tokens` including cache hits, so billable input is `input_tokens - cache_read_tokens`, then cache read is priced separately.

CC Switch also supports:

- provider or app-level cost multiplier
- choosing whether pricing model identity comes from request model or response model
- seeded price repair when built-in prices change
- backfilling missing cost rows before old logs are rolled up

For this extension, the lightweight equivalent is:

- keep built-in model prices in code
- cache detected prices in VS Code global state
- calculate cache read separately
- subtract cache read from Codex/OpenAI billable input
- provide a pricing editor for unknown/custom models

## Usage Dashboard

## What We Port

The extension gateway should mirror these pieces:

- Local `/v1/messages` Anthropic-compatible endpoint for Claude Code.
- Local `/v1/responses` and `/v1/chat/completions` handling for Codex/OpenAI-compatible clients.
- Provider records with `apiKind`/format so a Claude provider may be Anthropic-native or OpenAI-compatible.
- Anthropic role model mapping plus `[1M]` stripping.
- Anthropic Messages to OpenAI Chat translation, including tools and streaming usage.
- OpenAI Chat to Anthropic response/SSE translation.
- Separate usage tracking, provider switching, and failover for Claude and Codex.
- Usage trends with range presets such as 7 days, 30 days, and all history.
- Cost estimation with cached/custom pricing and cache token accounting.
