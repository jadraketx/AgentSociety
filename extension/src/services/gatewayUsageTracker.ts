export type TokenUsageRecord = {
  app?: 'claude' | 'codex';
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  serverToolUseTokens: number;
  requestId: string;
  upstream: string;
  ts: string;
};

export type UsageModelStats = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  requests: number;
};

export type UsageTimeBucket = {
  key: string;
  label: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

export type UsageAggregation = {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalRequests: number;
  totalTokens: number;
  cacheHitRate: number;
  byModel: Record<string, UsageModelStats>;
  byDay: Record<string, UsageModelStats>;
  byApp: Record<'claude' | 'codex', UsageModelStats>;
  timeSeries: UsageTimeBucket[];
};

export type UsageListener = (record: TokenUsageRecord) => void;

export type SseMessage = {
  event: string;
  data: string;
};

export function parseSseMessages(input: string): SseMessage[] {
  const messages: SseMessage[] = [];
  for (const block of input.split(/\r?\n\r?\n/)) {
    if (!block.trim()) {
      continue;
    }
    let event = '';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        const value = line.slice(5);
        data.push(value.startsWith(' ') ? value.slice(1) : value);
      }
    }
    if (data.length > 0) {
      messages.push({ event, data: data.join('\n').trim() });
    }
  }
  return messages;
}

function tryParseAnthropicUsage(obj: unknown): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  serverToolUseTokens: number;
} | null {
  if (!obj || typeof obj !== 'object') {
    return null;
  }
  const o = obj as Record<string, unknown>;
  const u = (o.usage ?? o.token_usage ?? o.count_tokens) as Record<string, unknown> | undefined;
  if (!u) {
    return null;
  }
  const hasAnthropicUsage =
    typeof u.input_tokens === 'number' ||
    typeof u.output_tokens === 'number' ||
    typeof u.cache_read_input_tokens === 'number' ||
    typeof u.cache_creation_input_tokens === 'number' ||
    typeof u.server_tool_use_input_tokens === 'number';
  if (!hasAnthropicUsage) {
    return null;
  }
  return {
    inputTokens: typeof u.input_tokens === 'number' ? u.input_tokens : 0,
    outputTokens: typeof u.output_tokens === 'number' ? u.output_tokens : 0,
    cacheReadTokens:
      typeof u.cache_read_input_tokens === 'number'
        ? u.cache_read_input_tokens
        : typeof u.cache_read_tokens === 'number'
          ? u.cache_read_tokens
          : 0,
    cacheCreationTokens:
      typeof u.cache_creation_input_tokens === 'number'
        ? u.cache_creation_input_tokens
        : typeof u.cache_creation_tokens === 'number'
          ? u.cache_creation_tokens
          : 0,
    serverToolUseTokens:
      typeof u.server_tool_use_input_tokens === 'number'
        ? u.server_tool_use_input_tokens
        : 0,
  };
}

function tryParseOpenAIUsage(obj: unknown): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  serverToolUseTokens: number;
} | null {
  if (!obj || typeof obj !== 'object') {
    return null;
  }
  const o = obj as Record<string, unknown>;
  const u = o.usage as Record<string, unknown> | undefined;
  if (!u) {
    return null;
  }
  const promptDetails =
    typeof u.prompt_tokens_details === 'object' && u.prompt_tokens_details !== null
      ? u.prompt_tokens_details as Record<string, unknown>
      : {};
  const inputDetails =
    typeof u.input_tokens_details === 'object' && u.input_tokens_details !== null
      ? u.input_tokens_details as Record<string, unknown>
      : {};
  return {
    inputTokens:
      typeof u.prompt_tokens === 'number'
        ? u.prompt_tokens
        : typeof u.input_tokens === 'number'
          ? u.input_tokens
          : 0,
    outputTokens:
      typeof u.completion_tokens === 'number'
        ? u.completion_tokens
        : typeof u.output_tokens === 'number'
          ? u.output_tokens
          : 0,
    cacheReadTokens:
      typeof promptDetails.cached_tokens === 'number'
        ? promptDetails.cached_tokens
        : typeof inputDetails.cached_tokens === 'number'
          ? inputDetails.cached_tokens
          : 0,
    cacheCreationTokens: 0,
    serverToolUseTokens: 0,
  };
}

