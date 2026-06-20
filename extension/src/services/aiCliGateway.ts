import * as http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import * as https from 'https';
import { URL } from 'url';
import { findAvailablePortFrom } from '../portUtils';
import {
  inferOpenAiApiFormat,
  isCodexResponsesPath,
  resolveChatCompletionsTargetUrl,
} from './codexApiFormat';
import { resolveCodexChatModel } from './codexModelMapping';
import {
  CodexChatStreamTranslator,
  formatResponsesSseEvent,
  translateChatCompletionToResponses,
  translateResponsesRequestToChat,
} from './codexResponsesBridge';
import {
  buildLocalGatewayBaseUrl,
  resolveUpstreamTargetUrl,
  type AiCliGatewayUpstream,
} from './aiCliGatewayUpstream';
import { applyAnthropicModelMapping } from './anthropicModelMapping';
import {
  OpenAiChatToAnthropicStreamTranslator,
  formatAnthropicSseEvent,
  translateAnthropicMessagesToOpenAiChat,
  translateOpenAiChatToAnthropicMessage,
} from './anthropicOpenAiBridge';
import {
  buildFailoverUpstreamOrder,
  FAILOVER_MAX_ATTEMPTS,
  isCircuitOpen,
  recordUpstreamFailure,
  recordUpstreamSuccess,
  shouldFailoverHttpStatus,
  type CircuitBreakerState,
} from './gatewayFailover';
import {
  extractTokenUsage,
  extractModelFromRequest,
  extractRequestId,
  type TokenUsageRecord,
  type UsageListener,
} from './gatewayUsageTracker';

const DEFAULT_GATEWAY_PORT_START = 15721;
const DEFAULT_GATEWAY_PORT_END = 15820;
const MAX_BODY_BYTES = 64 * 1024 * 1024;

export type AiCliGatewayStatus = {
  running: boolean;
  port?: number;
  baseUrl?: string;
  upstreamBaseUrl?: string;
  error?: string;
};

export type GatewayLogEntry = {
  ts: string;
  method: string;
  path: string;
  upstream: string;
  status: number;
  ms: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  failoverFrom?: string;
};

export type AiCliGatewayLogListener = (entry: GatewayLogEntry) => void;
export type AiCliGatewayFailoverRole = 'claude' | 'codex';

export type AiCliGatewayFailoverListener = (
  upstream: AiCliGatewayUpstream,
  role: AiCliGatewayFailoverRole
) => void;

export type AiCliGatewayFailoverConfig = {
  anthropicUpstreams: AiCliGatewayUpstream[];
  openaiUpstreams: AiCliGatewayUpstream[];
  enabled: boolean;
};

type ProxyAttemptResult = {
  ok: boolean;
  status: number;
  canRetry: boolean;
  detail?: string;
};

function summarizeUpstreamErrorBody(body: Buffer, status: number): string {
  if (body.length === 0) {
    return `upstream HTTP ${status}`;
  }
  const text = body.toString('utf-8').trim();
  if (text.length > 500) {
    return `${text.slice(0, 500)}…`;
  }
  return text;
}

function inferUsageApp(urlPath: string, model: string): 'claude' | 'codex' {
  if (urlPath.includes('/responses') || urlPath.includes('/chat/completions')) {
    return 'codex';
  }
  if (urlPath.includes('/messages') || model.toLowerCase().includes('claude')) {
    return 'claude';
  }
  return 'codex';
}

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('request_body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function isAnthropicMessagesPath(urlPath: string): boolean {
  return urlPath.includes('/messages') && !urlPath.includes('/responses');
}

function applyAnthropicRequestMapping(
  upstream: AiCliGatewayUpstream,
  urlPath: string,
  body: Buffer
): { body: Buffer; model: string } {
  if (!isAnthropicMessagesPath(urlPath) || body.length === 0) {
    return { body, model: '' };
  }
  try {
    const parsed = JSON.parse(body.toString('utf-8')) as Record<string, unknown>;
    const mapped = applyAnthropicModelMapping(parsed, upstream);
    const model =
      mapped.mappedModel ??
      mapped.originalModel ??
      extractModelFromRequest(parsed);
    if (!mapped.mappedModel) {
      return { body, model };
    }
    return { body: Buffer.from(JSON.stringify(mapped.body), 'utf-8'), model };
  } catch {
    return { body, model: '' };
  }
}

