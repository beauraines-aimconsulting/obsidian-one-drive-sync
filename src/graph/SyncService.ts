/**
 * Sync service: Orchestrates the full sync workflow.
 * Evaluate → Upload changed → Track state → Report results.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PublicationService } from '../publications/PublicationService.js';
import { GraphAuthProvider } from './GraphAuthProvider.js';
import { OneDriveClient } from './OneDriveClient.js';
import { SyncStateStore } from './SyncStateStore.js';
import { walkMarkdown } from '../vault/walkMarkdown.js';

export interface SyncOptions {
  vaultPath: string;
  targetFolder: string;
  configPath?: string;
  forceSync?: boolean;
  dryRun?: boolean;
  ignorePatterns?: string[];
}

export interface SyncResult {
  uploaded: string[];
  skipped: string[];
  failed: Array<{ filepath: string; error: string }>;
  removed: string[];
  /** Files skipped because their YAML frontmatter could not be parsed. */
  parseErrors: Array<{ filepath: string; reason: string }>;
  totalEligible: number;
  duration: number;
}

export type SyncFileAction = 'uploaded' | 'skipped' | 'removed' | 'ignored' | 'failed';

export interface SyncFileResult {
  action: SyncFileAction;
  filepath: string;
  error?: string;
}

export interface SyncStatusSummary {
  trackedFileCount: number;
  lastSyncAt: string | null;
  totalBytes: number;
}

export type FileSyncStatus =
  'not-eligible' | 'never-synced' | 'synced' | 'changed' | 'parse-error' | 'sync-failed';

export interface FileSyncStatusResult {
  status: FileSyncStatus;
  lastSyncedAt: string | null;
  failure?: string;
}

export interface SyncExecutionOverrides {
  forceSync?: boolean;
  dryRun?: boolean;
}

export class SyncService {
  private publicationService: PublicationService;
  private authProvider: GraphAuthProvider;
  private syncState: SyncStateStore;
  private options: SyncOptions;

  constructor(
    publicationService: PublicationService,
    authProvider: GraphAuthProvider,
    syncState: SyncStateStore,
    options: SyncOptions
  ) {
    this.publicationService = publicationService;
    this.authProvider = authProvider;
    this.syncState = syncState;
    this.options = options;
  }

  getStatusSummary(): SyncStatusSummary {
    return {
      trackedFileCount: this.syncState.getCount(),
      lastSyncAt: this.syncState.getLastSyncAt(),
      totalBytes: this.syncState.getTotalBytes(),
    };
  }

  getFileSyncStatus(
    filepath: string,
    content: string,
    eligible: boolean,
    parseError = false
  ): FileSyncStatusResult {
    if (parseError) return { status: 'parse-error', lastSyncedAt: null };
    if (!eligible) return { status: 'not-eligible', lastSyncedAt: null };

    const entry = this.syncState.getEntry(filepath);
    const failure = this.syncState.getFailure(filepath);
    if (failure && failure.contentHash === this.syncState.hashContent(content)) {
      return {
        status: 'sync-failed',
        lastSyncedAt: entry?.lastSyncedAt ?? null,
        failure: failure.error,
      };
    }
    if (!entry) return { status: 'never-synced', lastSyncedAt: null };

    return {
      status: this.syncState.hasChanged(filepath, content) ? 'changed' : 'synced',
      lastSyncedAt: entry.lastSyncedAt,
    };
  }

  /**
   * Run a full sync: evaluate all files, upload changed ones, remove stale ones.
   */
  async sync(onProgress?: (message: string) => void): Promise<SyncResult> {
    return this.syncWithOverrides({}, onProgress);
  }

