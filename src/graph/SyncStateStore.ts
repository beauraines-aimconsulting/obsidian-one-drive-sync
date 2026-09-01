/**
 * Sync state tracking for OneDrive uploads.
 * Tracks content hashes and OneDrive item IDs to detect changes and avoid re-uploading.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const DEFAULT_STATE_DIR = path.join(os.homedir(), '.obsidian-sync');
const DEFAULT_STATE_FILE = 'sync-state.json';

export interface SyncEntry {
  filepath: string;
  contentHash: string;
  oneDriveItemId: string;
  oneDrivePath: string;
  lastSyncedAt: string;
  size: number;
}

export interface SyncState {
  version: number;
  lastSyncAt: string;
  entries: Record<string, SyncEntry>;
}

export class SyncStateStore {
  private stateFilePath: string;
  private state: SyncState;

  constructor(stateDir?: string) {
    const dir = stateDir ?? DEFAULT_STATE_DIR;
    this.stateFilePath = path.join(dir, DEFAULT_STATE_FILE);
    this.ensureDirectory(dir);
    this.state = this.loadState();
  }

  /**
   * Get the sync entry for a file, if it exists.
   */
  getEntry(filepath: string): SyncEntry | undefined {
    return this.state.entries[filepath];
  }

  /**
   * Check if a file has changed since last sync.
   */
  hasChanged(filepath: string, content: string): boolean {
    const entry = this.state.entries[filepath];
    if (!entry) return true;
    return entry.contentHash !== this.hashContent(content);
  }

  /**
   * Mark a file as synced with its current content hash and OneDrive metadata.
   */
  markSynced(
    filepath: string,
    content: string,
    oneDriveItemId: string,
    oneDrivePath: string
  ): void {
    this.state.entries[filepath] = {
      filepath,
      contentHash: this.hashContent(content),
      oneDriveItemId,
      oneDrivePath,
      lastSyncedAt: new Date().toISOString(),
      size: Buffer.byteLength(content, 'utf-8'),
    };
    this.state.lastSyncAt = new Date().toISOString();
    this.save();
  }

  /**
   * Remove a file from sync state (e.g., when it's no longer eligible).
   */
  removeEntry(filepath: string): SyncEntry | undefined {
    const entry = this.state.entries[filepath];
    if (entry) {
      delete this.state.entries[filepath];
      this.save();
    }
    return entry;
  }

  /**
   * Get all tracked filepaths.
   */
  getAllTrackedFiles(): string[] {
    return Object.keys(this.state.entries);
  }

  /**
   * Get all entries.
   */
  getAllEntries(): SyncEntry[] {
    return Object.values(this.state.entries);
  }

  /**
   * Get count of tracked files.
   */
  getCount(): number {
    return Object.keys(this.state.entries).length;
  }

  /**
   * Get the last sync timestamp.
   */
  getLastSyncAt(): string | null {
    return this.state.lastSyncAt || null;
  }

  /**
   * Reset all sync state (force re-upload on next sync).
   */
  reset(): void {
    this.state = this.createEmptyState();
    this.save();
  }

  /**
   * Compute SHA-256 hash of content.
   */
  hashContent(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
  }

  getStatePath(): string {
    return this.stateFilePath;
  }

  private loadState(): SyncState {
    if (!fs.existsSync(this.stateFilePath)) {
      return this.createEmptyState();
    }

    try {
      const data = fs.readFileSync(this.stateFilePath, 'utf-8');
      const parsed = JSON.parse(data) as SyncState;
      if (parsed.version !== 1) {
        return this.createEmptyState();
      }
      return parsed;
    } catch {
      return this.createEmptyState();
    }
  }

  private save(): void {
    fs.writeFileSync(
      this.stateFilePath,
      JSON.stringify(this.state, null, 2),
      { mode: 0o600 }
    );
  }

  private createEmptyState(): SyncState {
    return {
      version: 1,
      lastSyncAt: '',
      entries: {},
    };
  }

  private ensureDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }
}
