import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const CODEX_MODEL_CATALOG_FILENAME = 'agentsociety-model-catalog.json';
export const CODEX_DEFAULT_CONTEXT_WINDOW = 272_000;
export const CODEX_ONE_M_CONTEXT_WINDOW = 1_048_576;
export const CODEX_DEFAULT_EFFECTIVE_CONTEXT_PERCENT = 95;
export const CODEX_ONE_M_AUTO_COMPACT_LIMIT = 900_000;

const DEFAULT_BASE_INSTRUCTIONS =
  'You are Codex, a coding agent built by OpenAI. Follow the user instructions and use available tools when helpful.';

export type CodexCatalogEntry = {
  modelId: string;
  displayName?: string;
  contextWindow: number;
  effectiveContextPercent?: number;
  baseInstructions?: string;
};

export type CodexCatalogWriteOptions = {
  codexHome?: string;
  entries: CodexCatalogEntry[];
};

function resolveCodexHome(codexHome?: string): string {
  const configured = codexHome?.trim();
  if (configured) {
    return configured;
  }
  const envHome = process.env.CODEX_HOME?.trim();
  return envHome || path.join(os.homedir(), '.codex');
}

export function resolveCodexModelCatalogPath(codexHome?: string): string {
  return path.join(resolveCodexHome(codexHome), CODEX_MODEL_CATALOG_FILENAME);
}

export function buildCodexModelCatalogDocument(entries: CodexCatalogEntry[]): Record<string, unknown> {
  const models = entries.map((entry) => {
    const modelId = entry.modelId.trim();
    const contextWindow = entry.contextWindow > 0 ? entry.contextWindow : CODEX_DEFAULT_CONTEXT_WINDOW;
    const effectiveContextPercent =
      entry.effectiveContextPercent && entry.effectiveContextPercent > 0
        ? entry.effectiveContextPercent
        : CODEX_DEFAULT_EFFECTIVE_CONTEXT_PERCENT;
    return {
      slug: modelId,
      model: modelId,
      display_name: entry.displayName?.trim() || modelId,
      context_window: contextWindow,
      effective_context_window_percent: effectiveContextPercent,
      base_instructions: entry.baseInstructions?.trim() || DEFAULT_BASE_INSTRUCTIONS,
      supports_parallel_tool_calls: true,
      input_modalities: ['text'],
    };
  });
  return { models };
}

export function writeCodexModelCatalog(options: CodexCatalogWriteOptions): string {
  const catalogPath = resolveCodexModelCatalogPath(options.codexHome);
  const dir = path.dirname(catalogPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const payload = buildCodexModelCatalogDocument(options.entries);
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  const tmpPath = `${catalogPath}.tmp`;
  fs.writeFileSync(tmpPath, json, 'utf-8');
  try {
    fs.chmodSync(tmpPath, 0o600);
  } catch {
    /* ignore */
  }
  fs.renameSync(tmpPath, catalogPath);
  return catalogPath;
}

export function inferCodexContextWindow(modelId: string, enable1m?: boolean): number {
  if (enable1m) {
    return CODEX_ONE_M_CONTEXT_WINDOW;
  }
  const lower = modelId.trim().toLowerCase();
  if (
    lower.includes('longcat') ||
    lower.includes('mimo') ||
    lower.includes('qwen3-coder') ||
    lower.includes('deepseek-v4') ||
    lower.includes('doubao') ||
    lower.includes('seed')
  ) {
    return CODEX_ONE_M_CONTEXT_WINDOW;
  }
  return CODEX_DEFAULT_CONTEXT_WINDOW;
}