  async syncWithOverrides(
    overrides: SyncExecutionOverrides,
    onProgress?: (message: string) => void
  ): Promise<SyncResult> {
    const startTime = Date.now();
    const executionOptions: SyncOptions = {
      ...this.options,
      ...(overrides.forceSync !== undefined ? { forceSync: overrides.forceSync } : {}),
      ...(overrides.dryRun !== undefined ? { dryRun: overrides.dryRun } : {}),
    };
    const result: SyncResult = {
      uploaded: [],
      skipped: [],
      failed: [],
      removed: [],
      parseErrors: [],
      totalEligible: 0,
      duration: 0,
    };

    // Get access token
    const log = (msg: string) => onProgress?.(msg);
    log('🔐 Authenticating...');
    const accessToken = await this.authProvider.getToken();

    const client = new OneDriveClient({
      targetFolder: executionOptions.targetFolder,
      accessToken,
    });

    // Scan vault for markdown files
    log('📂 Scanning vault...');
    const files = await this.walkMarkdown(
      executionOptions.vaultPath,
      executionOptions.ignorePatterns
    );
    log(`   Found ${files.length} markdown files`);

    // Evaluate each file
    const eligibleFiles: Array<{ filepath: string; relativePath: string; content: string }> = [];

    for (const filepath of files) {
      const relativePath = path.relative(this.options.vaultPath, filepath);
      const content = fs.readFileSync(filepath, 'utf-8');
      const evaluation = await this.publicationService.evaluateFile(relativePath, content);

      if (evaluation.eligible) {
        eligibleFiles.push({ filepath, relativePath, content });
      } else if (evaluation.parseError) {
        result.parseErrors.push({ filepath: relativePath, reason: evaluation.reason });
        log(`   ⚠️  Skipped (frontmatter): ${relativePath} — ${evaluation.reason}`);
      }
    }

    result.totalEligible = eligibleFiles.length;
    log(`✅ ${eligibleFiles.length} files eligible for sync`);

    // Upload changed files
    for (const { relativePath, content } of eligibleFiles) {
      const changed =
        executionOptions.forceSync || this.syncState.hasChanged(relativePath, content);

      if (!changed) {
        result.skipped.push(relativePath);
        continue;
      }

      if (executionOptions.dryRun) {
        log(`   [dry-run] Would upload: ${relativePath}`);
        result.uploaded.push(relativePath);
        continue;
      }

      log(`   ⬆️  Uploading: ${relativePath}`);
      const uploadResult = await client.uploadContent(content, relativePath);

      if (uploadResult.success && uploadResult.itemId) {
        this.syncState.markSynced(
          relativePath,
          content,
          uploadResult.itemId,
          uploadResult.oneDrivePath
        );
        result.uploaded.push(relativePath);
      } else {
        this.syncState.markFailed(relativePath, content, uploadResult.error ?? 'Unknown error');
        result.failed.push({
          filepath: relativePath,
          error: uploadResult.error ?? 'Unknown error',
        });
      }
    }

    // Remove stale files (previously synced but no longer eligible).
    // Files whose frontmatter failed to parse are deliberately excluded: their
    // publish intent is unknown, so we neither publish them nor tear down the
    // last version that was successfully published. A transient YAML typo must
    // not delete an already-published note.
    const eligiblePaths = new Set(eligibleFiles.map((f) => f.relativePath));
    const parseErrorPaths = new Set(result.parseErrors.map((p) => p.filepath));
    const trackedFiles = this.syncState.getAllTrackedFiles();

    for (const tracked of trackedFiles) {
      if (!eligiblePaths.has(tracked) && !parseErrorPaths.has(tracked)) {
        const entry = this.syncState.getEntry(tracked);
        if (entry) {
          if (executionOptions.dryRun) {
            log(`   [dry-run] Would remove: ${tracked}`);
            result.removed.push(tracked);
          } else {
            log(`   🗑️  Removing: ${tracked}`);
            const deleted = await client.deleteFile(entry.oneDriveItemId);
            if (deleted) {
              this.syncState.removeEntry(tracked);
              result.removed.push(tracked);
            }
          }
        }
      }
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * Sync a single file after a watcher event.
   *
   * Uploads it when it is eligible and changed, and removes it from OneDrive
   * when it was deleted or is no longer eligible. A fresh token is requested
   * per call so long-running watch sessions survive token expiry.
   */
  async syncFile(
    relativePath: string,
    onProgress?: (message: string) => void
  ): Promise<SyncFileResult> {
    const log = (msg: string) => onProgress?.(msg);
    const absolutePath = path.join(this.options.vaultPath, relativePath);

    let content: string | null = null;
    try {
      content = fs.readFileSync(absolutePath, 'utf-8');
    } catch {
      // Missing file means it was deleted between the event and this read.
      content = null;
    }

    let eligible = false;
    if (content !== null) {
      const evaluation = await this.publicationService.evaluateFile(relativePath, content);
      eligible = evaluation.eligible;
      if (evaluation.parseError) {
        // Leave OneDrive untouched: we can't tell whether this note should be
        // published, so keep the last good version rather than deleting it.
        log(`   ⚠️  Skipped (frontmatter): ${relativePath} — ${evaluation.reason}`);
        return { action: 'ignored', filepath: relativePath };
      }
    }

    if (!eligible) {
      const entry = this.syncState.getEntry(relativePath);
      if (!entry) return { action: 'ignored', filepath: relativePath };

      if (this.options.dryRun) {
        log(`   [dry-run] Would remove: ${relativePath}`);
        return { action: 'removed', filepath: relativePath };
      }

      log(`   🗑️  Removing: ${relativePath}`);
      try {
        const client = await this.createClient();
        const deleted = await client.deleteFile(entry.oneDriveItemId);
        if (!deleted) {
          return { action: 'failed', filepath: relativePath, error: 'Delete failed' };
        }
        this.syncState.removeEntry(relativePath);
        return { action: 'removed', filepath: relativePath };
      } catch (error) {
        return {
          action: 'failed',
          filepath: relativePath,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const fileContent = content as string;
    if (!this.options.forceSync && !this.syncState.hasChanged(relativePath, fileContent)) {
      return { action: 'skipped', filepath: relativePath };
    }

    if (this.options.dryRun) {
      log(`   [dry-run] Would upload: ${relativePath}`);
      return { action: 'uploaded', filepath: relativePath };
    }

    log(`   ⬆️  Uploading: ${relativePath}`);
    try {
      const client = await this.createClient();
      const uploadResult = await client.uploadContent(fileContent, relativePath);
      if (uploadResult.success && uploadResult.itemId) {
        this.syncState.markSynced(
          relativePath,
          fileContent,
          uploadResult.itemId,
          uploadResult.oneDrivePath
        );
        return { action: 'uploaded', filepath: relativePath };
      }
      this.syncState.markFailed(relativePath, fileContent, uploadResult.error ?? 'Unknown error');
      return {
        action: 'failed',
        filepath: relativePath,
        error: uploadResult.error ?? 'Unknown error',
      };
    } catch (error) {
      this.syncState.markFailed(
        relativePath,
        fileContent,
        error instanceof Error ? error.message : String(error)
      );
      return {
        action: 'failed',
        filepath: relativePath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async createClient(): Promise<OneDriveClient> {
    const accessToken = await this.authProvider.getToken();
    return new OneDriveClient({
      targetFolder: this.options.targetFolder,
      accessToken,
    });
  }

  private async walkMarkdown(
    dir: string,
    ignorePatterns = this.options.ignorePatterns
  ): Promise<string[]> {
    return walkMarkdown(dir, { ignorePatterns });
  }
}
