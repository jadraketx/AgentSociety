/**
 * WorkspaceExportManager - Export selected workspace content into a ZIP archive.
 *
 * The default selection follows the workspace structure documented in
 * CLAUDE.md. Additional top-level files and directories can be selected
 * manually. The `.env` file is always excluded.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, execSync } from 'child_process';
import { localize } from '../i18n';
import { getMainOutputChannel } from '../shared/outputChannels';
import { resolveAgentsocietyPython } from './agentsocietyPythonResolver';
import {
  buildExportManifest,
  isDefaultExportTier,
  resolveExportTier,
  validateExportSelection,
  verifyExportArchive,
  writeExportManifest,
  type WorkspaceExportRootRecord,
  type WorkspaceExportTier,
} from './workspaceExportManifest';

interface ExportSummary {
  exportedRoots: string[];
  copiedFiles: number;
}

interface ExportCandidate {
  label: string;
  archivePath: string;
  sourcePath: string;
  allowedRoot: string;
  tier: WorkspaceExportTier;
  source: 'workspace' | 'external';
  kind: 'file' | 'directory';
  detail?: string;
  size?: number;
}

interface ExportPickItem extends vscode.QuickPickItem {
  relativePath: string;
  candidate: ExportCandidate;
}

const ROOT_EXPORT_FILES = [
  'TOPIC.md',
  'CLAUDE.md',
  'AGENTS.md',
];

const ROOT_EXPORT_DIRECTORIES = [
  '.agentsociety',
  'papers',
  'paper',
  'user_data',
  'datasets',
  'custom',
  'presentation',
  'synthesis',
];

const ALWAYS_EXCLUDED_ROOTS = new Set([
  '.env',
]);

const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
]);

const EXCLUDED_FILE_NAMES = new Set([
  '.DS_Store',
  'Thumbs.db',
]);

export class WorkspaceExportManager implements vscode.Disposable {
  private readonly outputChannel: vscode.OutputChannel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly extensionVersion: string;

  constructor() {
    this.outputChannel = getMainOutputChannel();
    this.extensionVersion =
      vscode.extensions.getExtension('tsinghua-fib-lab.ai-social-scientist')?.packageJSON
        ?.version ?? 'unknown';
  }

  async exportWorkspaceZip(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage(localize('workspaceExport.noWorkspace'));
      return;
    }

    const workspacePath = workspaceFolder.uri.fsPath;
    const selectedRoots = await this.promptForExportSelection(workspacePath);
    if (selectedRoots === undefined) {
      return;
    }

    if (selectedRoots.length === 0) {
      vscode.window.showWarningMessage(localize('workspaceExport.noSelection'));
      return;
    }

    const topicFile = path.join(workspacePath, 'TOPIC.md');
    let hypothesisCount = 0;
    try {
      hypothesisCount = fs.readdirSync(workspacePath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^hypothesis_[^/\\]+$/.test(entry.name))
        .length;
    } catch {
      hypothesisCount = 0;
    }
    const selectionRecords: WorkspaceExportRootRecord[] = selectedRoots.map((candidate) => ({
      archivePath: candidate.archivePath,
      kind: candidate.kind,
      tier: candidate.tier,
      bytes: candidate.size ?? 0,
      fileCount: this.estimateExportableFileCount(candidate),
    }));
    const validation = validateExportSelection({
      selectedRoots: selectionRecords,
      workspacePath,
      hasTopicFile: fs.existsSync(topicFile),
      hypothesisCount,
    });
    const errors = validation.issues.filter((issue) => issue.level === 'error');
    const warnings = validation.issues.filter((issue) => issue.level === 'warning');
    if (errors.length > 0) {
      vscode.window.showErrorMessage(
        errors.map((issue) => localize(`workspaceExport.validation.${issue.code}`)).join('\n')
      );
      return;
    }
    if (warnings.length > 0) {
      const warningText = warnings
        .map((issue) => localize(`workspaceExport.validation.${issue.code}`))
        .join('\n');
      const continueLabel = localize('workspaceExport.validation.continue');
      const choice = await vscode.window.showWarningMessage(
        `${warningText}\n\n${localize('workspaceExport.validation.summary', validation.totalFiles, this.formatSize(validation.totalBytes))}`,
        { modal: true },
        continueLabel,
        localize('workspaceExport.validation.back')
      );
      if (choice !== continueLabel) {
        return;
      }
    }

    const defaultSaveUri = this.getDefaultSaveUri(workspaceFolder);
    const saveUri = await vscode.window.showSaveDialog({
      ...(defaultSaveUri ? { defaultUri: defaultSaveUri } : {}),
      filters: {
        'ZIP Archive': ['zip'],
      },
      saveLabel: localize('workspaceExport.saveLabel'),
    });

    if (!saveUri) {
      return;
    }

    try {
      const summary = await vscode.window.withProgress<ExportSummary>(
        {
          location: vscode.ProgressLocation.Notification,
          title: localize('workspaceExport.progress.title'),
          cancellable: false,
        },
        async (progress) => this.performExport(workspacePath, saveUri, selectedRoots, progress),
      );

      const message = localize(
        'workspaceExport.success',
        this.getUriDisplayName(saveUri),
        summary.copiedFiles,
      );

      // 根据环境提供不同的操作选项
      const isRemote = vscode.env.remoteName !== undefined;
      const actions = isRemote
        ? [localize('workspaceExport.openInEditor'), localize('workspaceExport.copyPath')]
        : [localize('workspaceExport.reveal'), localize('workspaceExport.openInEditor'), localize('workspaceExport.copyPath')];

      const action = await vscode.window.showInformationMessage(message, ...actions);

      try {
        if (action === localize('workspaceExport.reveal')) {
          await vscode.commands.executeCommand('revealFileInOS', saveUri);
        } else if (action === localize('workspaceExport.openInEditor')) {
          // 在编辑器中打开 ZIP 文件，远程环境下可通过 VSCode 下载
          await vscode.commands.executeCommand('vscode.open', saveUri);
        } else if (action === localize('workspaceExport.copyPath')) {
          await vscode.env.clipboard.writeText(this.getUriClipboardText(saveUri));
        }
      } catch (error: unknown) {
        const postActionError = error instanceof Error ? error.message : String(error);
        this.log(`Post-export action failed: ${postActionError}`);
        vscode.window.showWarningMessage(localize('workspaceExport.postActionFailed', postActionError));
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Export failed: ${message}`);
      const action = await vscode.window.showErrorMessage(
        localize('workspaceExport.failed', message),
        localize('workspaceExport.viewOutput'),
      );
      if (action === localize('workspaceExport.viewOutput')) {
        this.outputChannel.show(true);
      }
    }
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async promptForExportSelection(workspacePath: string): Promise<ExportCandidate[] | undefined> {
    const candidates = this.collectExportCandidates(workspacePath);
    if (candidates.length === 0) {
      throw new Error(localize('workspaceExport.empty'));
    }

    const items: ExportPickItem[] = candidates.map((candidate) => ({
      label: `${this.formatTierPrefix(candidate.tier)}${candidate.label}`,
      description:
        candidate.tier === 'optional'
          ? localize('workspaceExport.pick.optionalDescription')
          : localize(`workspaceExport.pick.tier.${candidate.tier}`),
      detail: this.buildExportPickDetail(candidate),
      picked: isDefaultExportTier(candidate.tier),
      relativePath: candidate.archivePath,
      candidate,
    }));

    const selectedItems = await vscode.window.showQuickPick<ExportPickItem>(items, {
      canPickMany: true,
      title: localize('workspaceExport.pick.title'),
      placeHolder: localize('workspaceExport.pick.placeholder'),
      ignoreFocusOut: true,
    });

    return selectedItems?.map((item) => item.candidate);
  }

  private async performExport(
    workspacePath: string,
    destinationZipUri: vscode.Uri,
    selectedRoots: ExportCandidate[],
    progress: vscode.Progress<{ message?: string; increment?: number }>,
  ): Promise<ExportSummary> {
    const exportRoots = selectedRoots;
    if (exportRoots.length === 0) {
      throw new Error(localize('workspaceExport.empty'));
    }

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-social-scientist-export-'));
    const stagingPath = path.join(tempRoot, 'workspace');
    fs.mkdirSync(stagingPath, { recursive: true });

    const summary: ExportSummary = {
      exportedRoots: exportRoots.map((candidate) => candidate.archivePath),
      copiedFiles: 0,
    };
    const rootRecords: WorkspaceExportRootRecord[] = [];

    try {
      progress.report({ message: localize('workspaceExport.progress.collecting'), increment: 10 });
      this.log(`Export roots: ${summary.exportedRoots.join(', ')}`);

      const perRootIncrement = exportRoots.length > 0 ? 50 / exportRoots.length : 50;
      for (const candidate of exportRoots) {
        progress.report({
          message: localize('workspaceExport.progress.copying', candidate.archivePath),
          increment: perRootIncrement,
        });
        const targetPath = path.join(stagingPath, candidate.archivePath);
        const beforeCount = summary.copiedFiles;
        this.copyEntry(
          candidate.sourcePath,
          targetPath,
          candidate.archivePath,
          candidate.allowedRoot,
          summary,
        );
        rootRecords.push({
          archivePath: candidate.archivePath,
          kind: candidate.kind,
          tier: candidate.tier,
          bytes: candidate.size ?? 0,
          fileCount: summary.copiedFiles - beforeCount,
        });
      }

      writeExportManifest(
        stagingPath,
        buildExportManifest({
          workspaceName: path.basename(workspacePath),
          extensionVersion: this.extensionVersion,
          roots: rootRecords,
        }),
      );
      this.log(`Wrote export manifest with ${rootRecords.length} root(s)`);

      progress.report({ message: localize('workspaceExport.progress.archiving'), increment: 20 });
      const temporaryZipPath = path.join(tempRoot, 'workspace-export.zip');
      await this.createZipArchive(stagingPath, temporaryZipPath, workspacePath);

      progress.report({ message: localize('workspaceExport.progress.saving'), increment: 10 });
      await this.writeArchiveToDestination(temporaryZipPath, destinationZipUri);

      if (!verifyExportArchive(destinationZipUri.scheme === 'file' ? destinationZipUri.fsPath : temporaryZipPath)) {
        throw new Error(localize('workspaceExport.validation.archiveInvalid'));
      }

      progress.report({ message: localize('workspaceExport.progress.done'), increment: 10 });
      this.log(`Export completed: ${destinationZipUri.toString(true)} (${summary.copiedFiles} files)`);
      return summary;
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  private makeWorkspaceCandidate(
    workspacePath: string,
    archivePath: string,
    kind: 'file' | 'directory',
    sourcePath: string,
  ): ExportCandidate {
    return {
      label: archivePath,
      archivePath,
      sourcePath,
      allowedRoot: workspacePath,
      tier: resolveExportTier(archivePath, 'workspace'),
      source: 'workspace',
      kind,
      size: kind === 'directory' ? this.getDirectorySize(sourcePath) : this.getFileSize(sourcePath),
    };
  }

  private collectExportCandidates(workspacePath: string): ExportCandidate[] {
    const candidates: ExportCandidate[] = [];
    const knownRoots = new Set<string>();

    const addCandidate = (candidate: ExportCandidate) => {
      if (knownRoots.has(candidate.archivePath)) {
        return;
      }
      knownRoots.add(candidate.archivePath);
      candidates.push(candidate);
    };

    for (const relativeFile of ROOT_EXPORT_FILES) {
      if (this.shouldOfferTopLevelEntry(workspacePath, relativeFile)) {
        addCandidate(
          this.makeWorkspaceCandidate(
            workspacePath,
            relativeFile,
            'file',
            path.join(workspacePath, relativeFile),
          ),
        );
      }
    }

    for (const relativeDir of ROOT_EXPORT_DIRECTORIES) {
      if (this.shouldOfferTopLevelEntry(workspacePath, relativeDir)) {
        addCandidate(
          this.makeWorkspaceCandidate(
            workspacePath,
            relativeDir,
            'directory',
            path.join(workspacePath, relativeDir),
          ),
        );
      }
    }

    for (const relativeDir of ['.claude']) {
      if (this.shouldOfferTopLevelEntry(workspacePath, relativeDir)) {
        addCandidate(
          this.makeWorkspaceCandidate(
            workspacePath,
            relativeDir,
            'directory',
            path.join(workspacePath, relativeDir),
          ),
        );
      }
    }

    let dynamicRoots: fs.Dirent[] = [];
    try {
      dynamicRoots = fs.readdirSync(workspacePath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^hypothesis_[^/\\]+$/.test(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      this.log(`Failed to scan hypothesis directories in ${workspacePath}`);
    }

    for (const entry of dynamicRoots) {
      addCandidate(
        this.makeWorkspaceCandidate(
          workspacePath,
          entry.name,
          'directory',
          path.join(workspacePath, entry.name),
        ),
      );
    }

    const claudeConversationCandidate = this.getClaudeConversationCandidate(workspacePath);
    if (claudeConversationCandidate) {
      addCandidate(claudeConversationCandidate);
    }

    const claudeHistoryCandidate = this.getClaudeHistoryCandidate();
    if (claudeHistoryCandidate) {
      addCandidate(claudeHistoryCandidate);
    }

    const codexCandidate = this.getCodexCandidate(workspacePath);
    if (codexCandidate) {
      addCandidate(codexCandidate);
    }

    let optionalRoots: fs.Dirent[] = [];
    try {
      optionalRoots = fs.readdirSync(workspacePath, { withFileTypes: true })
        .filter((entry) => !knownRoots.has(entry.name))
        .filter((entry) => !ALWAYS_EXCLUDED_ROOTS.has(entry.name))
        .filter((entry) => !this.shouldExclude(this.normalizeRelativePath(entry.name), entry.isDirectory()))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      this.log(`Failed to scan optional entries in ${workspacePath}`);
    }

    for (const entry of optionalRoots) {
      const archivePath = entry.name;
      addCandidate(
        this.makeWorkspaceCandidate(
          workspacePath,
          archivePath,
          entry.isDirectory() ? 'directory' : 'file',
          path.join(workspacePath, archivePath),
        ),
      );
    }

    return candidates;
  }

  /**
   * 获取文件大小
   */
  private getFileSize(filePath: string): number {
    try {
      const stats = fs.statSync(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  /**
   * 获取目录大小（递归计算）
   */
  private getDirectorySize(dirPath: string): number {
    try {
      let totalSize = 0;
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          totalSize += this.getDirectorySize(fullPath);
        } else if (entry.isFile()) {
          totalSize += this.getFileSize(fullPath);
        }
      }
      return totalSize;
    } catch {
      return 0;
    }
  }

  /**
   * 格式化文件大小为人类可读格式
   */
  private buildExportPickDetail(candidate: ExportCandidate): string {
    if (candidate.detail) {
      return candidate.detail;
    }
    const kindLabel =
      candidate.kind === 'directory'
        ? localize('workspaceExport.pick.directoryDetail')
        : localize('workspaceExport.pick.fileDetail');
    if (candidate.size === undefined) {
      return kindLabel;
    }
    if (candidate.kind === 'directory' && candidate.size === 0) {
      return `${kindLabel} · ${localize('workspaceExport.pick.emptyDirectoryHint')}`;
    }
    return `${kindLabel} · ${this.formatSize(candidate.size)}`;
  }

  private formatSize(bytes: number): string {
    if (bytes === 0) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const size = parseFloat((bytes / Math.pow(k, i)).toFixed(1));
    return `${size} ${units[i]}`;
  }

  private copyEntry(
    sourcePath: string,
    targetPath: string,
    relativePath: string,
    workspaceRoot: string,
    summary: ExportSummary,
  ): void {
    const normalizedPath = this.normalizeRelativePath(relativePath);
    const stats = fs.lstatSync(sourcePath);

    if (this.shouldExclude(normalizedPath, stats.isDirectory())) {
      this.log(`Skipped excluded path: ${normalizedPath}`);
      return;
    }

    if (stats.isSymbolicLink()) {
      const resolvedPath = fs.realpathSync(sourcePath);
      if (!this.isPathInsideWorkspace(resolvedPath, workspaceRoot)) {
        this.log(`Skipped symlink outside workspace: ${normalizedPath} -> ${resolvedPath}`);
        return;
      }

      const resolvedStats = fs.statSync(resolvedPath);
      if (resolvedStats.isDirectory()) {
        this.copyDirectory(resolvedPath, targetPath, normalizedPath, workspaceRoot, summary);
      } else {
        this.copyFile(resolvedPath, targetPath, summary);
      }
      return;
    }

    if (stats.isDirectory()) {
      this.copyDirectory(sourcePath, targetPath, normalizedPath, workspaceRoot, summary);
      return;
    }

    this.copyFile(sourcePath, targetPath, summary);
  }

  private copyDirectory(
    sourceDir: string,
    targetDir: string,
    relativeDir: string,
    workspaceRoot: string,
    summary: ExportSummary,
  ): void {
    fs.mkdirSync(targetDir, { recursive: true });

    const entries = fs.readdirSync(sourceDir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const childRelativePath = this.normalizeRelativePath(path.posix.join(relativeDir, entry.name));
      const childSourcePath = path.join(sourceDir, entry.name);
      const childTargetPath = path.join(targetDir, entry.name);
      this.copyEntry(childSourcePath, childTargetPath, childRelativePath, workspaceRoot, summary);
    }
  }

  private copyFile(
    sourceFile: string,
    targetFile: string,
    summary: ExportSummary,
  ): void {
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.copyFileSync(sourceFile, targetFile);
    summary.copiedFiles += 1;
  }

  private shouldExclude(relativePath: string, isDirectory: boolean): boolean {
    const normalizedPath = this.normalizeRelativePath(relativePath);
    const fileName = path.posix.basename(normalizedPath);
    const pathSegments = normalizedPath.split('/');

    if (normalizedPath === '' || normalizedPath === '.') {
      return false;
    }

    if (ALWAYS_EXCLUDED_ROOTS.has(normalizedPath)) {
      return true;
    }

    if (EXCLUDED_FILE_NAMES.has(fileName)) {
      return true;
    }

    if (pathSegments.some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment))) {
      return true;
    }

    if (!isDirectory && /\.(pyc|pyo)$/i.test(fileName)) {
      return true;
    }

    if (normalizedPath.includes('/mineru_output/') || normalizedPath.endsWith('/mineru_output')) {
      return true;
    }

    return false;
  }

  private async createZipArchive(
    sourceDir: string,
    destinationZipPath: string,
    workspacePath: string,
  ): Promise<void> {
    fs.mkdirSync(path.dirname(destinationZipPath), { recursive: true });
    fs.rmSync(destinationZipPath, { force: true });

    const pythonCandidates = this.getPythonCandidates(workspacePath);
    let lastError: Error | null = null;

    for (const pythonCommand of pythonCandidates) {
      try {
        await this.runPythonZipCommand(pythonCommand, sourceDir, destinationZipPath);
        return;
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.log(`Failed to create ZIP with ${pythonCommand}: ${lastError.message}`);
      }
    }

    // Fallback: try system `zip` command
    try {
      await this.runSystemZipCommand(sourceDir, destinationZipPath);
      return;
    } catch (error: unknown) {
      this.log(`System zip fallback also failed: ${error}`);
    }

    throw lastError || new Error(localize('workspaceExport.pythonUnavailable'));
  }

  private runSystemZipCommand(sourceDir: string, destinationZipPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const cp = require('child_process');
      const proc = cp.spawn('zip', ['-r', '-q', destinationZipPath, '.'], {
        cwd: sourceDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
      proc.on('error', (err: Error) => reject(err));
      proc.on('close', (code: number) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`zip command exited with code ${code}: ${stderr}`));
        }
      });
    });
  }

  private async writeArchiveToDestination(sourceZipPath: string, destinationUri: vscode.Uri): Promise<void> {
    // 如果目标是本地文件，直接用流式复制避免将整个 ZIP 读入内存
    if (destinationUri.scheme === 'file') {
      const destPath = destinationUri.fsPath;
      await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
      await fs.promises.copyFile(sourceZipPath, destPath);
    } else {
      // 远程 URI（如 untitled）仍需读入内存
      const zipContent = await fs.promises.readFile(sourceZipPath);
      await vscode.workspace.fs.writeFile(destinationUri, zipContent);
    }
  }

  private getPythonCandidates(workspacePath: string): string[] {
    const extension = vscode.extensions.getExtension('tsinghua-fib-lab.ai-social-scientist');
    const resolved = resolveAgentsocietyPython({
      configuredPath: this.readConfiguredPythonPath() ?? undefined,
      workspacePath,
      extensionPath: extension?.extensionPath,
    });
    const candidates = resolved ? [resolved] : [];
    const defaults = process.platform === 'win32'
      ? ['python', 'py']
      : ['python3', 'python'];

    for (const candidate of defaults) {
      if (!candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    }

    return candidates.length > 0 ? candidates : [this.detectPythonPath()];
  }

  private readConfiguredPythonPath(): string | null {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) {
      return null;
    }

    const envPath = path.join(workspacePath, '.env');
    if (!fs.existsSync(envPath)) {
      return null;
    }

    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.trim().match(/^PYTHON_PATH=(.*)$/);
      if (match) {
        return match[1].trim() || null;
      }
    }

    return null;
  }

  private detectPythonPath(): string {
    const candidates = process.platform === 'win32'
      ? ['python', 'py']
      : ['python3', 'python'];

    for (const candidate of candidates) {
      try {
        const checkCommand = process.platform === 'win32' ? `where ${candidate}` : `which ${candidate}`;
        execSync(checkCommand, { stdio: 'ignore' });
        return candidate;
      } catch {
        // Try the next candidate.
      }
    }

    return process.platform === 'win32' ? 'python' : 'python3';
  }

  private runPythonZipCommand(
    pythonCommand: string,
    sourceDir: string,
    destinationZipPath: string,
  ): Promise<void> {
    const zipScript = [
      'import os',
      'import sys',
      'import zipfile',
      'source_dir, destination = sys.argv[1], sys.argv[2]',
      'with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as zf:',
      '    for root, dirs, files in os.walk(source_dir):',
      '        dirs.sort()',
      '        files.sort()',
      '        rel_root = os.path.relpath(root, source_dir)',
      '        if rel_root != ".":',
      '            zip_root = rel_root.replace(os.sep, "/") + "/"',
      '            zf.write(root, zip_root)',
      '        for file_name in files:',
      '            absolute_path = os.path.join(root, file_name)',
      '            relative_path = os.path.relpath(absolute_path, source_dir).replace(os.sep, "/")',
      '            zf.write(absolute_path, relative_path)',
    ].join('\n');

    return new Promise((resolve, reject) => {
      const child = spawn(
        pythonCommand,
        ['-c', zipScript, sourceDir, destinationZipPath],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      let stderr = '';

      child.stdout?.on('data', (chunk: Buffer | string) => {
        const output = chunk.toString();
        if (output.trim()) {
          this.log(output.trim());
        }
      });

      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(stderr.trim() || `Python exited with code ${code}`));
      });
    });
  }

  private shouldOfferTopLevelEntry(workspacePath: string, relativePath: string): boolean {
    if (ALWAYS_EXCLUDED_ROOTS.has(relativePath)) {
      return false;
    }

    const absolutePath = path.join(workspacePath, relativePath);
    if (!fs.existsSync(absolutePath)) {
      return false;
    }

    const stats = fs.lstatSync(absolutePath);
    return !this.shouldExclude(this.normalizeRelativePath(relativePath), stats.isDirectory());
  }

  private getClaudeConversationCandidate(workspacePath: string): ExportCandidate | null {
    const encodedWorkspacePath = this.encodeClaudeProjectPath(workspacePath);
    const conversationPath = path.join(os.homedir(), '.claude', 'projects', encodedWorkspacePath);
    if (!fs.existsSync(conversationPath)) {
      return null;
    }

    const stats = fs.lstatSync(conversationPath);
    if (!stats.isDirectory()) {
      return null;
    }

    return {
      label: `.claude/projects/${encodedWorkspacePath}`,
      archivePath: path.posix.join('.claude', 'projects', encodedWorkspacePath),
      sourcePath: conversationPath,
      allowedRoot: conversationPath,
      tier: 'external',
      source: 'external',
      kind: 'directory',
      detail: localize('workspaceExport.pick.claudeConversationDetail'),
      size: this.getDirectorySize(conversationPath),
    };
  }

  /**
   * 获取 Claude Code 全局历史记录导出候选项
   */
  private getClaudeHistoryCandidate(): ExportCandidate | null {
    const historyPath = path.join(os.homedir(), '.claude', 'history.jsonl');
    if (!fs.existsSync(historyPath)) {
      return null;
    }

    return {
      label: '.claude/history.jsonl',
      archivePath: '.claude/history.jsonl',
      sourcePath: historyPath,
      allowedRoot: path.dirname(historyPath),
      tier: 'external',
      source: 'external',
      kind: 'file',
      detail: localize('workspaceExport.pick.claudeHistoryDetail'),
      size: this.getFileSize(historyPath),
    };
  }

  /**
   * 获取 Codex 相关导出候选项
   */
  private getCodexCandidate(workspacePath: string): ExportCandidate | null {
    const codexRoot = path.join(os.homedir(), '.codex');
    if (!fs.existsSync(codexRoot)) {
      return null;
    }

    const stats = fs.lstatSync(codexRoot);
    if (!stats.isDirectory()) {
      return null;
    }

    // 安全性：不要默认导出整个 ~/.codex（可能包含大量与当前工作区无关的敏感内容）。
    // 仅在存在“与当前工作区对应”的子目录时提供导出候选项。
    const encodedWorkspacePath = this.encodeClaudeProjectPath(workspacePath);
    const workspaceScopedDir = path.join(codexRoot, 'projects', encodedWorkspacePath);
    if (!fs.existsSync(workspaceScopedDir) || !fs.lstatSync(workspaceScopedDir).isDirectory()) {
      return null;
    }

    return {
      label: `.codex/projects/${encodedWorkspacePath} (${localize('workspaceExport.pick.codexDetail')})`,
      archivePath: path.posix.join('.codex', 'projects', encodedWorkspacePath),
      sourcePath: workspaceScopedDir,
      allowedRoot: workspaceScopedDir,
      tier: 'external',
      source: 'external',
      kind: 'directory',
      detail: localize('workspaceExport.pick.codexDetail'),
      size: this.getDirectorySize(workspaceScopedDir),
    };
  }

  private encodeClaudeProjectPath(workspacePath: string): string {
    return path.resolve(workspacePath).replace(/[:\\/]+/g, '-');
  }

  private formatTierPrefix(tier: WorkspaceExportTier): string {
    if (tier === 'core') {
      return '★ ';
    }
    if (tier === 'external') {
      return '↗ ';
    }
    return '';
  }

  private estimateExportableFileCount(candidate: ExportCandidate): number {
    if (candidate.kind === 'file') {
      return fs.existsSync(candidate.sourcePath) ? 1 : 0;
    }
    return this.countExportableFiles(candidate.sourcePath, candidate.archivePath, candidate.allowedRoot);
  }

  private countExportableFiles(
    sourceDir: string,
    relativeDir: string,
    workspaceRoot: string,
  ): number {
    if (!fs.existsSync(sourceDir)) {
      return 0;
    }
    const stats = fs.lstatSync(sourceDir);
    if (!stats.isDirectory()) {
      return this.shouldExclude(this.normalizeRelativePath(relativeDir), false) ? 0 : 1;
    }

    let total = 0;
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      const childRelativePath = this.normalizeRelativePath(path.posix.join(relativeDir, entry.name));
      const childSourcePath = path.join(sourceDir, entry.name);
      if (entry.isDirectory()) {
        total += this.countExportableFiles(childSourcePath, childRelativePath, workspaceRoot);
      } else if (!this.shouldExclude(childRelativePath, false)) {
        total += 1;
      }
    }
    return total;
  }

  private getDefaultSaveUri(workspaceFolder: vscode.WorkspaceFolder): vscode.Uri | undefined {
    if (workspaceFolder.uri.scheme !== 'file') {
      return undefined;
    }

    const defaultFileName = this.getDefaultZipFileName(workspaceFolder.uri.fsPath);
    const downloadsDir = path.join(os.homedir(), 'Downloads');
    const baseDir = fs.existsSync(downloadsDir) ? downloadsDir : workspaceFolder.uri.fsPath;
    return vscode.Uri.file(path.join(baseDir, defaultFileName));
  }

  private getDefaultZipFileName(workspacePath: string): string {
    const workspaceName = path.basename(workspacePath);
    const timestamp = this.getTimestamp();
    return `${workspaceName}-workspace-export-${timestamp}.zip`;
  }

  private getTimestamp(): string {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  private isPathInsideWorkspace(candidatePath: string, workspaceRoot: string): boolean {
    const relativePath = path.relative(workspaceRoot, candidatePath);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
  }

  private normalizeRelativePath(relativePath: string): string {
    return relativePath.replace(/\\/g, '/');
  }

  private getUriDisplayName(uri: vscode.Uri): string {
    if (uri.scheme === 'file' && uri.fsPath) {
      return path.basename(uri.fsPath);
    }

    const uriPathBaseName = path.posix.basename(uri.path);
    return uriPathBaseName || uri.toString(true);
  }

  private getUriClipboardText(uri: vscode.Uri): string {
    if (uri.scheme === 'file' && uri.fsPath) {
      return uri.fsPath;
    }

    return uri.toString(true);
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[${new Date().toISOString()}] [Export] ${message}`);
  }
}