function filterForwardHeaders(
  headers: IncomingMessage['headers'],
  upstreamHost: string
): Record<string, string> {
  const out: Record<string, string> = {};
  const skip = new Set(['host', 'connection', 'transfer-encoding']);
  for (const [key, value] of Object.entries(headers)) {
    if (!value || skip.has(key.toLowerCase())) {
      continue;
    }
    out[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  out.host = upstreamHost;
  return out;
}

/**
 * Inject authentication headers for the upstream API.
 *
 * For Anthropic-compatible upstreams: adds `x-api-key` + `Authorization: Bearer`.
 * For OpenAI-compatible upstreams: adds `Authorization: Bearer` only.
 * The `anthropic-version` header is set to `2023-06-01` if present on the request.
 */
function applyUpstreamAuth(
  headers: Record<string, string>,
  apiKey: string,
  upstreamBaseUrl: string
): void {
  const token = apiKey.trim();
  if (!token) {
    return;
  }
  headers.authorization = `Bearer ${token}`;
  const upstreamBase = upstreamBaseUrl.toLowerCase();
  const isOpenAiUpstream = upstreamBase.includes('openai.com');
  if (
    !isOpenAiUpstream &&
    (upstreamBase.includes('anthropic') || headers['anthropic-version'] !== undefined)
  ) {
    if (!headers['anthropic-version']) {
      headers['anthropic-version'] = '2023-06-01';
    }
    headers['x-api-key'] = token;
  }
  delete headers['x-upstream-base'];
}

/**
 * Local HTTP proxy server that intercepts Claude Code / Codex API requests
 * and forwards them to configured upstream providers with format translation.
 *
 * ## Architecture
 *
 * The gateway runs on `127.0.0.1:{port}` and handles two primary request paths:
 *
 * - **Anthropic Messages** (`/v1/messages`): May be forwarded directly
 *   (passthrough) or translated to OpenAI Chat if the upstream provider
 *   has `codexApiFormat` set.
 * - **OpenAI Responses** (`/v1/responses`): May be forwarded directly or
 *   translated to OpenAI Chat via the Codex bridge.
 *
 * ## Format Translation
 *
 * When the upstream provider's API format differs from the client's request
 * format, the gateway uses bridges:
 *
 * - `proxyAnthropicMessagesViaOpenAiChat()` — Anthropic Messages → OpenAI Chat
 * - `proxyCodexResponsesViaChat()` — OpenAI Responses → OpenAI Chat
 *
 * ## Failover
 *
 * When `failoverEnabled` is true, the gateway tries upstream providers in
 * priority order. Circuit breakers prevent hammering failed providers.
 * Successful failover updates the active provider.
 *
 * @see AiCliGatewayManager for provider lifecycle management
 * @see anthropicOpenAiBridge for Anthropic↔OpenAI format translation
 * @see codexResponsesBridge for Codex Responses↔Chat format translation
 */
export class AiCliGateway {
  private server: http.Server | null = null;
  private port: number | null = null;
  /** Active upstream for Anthropic/Claude routes. */
  private upstream: AiCliGatewayUpstream | null = null;
  /** Active upstream for OpenAI/Codex routes. */
  private openaiUpstream: AiCliGatewayUpstream | null = null;
  /** All Anthropic-format upstreams (active + failover candidates). */
  private upstreams: AiCliGatewayUpstream[] = [];
  /** All OpenAI-format upstreams (active + failover candidates). */
  private openaiUpstreams: AiCliGatewayUpstream[] = [];
  private failoverEnabled = false;
  private readonly circuit = new Map<string, CircuitBreakerState>();
  private lastError: string | undefined;
  private logListener: AiCliGatewayLogListener | null = null;
  private usageListener: UsageListener | null = null;
  private failoverListener: AiCliGatewayFailoverListener | null = null;

  onLog(listener: AiCliGatewayLogListener | null): void {
    this.logListener = listener;
  }

  onUsage(listener: UsageListener | null): void {
    this.usageListener = listener;
  }

  onFailover(listener: AiCliGatewayFailoverListener | null): void {
    this.failoverListener = listener;
  }

  private normalizeOpenaiUpstream(upstream: AiCliGatewayUpstream): AiCliGatewayUpstream {
    const baseUrl = upstream.baseUrl.trim();
    return {
      baseUrl,
      apiKey: upstream.apiKey.trim(),
      codexApiFormat: upstream.codexApiFormat ?? inferOpenAiApiFormat(baseUrl),
      codexModel: upstream.codexModel?.trim(),
    };
  }

  setOpenaiUpstream(upstream: AiCliGatewayUpstream | null): void {
    if (upstream?.baseUrl.trim() && upstream.apiKey.trim()) {
      this.openaiUpstream = this.normalizeOpenaiUpstream(upstream);
    } else {
      this.openaiUpstream = null;
    }
  }

  configureFailover(config: AiCliGatewayFailoverConfig): void {
    this.upstreams = config.anthropicUpstreams
      .filter((u) => u.baseUrl.trim() && u.apiKey.trim())
      .map((u) => ({
        ...u,
        baseUrl: u.baseUrl.trim(),
        apiKey: u.apiKey.trim(),
      }));
    this.openaiUpstreams = config.openaiUpstreams
      .filter((u) => u.baseUrl.trim() && u.apiKey.trim())
      .map((u) => this.normalizeOpenaiUpstream(u));
    this.failoverEnabled = config.enabled;
    if (this.upstreams.length > 0) {
      this.upstream = this.upstreams[0];
    }
    if (this.openaiUpstreams.length > 0) {
      this.openaiUpstream = this.openaiUpstreams[0];
    }
  }

  private isFailoverActiveForPath(urlPath: string): boolean {
    if (!this.failoverEnabled) {
      return false;
    }
    if (this.pathNeedsOpenAiUpstream(urlPath)) {
      return this.openaiUpstreams.length > 1;
    }
    return this.upstreams.length > 1;
  }

  private pathNeedsOpenAiUpstream(urlPath: string): boolean {
    return (
      isCodexResponsesPath(urlPath) ||
      urlPath.includes('/chat/completions') ||
      urlPath.includes('/completions')
    );
  }

  private pickUpstreamForPath(urlPath: string): AiCliGatewayUpstream | null {
    if (!this.upstream) {
      return null;
    }
    if (this.pathNeedsOpenAiUpstream(urlPath)) {
      return this.openaiUpstream;
    }
    return this.upstream;
  }

  private orderedUpstreamsForPath(urlPath: string): AiCliGatewayUpstream[] {
    const primary = this.pickUpstreamForPath(urlPath);
    if (!primary) {
      return [];
    }
    const list = this.pathNeedsOpenAiUpstream(urlPath)
      ? this.openaiUpstreams.length > 0
        ? this.openaiUpstreams
        : [primary]
      : this.upstreams.length > 0
        ? this.upstreams
        : [primary];
    return buildFailoverUpstreamOrder(list, primary.baseUrl);
  }

  private failoverRoleForPath(urlPath: string): AiCliGatewayFailoverRole {
    return this.pathNeedsOpenAiUpstream(urlPath) ? 'codex' : 'claude';
  }

  private commitFailoverUpstream(urlPath: string, upstream: AiCliGatewayUpstream): void {
    const role = this.failoverRoleForPath(urlPath);
    if (role === 'codex') {
      this.openaiUpstream = this.normalizeOpenaiUpstream(upstream);
      this.failoverListener?.(this.openaiUpstream, role);
    } else {
      this.upstream = { baseUrl: upstream.baseUrl.trim(), apiKey: upstream.apiKey.trim() };
      this.failoverListener?.(this.upstream, role);
    }
  }

  getStatus(): AiCliGatewayStatus {
    if (!this.server || !this.port) {
      return { running: false, error: this.lastError };
    }
    return {
      running: true,
      port: this.port,
      baseUrl: buildLocalGatewayBaseUrl(this.port),
      upstreamBaseUrl: this.upstream?.baseUrl,
      error: this.lastError,
    };
  }

  async start(upstream: AiCliGatewayUpstream): Promise<AiCliGatewayStatus> {
    const baseUrl = upstream.baseUrl.trim();
    const apiKey = upstream.apiKey.trim();
    if (!baseUrl || !apiKey) {
      throw new Error('upstream_incomplete');
    }
    this.upstream = { baseUrl, apiKey };
    if (this.upstreams.length === 0) {
      this.upstreams = [{ baseUrl, apiKey }];
    }
    if (this.server) {
      return this.getStatus();
    }
    const port = await findAvailablePortFrom(DEFAULT_GATEWAY_PORT_START, DEFAULT_GATEWAY_PORT_END);
    this.lastError = undefined;

    const server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve());
    });
    this.server = server;
    this.port = port;
    return this.getStatus();
  }

  async stop(): Promise<void> {
    if (!this.server) {
      this.port = null;
      this.upstream = null;
      this.upstreams = [];
      return;
    }
    const closing = this.server;
    this.server = null;
    this.port = null;
    this.upstream = null;
    this.openaiUpstream = null;
    this.upstreams = [];
    this.openaiUpstreams = [];
    this.circuit.clear();
    await new Promise<void>((resolve) => {
      closing.close(() => resolve());
    });
  }

  getUpstream(): AiCliGatewayUpstream | null {
    return this.upstream;
  }

  private emitLog(entry: GatewayLogEntry): void {
    this.logListener?.(entry);
  }

  private emitUsage(record: TokenUsageRecord): void {
    this.usageListener?.(record);
  }

  private async handleRequest(clientReq: IncomingMessage, clientRes: ServerResponse): Promise<void> {
    if (!this.upstream || !this.port) {
      this.writeJson(clientRes, 503, { error: 'gateway_not_ready' });
      return;
    }

    const method = clientReq.method ?? 'GET';
    const urlPath = clientReq.url ?? '/';
    const startTime = Date.now();

    if (method === 'OPTIONS') {
      clientRes.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      });
      clientRes.end();
      return;
    }

    if (urlPath === '/health' || urlPath.startsWith('/health?')) {
      this.writeJson(clientRes, 200, {
        ok: true,
        service: 'agentsociety-ai-cli-gateway',
        port: this.port,
        upstream: this.upstream.baseUrl,
        failover: this.failoverEnabled,
      });
      return;
    }

    if (urlPath === '/v1/usage' || urlPath === '/usage') {
      this.writeJson(clientRes, 200, { hint: 'Usage stats are available via the extension UI' });
      return;
    }

    if (!urlPath.startsWith('/v1') && !urlPath.startsWith('/claude/')) {
      this.writeJson(clientRes, 404, { error: 'not_found', hint: 'Use /v1/messages, /v1/responses, or /v1/models' });
      return;
    }

    const isStreaming = clientReq.headers.accept?.includes('text/event-stream') ?? false;
    const isMessages = urlPath.includes('/messages') || urlPath.includes('/responses');
    const needsBodyCapture = isMessages && method === 'POST';

    let body: Buffer;
    try {
      body = method === 'GET' || method === 'HEAD' ? Buffer.alloc(0) : await readRequestBody(clientReq);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.writeJson(clientRes, 413, { error: message });
      return;
    }

    if (this.pathNeedsOpenAiUpstream(urlPath) && !this.openaiUpstream) {
      this.writeJson(clientRes, 503, {
        error: 'codex_upstream_missing',
        message:
          'Codex proxy requires an active OpenAI-format provider with an API key. Add a key or disable Codex local proxy for ChatGPT subscription.',
      });
      return;
    }

    const primaryUpstream = this.pickUpstreamForPath(urlPath);
    if (!primaryUpstream) {
      this.writeJson(clientRes, 503, { error: 'gateway_not_ready' });
      return;
    }

    const usesCodexChatBridge =
      method === 'POST' &&
      isCodexResponsesPath(urlPath) &&
      (primaryUpstream.codexApiFormat ?? inferOpenAiApiFormat(primaryUpstream.baseUrl)) ===
      'openai_chat';

    const usesClaudeOpenAiChatBridge =
      method === 'POST' &&
      isAnthropicMessagesPath(urlPath) &&
      Boolean(primaryUpstream.codexApiFormat);

    if (usesCodexChatBridge || usesClaudeOpenAiChatBridge) {
      const candidates = this.isFailoverActiveForPath(urlPath)
        ? this.orderedUpstreamsForPath(urlPath)
        : [primaryUpstream];
      const maxAttempts = this.isFailoverActiveForPath(urlPath)
        ? Math.min(FAILOVER_MAX_ATTEMPTS, candidates.length)
        : 1;
      let lastStatus = 502;
      let lastFailDetail: string | undefined;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const upstream = candidates[attempt];
        if (!upstream) {
          break;
        }
        if (isCircuitOpen(this.circuit.get(upstream.baseUrl.trim()))) {
          continue;
        }
        try {
          const result = usesClaudeOpenAiChatBridge
            ? await this.proxyAnthropicMessagesViaOpenAiChat(
              clientReq,
              clientRes,
              method,
              urlPath,
              startTime,
              body,
              upstream
            )
            : await this.proxyCodexResponsesViaChat(
              clientReq,
              clientRes,
              method,
              urlPath,
              startTime,
              body,
              upstream
            );
          lastStatus = result.status;
          lastFailDetail = result.detail ?? this.lastError;
          if (result.ok) {
            recordUpstreamSuccess(this.circuit, upstream.baseUrl);
            if (attempt > 0) {
              this.commitFailoverUpstream(urlPath, upstream);
            }
            return;
          }
          recordUpstreamFailure(this.circuit, upstream.baseUrl);
          if (!this.isFailoverActiveForPath(urlPath) || !result.canRetry || clientRes.headersSent) {
            return;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.lastError = message;
          lastFailDetail = message;
          recordUpstreamFailure(this.circuit, upstream.baseUrl);
          if (!this.isFailoverActiveForPath(urlPath) || clientRes.headersSent) {
            this.writeJson(clientRes, 500, { error: 'gateway_error', message });
            return;
          }
        }
      }
      if (!clientRes.headersSent) {
        this.writeJson(clientRes, lastStatus, {
          error: 'failover_exhausted',
          message: lastFailDetail ?? 'All configured upstream providers failed',
          hint: usesClaudeOpenAiChatBridge
            ? 'Claude Code OpenAI-compatible routes translate Anthropic Messages to Chat Completions. Set the provider model explicitly if the upstream rejects Claude model aliases.'
            : 'Third-party Codex routes map gpt-* requests to the provider model (e.g. glm-4.7). Set the model in the provider card or pick a built-in preset.',
        });
      }
      return;
    }

    const candidates = this.isFailoverActiveForPath(urlPath)
      ? this.orderedUpstreamsForPath(urlPath)
      : [primaryUpstream];
    const maxAttempts = this.isFailoverActiveForPath(urlPath)
      ? Math.min(FAILOVER_MAX_ATTEMPTS, candidates.length)
      : 1;
    let lastStatus = 502;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const upstream = candidates[attempt];
      if (!upstream) {
        break;
      }
      if (isCircuitOpen(this.circuit.get(upstream.baseUrl.trim()))) {
        continue;
      }

      try {
        const targetUrl = resolveUpstreamTargetUrl(upstream.baseUrl, urlPath);
        const parsed = new URL(targetUrl);
        const result = isStreaming
          ? await this.proxyStream(
            upstream,
            clientReq,
            clientRes,
            method,
            parsed,
            targetUrl,
            urlPath,
            startTime,
            needsBodyCapture,
            body
          )
          : await this.proxyBuffered(
            upstream,
            clientReq,
            clientRes,
            method,
            parsed,
            targetUrl,
            urlPath,
            startTime,
            needsBodyCapture,
            body
          );

        lastStatus = result.status;

        if (result.ok) {
          recordUpstreamSuccess(this.circuit, upstream.baseUrl);
          if (attempt > 0) {
            this.commitFailoverUpstream(urlPath, upstream);
          }
          return;
        }

        recordUpstreamFailure(this.circuit, upstream.baseUrl);

        if (!this.isFailoverActiveForPath(urlPath) || !result.canRetry || clientRes.headersSent) {
          return;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.lastError = message;
        recordUpstreamFailure(this.circuit, upstream.baseUrl);
        if (!this.isFailoverActiveForPath(urlPath) || clientRes.headersSent) {
          this.writeJson(clientRes, 500, { error: 'gateway_error', message });
          return;
        }
      }
    }

    if (!clientRes.headersSent) {
      this.writeJson(clientRes, lastStatus, {
        error: 'failover_exhausted',
        message: 'All configured upstream providers failed',
      });
    }
  }

  private async proxyStream(
    upstream: AiCliGatewayUpstream,
    clientReq: IncomingMessage,
    clientRes: ServerResponse,
    method: string,
    parsed: URL,
    targetUrl: string,
    urlPath: string,
    startTime: number,
    captureUsage: boolean,
    body: Buffer
  ): Promise<ProxyAttemptResult> {
    const headers = filterForwardHeaders(clientReq.headers, parsed.host);
    headers['x-upstream-base'] = upstream.baseUrl;
    applyUpstreamAuth(headers, upstream.apiKey, upstream.baseUrl);
    const mappedRequest = applyAnthropicRequestMapping(upstream, urlPath, body);
    const forwardedBody = mappedRequest.body;
    if (forwardedBody.length > 0) {
      headers['content-length'] = String(forwardedBody.length);
    }

    let reqModel = mappedRequest.model;
    if (captureUsage && body.length > 0) {
      try {
        reqModel = reqModel || extractModelFromRequest(JSON.parse(body.toString('utf-8')));
      } catch {
        /* ignore */
      }
    }

    const transport = parsed.protocol === 'https:' ? https : http;
    let fullResponse = '';

    return new Promise<ProxyAttemptResult>((resolve) => {
      const proxyReq = transport.request(parsed, { method, headers }, (proxyRes) => {
        const status = proxyRes.statusCode ?? 502;
        const canRetry = shouldFailoverHttpStatus(status) && !clientRes.headersSent;

        if (canRetry) {
          proxyRes.resume();
          resolve({ ok: false, status, canRetry: true });
          return;
        }

        clientRes.writeHead(status, proxyRes.headers as Record<string, string | string[]>);

        if (captureUsage) {
          proxyRes.on('data', (chunk: Buffer) => {
            if (fullResponse.length < 1_000_000) {
              fullResponse += chunk.toString('utf-8');
            }
          });
        }

        proxyRes.pipe(clientRes);
        proxyRes.on('end', () => {
          const ms = Date.now() - startTime;
          this.emitLog({
            ts: new Date().toISOString(),
            method,
            path: urlPath,
            upstream: targetUrl,
            status,
            ms,
            model: reqModel || undefined,
          });
          if (captureUsage && fullResponse) {
            this.processUsageFromSSE(fullResponse, reqModel, targetUrl, urlPath);
          }
          resolve({ ok: status > 0 && status < 500, status, canRetry: false });
        });
        proxyRes.on('error', () => {
          clientRes.end();
          resolve({ ok: false, status, canRetry: false });
        });
      });
      proxyReq.on('error', (err) => {
        this.lastError = err.message;
        if (!clientRes.headersSent) {
          resolve({ ok: false, status: 0, canRetry: true });
          return;
        }
        clientRes.end();
        resolve({ ok: false, status: 502, canRetry: false });
      });
      if (forwardedBody.length > 0) {
        proxyReq.write(forwardedBody);
      }
      proxyReq.end();
    });
  }

  private async proxyBuffered(
    upstream: AiCliGatewayUpstream,
    clientReq: IncomingMessage,
    clientRes: ServerResponse,
    method: string,
    parsed: URL,
    targetUrl: string,
    urlPath: string,
    startTime: number,
    captureUsage: boolean,
    body: Buffer
  ): Promise<ProxyAttemptResult> {
    const headers = filterForwardHeaders(clientReq.headers, parsed.host);
    headers['x-upstream-base'] = upstream.baseUrl;
    applyUpstreamAuth(headers, upstream.apiKey, upstream.baseUrl);
    const mappedRequest = applyAnthropicRequestMapping(upstream, urlPath, body);
    const forwardedBody = mappedRequest.body;
    if (forwardedBody.length > 0) {
      headers['content-length'] = String(forwardedBody.length);
    }

    let reqModel = mappedRequest.model;
    if (captureUsage && body.length > 0) {
      try {
        reqModel = reqModel || extractModelFromRequest(JSON.parse(body.toString('utf-8')));
      } catch {
        /* ignore */
      }
    }

    const transport = parsed.protocol === 'https:' ? https : http;

    return new Promise<ProxyAttemptResult>((resolve) => {
      const proxyReq = transport.request(parsed, { method, headers }, (proxyRes) => {
        const status = proxyRes.statusCode ?? 502;
        const respHeaders = { ...proxyRes.headers } as Record<string, string | string[]>;
        const canRetry = shouldFailoverHttpStatus(status) && !clientRes.headersSent;

        if (canRetry) {
          proxyRes.resume();
          resolve({ ok: false, status, canRetry: true });
          return;
        }

        const isChunked = respHeaders['transfer-encoding']?.toString().includes('chunked');
        const isSse = respHeaders['content-type']?.toString().includes('text/event-stream');

        if (isChunked || isSse) {
          let fullResponse = '';
          if (captureUsage) {
            proxyRes.on('data', (chunk: Buffer) => {
              if (fullResponse.length < 1_000_000) {
                fullResponse += chunk.toString('utf-8');
              }
            });
          }
          clientRes.writeHead(status, respHeaders);
          proxyRes.pipe(clientRes);
          proxyRes.on('end', () => {
            const ms = Date.now() - startTime;
            this.emitLog({
              ts: new Date().toISOString(),
              method,
              path: urlPath,
              upstream: targetUrl,
              status,
              ms,
              model: reqModel || undefined,
            });
            if (captureUsage && fullResponse) {
              this.processUsageFromSSE(fullResponse, reqModel, targetUrl, urlPath);
            }
            resolve({ ok: status > 0 && status < 500, status, canRetry: false });
          });
          proxyRes.on('error', () => {
            clientRes.end();
            resolve({ ok: false, status, canRetry: false });
          });
          return;
        }

        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          const respBody = Buffer.concat(chunks);
          delete respHeaders['transfer-encoding'];
          respHeaders['content-length'] = String(respBody.length);
          clientRes.writeHead(status, respHeaders);
          clientRes.end(respBody);
          const ms = Date.now() - startTime;
          let usageInfo: { model: string; inputTokens: number; outputTokens: number } | null = null;
          if (captureUsage && respBody.length > 0) {
            try {
              const parsedBody = JSON.parse(respBody.toString('utf-8'));
              const extracted = extractTokenUsage(parsedBody);
              if (extracted) {
                usageInfo = extracted;
                this.emitUsage({
                  app: inferUsageApp(urlPath, extracted.model || reqModel),
                  model: extracted.model || reqModel || 'unknown',
                  inputTokens: extracted.inputTokens,
                  outputTokens: extracted.outputTokens,
                  cacheReadTokens: extracted.cacheReadTokens,
                  cacheCreationTokens: extracted.cacheCreationTokens,
                  serverToolUseTokens: extracted.serverToolUseTokens,
                  requestId: extractRequestId(parsedBody),
                  upstream: targetUrl,
                  ts: new Date().toISOString(),
                });
              }
            } catch {
              /* ignore */
            }
          }
          this.emitLog({
            ts: new Date().toISOString(),
            method,
            path: urlPath,
            upstream: targetUrl,
            status,
            ms,
            model: usageInfo?.model || reqModel || undefined,
            inputTokens: usageInfo?.inputTokens,
            outputTokens: usageInfo?.outputTokens,
          });
          resolve({ ok: status > 0 && status < 500, status, canRetry: false });
        });
        proxyRes.on('error', () => {
          clientRes.end();
          resolve({ ok: false, status, canRetry: false });
        });
      });
      proxyReq.on('error', (err) => {
        this.lastError = err.message;
        if (!clientRes.headersSent) {
          resolve({ ok: false, status: 0, canRetry: true });
          return;
        }
        clientRes.end();
        resolve({ ok: false, status: 502, canRetry: false });
      });
      if (forwardedBody.length > 0) {
        proxyReq.write(forwardedBody);
      }
      proxyReq.end();
    });
  }

  private processUsageFromSSE(fullResponse: string, reqModel: string, upstream: string, urlPath: string): void {
    const lines = fullResponse.split('\n');
    let lastUsage: {
      model: string;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      serverToolUseTokens: number;
    } | null = null;
    let lastRequestId = '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) {
        continue;
      }
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') {
        continue;
      }
      try {
        const parsed = JSON.parse(payload);
        const usage = extractTokenUsage(parsed);
        if (usage) {
          lastUsage = usage;
        }
        const rid = extractRequestId(parsed);
        if (rid) {
          lastRequestId = rid;
        }
      } catch {
        /* ignore */
      }
    }
    if (lastUsage) {
      this.emitUsage({
        app: inferUsageApp(urlPath, lastUsage.model || reqModel),
        model: lastUsage.model || reqModel || 'unknown',
        inputTokens: lastUsage.inputTokens,
        outputTokens: lastUsage.outputTokens,
        cacheReadTokens: lastUsage.cacheReadTokens,
        cacheCreationTokens: lastUsage.cacheCreationTokens,
        serverToolUseTokens: lastUsage.serverToolUseTokens,
        requestId: lastRequestId,
        upstream,
        ts: new Date().toISOString(),
      });
    }
  }

  private emitUsageFromResponseBody(
    body: Record<string, unknown>,
    reqModel: string,
    upstream: string,
    urlPath: string
  ): { model: string; inputTokens: number; outputTokens: number } | null {
    const extracted = extractTokenUsage(body);
    if (!extracted) {
      return null;
    }
    this.emitUsage({
      app: inferUsageApp(urlPath, extracted.model || reqModel),
      model: extracted.model || reqModel || 'unknown',
      inputTokens: extracted.inputTokens,
      outputTokens: extracted.outputTokens,
      cacheReadTokens: extracted.cacheReadTokens,
      cacheCreationTokens: extracted.cacheCreationTokens,
      serverToolUseTokens: extracted.serverToolUseTokens,
      requestId: extractRequestId(body),
      upstream,
      ts: new Date().toISOString(),
    });
    return {
      model: extracted.model || reqModel || 'unknown',
      inputTokens: extracted.inputTokens,
      outputTokens: extracted.outputTokens,
    };
  }

  /**
   * Proxy an OpenAI Responses request through an OpenAI Chat-compatible upstream.
   *
   * Translates the Responses-format request to OpenAI Chat Completions,
   * forwards it, and translates the SSE stream back to Responses format.
   *
   * This is used when the active Codex provider has `codexApiFormat='openai_chat'`
   * (all third-party OpenAI-compatible providers).
   *
   * @see CodexChatStreamTranslator for SSE stream translation
   * @see translateResponsesRequestToChat for request translation
   */
  private async proxyCodexResponsesViaChat(
    clientReq: IncomingMessage,
    clientRes: ServerResponse,
    method: string,
    urlPath: string,
    startTime: number,
    body: Buffer,
    upstream: AiCliGatewayUpstream
  ): Promise<ProxyAttemptResult> {

    let responsesRequest: Record<string, unknown>;
    try {
      responsesRequest = JSON.parse(body.toString('utf-8')) as Record<string, unknown>;
    } catch {
      this.writeJson(clientRes, 400, { error: 'invalid_json' });
      return { ok: false, status: 400, canRetry: false };
    }

    const chatModel = resolveCodexChatModel(responsesRequest.model, upstream);
    const chatRequest = translateResponsesRequestToChat(responsesRequest, chatModel);
    const targetUrl = resolveChatCompletionsTargetUrl(upstream.baseUrl);
    const parsed = new URL(targetUrl);
    const isStreaming = chatRequest.stream !== false;
    const headers = filterForwardHeaders(clientReq.headers, parsed.host);
    applyUpstreamAuth(headers, upstream.apiKey, upstream.baseUrl);
    const chatBody = Buffer.from(JSON.stringify(chatRequest), 'utf-8');
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(chatBody.length);
    if (isStreaming) {
      headers.accept = 'text/event-stream';
    }

    const transport = parsed.protocol === 'https:' ? https : http;

    return new Promise<ProxyAttemptResult>((resolve) => {
      const proxyReq = transport.request(parsed, { method, headers }, (proxyRes) => {
        const status = proxyRes.statusCode ?? 502;
        if (status < 200 || status >= 300) {
          const canRetry = shouldFailoverHttpStatus(status) && !clientRes.headersSent;
          const chunks: Buffer[] = [];
          proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
          proxyRes.on('end', () => {
            if (canRetry) {
              resolve({ ok: false, status, canRetry: true });
              return;
            }
            const respBody = Buffer.concat(chunks);
            const detail = summarizeUpstreamErrorBody(respBody, status);
            this.lastError = detail;
            clientRes.writeHead(status, {
              'content-type': proxyRes.headers['content-type'] ?? 'application/json',
              'content-length': String(respBody.length),
            });
            clientRes.end(respBody);
            this.emitLog({
              ts: new Date().toISOString(),
              method,
              path: urlPath,
              upstream: targetUrl,
              status,
              ms: Date.now() - startTime,
              model: chatModel,
            });
            resolve({ ok: false, status, canRetry: false, detail });
          });
          return;
        }

        if (isStreaming) {
          const translator = new CodexChatStreamTranslator(responsesRequest);
          clientRes.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          });
          for (const event of translator.initialEvents()) {
            clientRes.write(formatResponsesSseEvent(event));
          }
          let buffer = '';
          proxyRes.on('data', (chunk: Buffer) => {
            buffer += chunk.toString('utf-8');
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              for (const event of translator.consumeChatSseLine(line)) {
                clientRes.write(formatResponsesSseEvent(event));
              }
            }
          });
          proxyRes.on('end', () => {
            if (buffer) {
              for (const event of translator.consumeChatSseLine(buffer)) {
                clientRes.write(formatResponsesSseEvent(event));
              }
            }
            const completion = translator.completionEvent();
            clientRes.write(formatResponsesSseEvent(completion));
            clientRes.end();
            const responseBody =
              completion.response && typeof completion.response === 'object'
                ? completion.response as Record<string, unknown>
                : null;
            const usageInfo = responseBody
              ? this.emitUsageFromResponseBody(responseBody, chatModel, targetUrl, urlPath)
              : null;
            this.emitLog({
              ts: new Date().toISOString(),
              method,
              path: urlPath,
              upstream: targetUrl,
              status: 200,
              ms: Date.now() - startTime,
              model: usageInfo?.model || chatModel,
              inputTokens: usageInfo?.inputTokens,
              outputTokens: usageInfo?.outputTokens,
            });
            resolve({ ok: true, status: 200, canRetry: false });
          });
          proxyRes.on('error', () => {
            clientRes.end();
            resolve({ ok: false, status: 502, canRetry: false });
          });
          return;
        }

        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          const respBody = Buffer.concat(chunks);
          let chatJson: Record<string, unknown>;
          try {
            chatJson = JSON.parse(respBody.toString('utf-8')) as Record<string, unknown>;
          } catch {
            const detail = summarizeUpstreamErrorBody(respBody, 502);
            this.lastError = detail;
            clientRes.writeHead(502, { 'content-type': 'application/json' });
            clientRes.end(JSON.stringify({ error: 'upstream_invalid_json', message: detail }));
            resolve({ ok: false, status: 502, canRetry: false, detail });
            return;
          }
          const translated = translateChatCompletionToResponses(chatJson, responsesRequest);
          const out = JSON.stringify(translated);
          clientRes.writeHead(200, {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(out),
          });
          clientRes.end(out);
          const usageInfo = this.emitUsageFromResponseBody(translated, chatModel, targetUrl, urlPath);
          this.emitLog({
            ts: new Date().toISOString(),
            method,
            path: urlPath,
            upstream: targetUrl,
            status: 200,
            ms: Date.now() - startTime,
            model: usageInfo?.model || chatModel,
            inputTokens: usageInfo?.inputTokens,
            outputTokens: usageInfo?.outputTokens,
          });
          resolve({ ok: true, status: 200, canRetry: false });
        });
        proxyRes.on('error', () => {
          clientRes.end();
          resolve({ ok: false, status: 502, canRetry: false });
        });
      });
      proxyReq.on('error', (err) => {
        this.lastError = err.message;
        if (!clientRes.headersSent) {
          resolve({ ok: false, status: 0, canRetry: true });
          return;
        }
        clientRes.end();
        resolve({ ok: false, status: 502, canRetry: false });
      });
      proxyReq.write(chatBody);
      proxyReq.end();
    });
  }

  /**
   * Proxy an Anthropic Messages request through an OpenAI Chat-compatible upstream.
   *
   * Translates the Anthropic-format request body to OpenAI Chat Completions,
   * forwards it to the upstream, and translates the SSE stream back to
   * Anthropic Messages format.
   *
   * This is used when the active Claude provider has `apiKind='openai'`.
   *
   * @see OpenAiChatToAnthropicStreamTranslator for SSE stream translation
   * @see translateAnthropicMessagesToOpenAiChat for request translation
   */
  private async proxyAnthropicMessagesViaOpenAiChat(
    clientReq: IncomingMessage,
    clientRes: ServerResponse,
    method: string,
    urlPath: string,
    startTime: number,
    body: Buffer,
    upstream: AiCliGatewayUpstream
  ): Promise<ProxyAttemptResult> {
    let anthropicRequest: Record<string, unknown>;
    try {
      anthropicRequest = JSON.parse(body.toString('utf-8')) as Record<string, unknown>;
    } catch {
      this.writeJson(clientRes, 400, { error: 'invalid_json' });
      return { ok: false, status: 400, canRetry: false };
    }

    const mapped = applyAnthropicModelMapping(anthropicRequest, upstream);
    const chatModel = String(mapped.body.model ?? mapped.mappedModel ?? mapped.originalModel ?? upstream.model ?? 'gpt-4o');
    const chatRequest = translateAnthropicMessagesToOpenAiChat(mapped.body, chatModel);
    const targetUrl = resolveChatCompletionsTargetUrl(upstream.baseUrl);
    const parsed = new URL(targetUrl);
    const isStreaming = chatRequest.stream !== false;
    const headers = filterForwardHeaders(clientReq.headers, parsed.host);
    applyUpstreamAuth(headers, upstream.apiKey, upstream.baseUrl);
    const chatBody = Buffer.from(JSON.stringify(chatRequest), 'utf-8');
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(chatBody.length);
    if (isStreaming) {
      headers.accept = 'text/event-stream';
    }

    const transport = parsed.protocol === 'https:' ? https : http;

    return new Promise<ProxyAttemptResult>((resolve) => {
      const proxyReq = transport.request(parsed, { method, headers }, (proxyRes) => {
        const status = proxyRes.statusCode ?? 502;
        if (status < 200 || status >= 300) {
          const canRetry = shouldFailoverHttpStatus(status) && !clientRes.headersSent;
          const chunks: Buffer[] = [];
          proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
          proxyRes.on('end', () => {
            if (canRetry) {
              resolve({ ok: false, status, canRetry: true });
              return;
            }
            const respBody = Buffer.concat(chunks);
            const detail = summarizeUpstreamErrorBody(respBody, status);
            this.lastError = detail;
            this.writeJson(clientRes, status, { error: 'upstream_error', message: detail });
            resolve({ ok: false, status, canRetry: false, detail });
          });
          return;
        }

        if (isStreaming) {
          clientRes.writeHead(status, {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          });
          const translator = new OpenAiChatToAnthropicStreamTranslator(chatModel);
          let buffer = '';
          let usageInfo: {
            model: string;
            inputTokens: number;
            outputTokens: number;
            cacheReadTokens: number;
            cacheCreationTokens: number;
            serverToolUseTokens: number;
          } | null = null;
          proxyRes.on('data', (chunk: Buffer) => {
            buffer += chunk.toString('utf-8');
            const blocks = buffer.split(/\n\n/);
            buffer = blocks.pop() ?? '';
            for (const block of blocks) {
              const dataLine = block.split(/\r?\n/).find((line) => line.startsWith('data:'));
              if (!dataLine) {
                continue;
              }
              const payload = dataLine.slice(5).trim();
              if (!payload || payload === '[DONE]') {
                continue;
              }
              try {
                const parsedChunk = JSON.parse(payload) as Record<string, unknown>;
                const usage = extractTokenUsage(parsedChunk);
                if (usage) {
                  usageInfo = usage;
                }
                for (const event of translator.acceptChunk(parsedChunk)) {
                  clientRes.write(event);
                }
              } catch {
                /* ignore malformed chunks */
              }
            }
          });
          proxyRes.on('end', () => {
            if (!clientRes.writableEnded) {
              clientRes.end();
            }
            if (usageInfo) {
              this.emitUsage({
                app: 'claude',
                model: usageInfo.model || chatModel,
                inputTokens: usageInfo.inputTokens,
                outputTokens: usageInfo.outputTokens,
                cacheReadTokens: usageInfo.cacheReadTokens,
                cacheCreationTokens: usageInfo.cacheCreationTokens,
                serverToolUseTokens: usageInfo.serverToolUseTokens,
                requestId: '',
                upstream: targetUrl,
                ts: new Date().toISOString(),
              });
            }
            const ms = Date.now() - startTime;
            this.emitLog({
              ts: new Date().toISOString(),
              method,
              path: urlPath,
              upstream: targetUrl,
              status,
              ms,
              model: usageInfo?.model || chatModel,
              inputTokens: usageInfo?.inputTokens,
              outputTokens: usageInfo?.outputTokens,
            });
            resolve({ ok: true, status, canRetry: false });
          });
          proxyRes.on('error', () => {
            clientRes.end();
            resolve({ ok: false, status, canRetry: false });
          });
          return;
        }

        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          const rawBody = Buffer.concat(chunks);
          try {
            const parsedBody = JSON.parse(rawBody.toString('utf-8')) as Record<string, unknown>;
            const translated = translateOpenAiChatToAnthropicMessage(parsedBody, chatModel);
            const usageInfo = this.emitUsageFromResponseBody(translated, chatModel, targetUrl, urlPath);
            const responseBody = Buffer.from(JSON.stringify(translated), 'utf-8');
            clientRes.writeHead(status, {
              'content-type': 'application/json',
              'content-length': String(responseBody.length),
            });
            clientRes.end(responseBody);
            const ms = Date.now() - startTime;
            this.emitLog({
              ts: new Date().toISOString(),
              method,
              path: urlPath,
              upstream: targetUrl,
              status,
              ms,
              model: usageInfo?.model || chatModel,
              inputTokens: usageInfo?.inputTokens,
              outputTokens: usageInfo?.outputTokens,
            });
            resolve({ ok: true, status, canRetry: false });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.lastError = message;
            this.writeJson(clientRes, 502, { error: 'translation_failed', message });
            resolve({ ok: false, status: 502, canRetry: false, detail: message });
          }
        });
      });
      proxyReq.on('error', (err) => {
        this.lastError = err.message;
        if (!clientRes.headersSent) {
          resolve({ ok: false, status: 0, canRetry: true });
          return;
        }
        clientRes.end();
        resolve({ ok: false, status: 502, canRetry: false });
      });
      proxyReq.write(chatBody);
      proxyReq.end();
    });
  }

  private writeJson(res: ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }
}