export function extractTokenUsage(body: unknown): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  serverToolUseTokens: number;
  model: string;
} | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const o = body as Record<string, unknown>;
  const model =
    typeof o.model === 'string' && o.model
      ? o.model
      : '';

  const usage = o.usage && typeof o.usage === 'object'
    ? o.usage as Record<string, unknown>
    : {};
  const hasOpenAiUsage =
    typeof usage.prompt_tokens === 'number' ||
    typeof usage.completion_tokens === 'number' ||
    typeof usage.prompt_tokens_details === 'object' ||
    typeof usage.completion_tokens_details === 'object' ||
    typeof usage.input_tokens_details === 'object';

  let parsed = hasOpenAiUsage ? tryParseOpenAIUsage(o) : tryParseAnthropicUsage(o);
  if (!parsed) {
    parsed = hasOpenAiUsage ? tryParseAnthropicUsage(o) : tryParseOpenAIUsage(o);
  }
  if (!parsed) {
    return null;
  }
  if (
    parsed.inputTokens === 0 &&
    parsed.outputTokens === 0 &&
    parsed.cacheReadTokens === 0 &&
    parsed.cacheCreationTokens === 0
  ) {
    return null;
  }
  return { ...parsed, model };
}

export function extractModelFromRequest(body: unknown): string {
  if (!body || typeof body !== 'object') {
    return '';
  }
  const o = body as Record<string, unknown>;
  return typeof o.model === 'string' && o.model ? o.model : '';
}

export function extractRequestId(body: unknown): string {
  if (!body || typeof body !== 'object') {
    return '';
  }
  const o = body as Record<string, unknown>;
  return typeof o.id === 'string' && o.id ? o.id : '';
}

function emptyModelStats(): UsageModelStats {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, requests: 0 };
}

function addRecordToStats(stats: UsageModelStats, r: TokenUsageRecord): void {
  stats.input += r.inputTokens;
  stats.output += r.outputTokens;
  stats.cacheRead += r.cacheReadTokens;
  stats.cacheCreation += r.cacheCreationTokens;
  stats.requests += 1;
}

function inferLegacyApp(model: string): 'claude' | 'codex' {
  const id = model.toLowerCase();
  return id.includes('codex') || id.startsWith('gpt-') || /^o\d/.test(id) ? 'codex' : 'claude';
}

export function computeCacheHitRate(
  inputTokens: number,
  cacheReadTokens: number
): number {
  const cacheable = inputTokens + cacheReadTokens;
  if (cacheable <= 0) {
    return 0;
  }
  return Math.min(100, (cacheReadTokens / cacheable) * 100);
}

function bucketKey(ts: string): string {
  return ts.slice(0, 10);
}

function formatBucketLabel(key: string): string {
  return key.slice(5);
}

export function buildUsageTimeSeries(
  records: TokenUsageRecord[],
  maxPoints = 30
): UsageTimeBucket[] {
  if (records.length === 0) {
    return [];
  }
  const sorted = [...records].sort((a, b) => a.ts.localeCompare(b.ts));
  const map = new Map<string, UsageTimeBucket>();

  for (const r of sorted) {
    const key = bucketKey(r.ts);
    let b = map.get(key);
    if (!b) {
      b = {
        key,
        label: formatBucketLabel(key),
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };
      map.set(key, b);
    }
    b.requests += 1;
    b.inputTokens += r.inputTokens;
    b.outputTokens += r.outputTokens;
    b.cacheReadTokens += r.cacheReadTokens;
    b.cacheCreationTokens += r.cacheCreationTokens;
  }

  const series = [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  if (series.length <= maxPoints) {
    return series;
  }
  return series.slice(-maxPoints);
}

export function aggregateUsage(records: TokenUsageRecord[]): UsageAggregation {
  const agg: UsageAggregation = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    totalRequests: records.length,
    totalTokens: 0,
    cacheHitRate: 0,
    byModel: {},
    byDay: {},
    byApp: {
      claude: emptyModelStats(),
      codex: emptyModelStats(),
    },
    timeSeries: [],
  };
  for (const r of records) {
    agg.totalInputTokens += r.inputTokens;
    agg.totalOutputTokens += r.outputTokens;
    agg.totalCacheReadTokens += r.cacheReadTokens;
    agg.totalCacheCreationTokens += r.cacheCreationTokens;
    const modelKey = r.model || 'unknown';
    const m = agg.byModel[modelKey] ?? emptyModelStats();
    addRecordToStats(m, r);
    agg.byModel[modelKey] = m;
    const day = r.ts.slice(0, 10);
    const d = agg.byDay[day] ?? emptyModelStats();
    addRecordToStats(d, r);
    agg.byDay[day] = d;
    const app = r.app ?? inferLegacyApp(r.model);
    addRecordToStats(agg.byApp[app], r);
  }
  agg.totalTokens =
    agg.totalInputTokens +
    agg.totalOutputTokens +
    agg.totalCacheReadTokens +
    agg.totalCacheCreationTokens;
  agg.cacheHitRate = computeCacheHitRate(agg.totalInputTokens, agg.totalCacheReadTokens);
  agg.timeSeries = buildUsageTimeSeries(records);
  return agg;
}
