import * as fs from 'fs';
import * as path from 'path';

export const WORKSPACE_EXPORT_FORMAT_VERSION = 1;
export const WORKSPACE_EXPORT_MANIFEST_RELATIVE_PATH = '_agentsociety/export-manifest.json';

export type WorkspaceExportTier = 'core' | 'agent' | 'external' | 'optional';

export type WorkspaceExportRootRecord = {
  archivePath: string;
  kind: 'file' | 'directory';
  tier: WorkspaceExportTier;
  bytes: number;
  fileCount: number;
};

export type WorkspaceExportManifest = {
  formatVersion: number;
  exportKind: 'agentsociety-workspace';
  exportedAt: string;
  workspaceName: string;
  extensionVersion: string;
  roots: WorkspaceExportRootRecord[];
  excluded: string[];
  importHint: string;
};

export type WorkspaceExportSelectionIssue = {
  level: 'error' | 'warning';
  code: string;
  message: string;
};

export type WorkspaceExportSelectionValidation = {
  issues: WorkspaceExportSelectionIssue[];
  totalBytes: number;
  totalFiles: number;
};

const CORE_ROOT_FILES = new Set(['TOPIC.md']);
const CORE_ROOT_DIRECTORIES = new Set([
  '.agentsociety',
  'papers',
  'user_data',
  'datasets',
  'custom',
  'presentation',
  'synthesis',
  'paper',
]);

const AGENT_ROOT_FILES = new Set(['CLAUDE.md', 'AGENTS.md']);
const AGENT_ROOT_DIRECTORIES = new Set(['.claude']);

export const WORKSPACE_EXPORT_EXCLUDED_PATTERNS = [
  '.env',
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  'agentsociety_data',
  'mineru_output',
];

export function resolveExportTier(archivePath: string, source: 'workspace' | 'external'): WorkspaceExportTier {
  if (source === 'external') {
    return 'external';
  }
  if (CORE_ROOT_FILES.has(archivePath) || CORE_ROOT_DIRECTORIES.has(archivePath)) {
    return 'core';
  }
  if (/^hypothesis_[^/\\]+$/.test(archivePath)) {
    return 'core';
  }
  if (AGENT_ROOT_FILES.has(archivePath) || AGENT_ROOT_DIRECTORIES.has(archivePath)) {
    return 'agent';
  }
  return 'optional';
}

export function isDefaultExportTier(tier: WorkspaceExportTier): boolean {
  return tier === 'core';
}

export function buildExportManifest(input: {
  workspaceName: string;
  extensionVersion: string;
  roots: WorkspaceExportRootRecord[];
}): WorkspaceExportManifest {
  return {
    formatVersion: WORKSPACE_EXPORT_FORMAT_VERSION,
    exportKind: 'agentsociety-workspace',
    exportedAt: new Date().toISOString(),
    workspaceName: input.workspaceName,
    extensionVersion: input.extensionVersion,
    roots: input.roots,
    excluded: [...WORKSPACE_EXPORT_EXCLUDED_PATTERNS],
    importHint: 'Future import expects this manifest plus selected workspace roots; secrets such as .env are never exported.',
  };
}

export function writeExportManifest(stagingPath: string, manifest: WorkspaceExportManifest): void {
  const manifestPath = path.join(stagingPath, WORKSPACE_EXPORT_MANIFEST_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
}

export function validateExportSelection(input: {
  selectedRoots: WorkspaceExportRootRecord[];
  workspacePath: string;
  hasTopicFile: boolean;
  hypothesisCount: number;
}): WorkspaceExportSelectionValidation {
  const issues: WorkspaceExportSelectionIssue[] = [];
  const totalBytes = input.selectedRoots.reduce((sum, root) => sum + root.bytes, 0);
  const totalFiles = input.selectedRoots.reduce((sum, root) => sum + root.fileCount, 0);

  if (input.selectedRoots.length === 0) {
    issues.push({
      level: 'error',
      code: 'empty_selection',
      message: 'empty_selection',
    });
    return { issues, totalBytes, totalFiles };
  }

  if (totalFiles === 0) {
    issues.push({
      level: 'error',
      code: 'empty_payload',
      message: 'empty_payload',
    });
  }

  const hasCoreResearch =
    input.hasTopicFile ||
    input.hypothesisCount > 0 ||
    input.selectedRoots.some((root) =>
      root.archivePath === 'papers' ||
      root.archivePath === 'paper' ||
      root.archivePath.startsWith('hypothesis_')
    );

  if (!hasCoreResearch) {
    issues.push({
      level: 'warning',
      code: 'no_core_research',
      message: 'no_core_research',
    });
  }

  const externalRoots = input.selectedRoots.filter((root) => root.tier === 'external');
  if (externalRoots.length > 0) {
    issues.push({
      level: 'warning',
      code: 'includes_external',
      message: 'includes_external',
    });
  }

  const emptyDirectories = input.selectedRoots.filter(
    (root) => root.kind === 'directory' && root.fileCount === 0
  );
  if (emptyDirectories.length > 0) {
    issues.push({
      level: 'warning',
      code: 'includes_empty_directories',
      message: 'includes_empty_directories',
    });
  }

  if (totalBytes > 512 * 1024 * 1024) {
    issues.push({
      level: 'warning',
      code: 'large_archive',
      message: 'large_archive',
    });
  }

  return { issues, totalBytes, totalFiles };
}

export function verifyExportArchive(zipPath: string): boolean {
  try {
    const stats = fs.statSync(zipPath);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}
