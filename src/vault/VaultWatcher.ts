import * as chokidar from 'chokidar';
import { EventEmitter } from '../utils/EventEmitter.js';
import { Logger } from '../utils/Logger.js';
import { FileFilter } from './FileFilter.js';
import type { VaultWatcherConfig, FileEvent } from './types.js';

export class VaultWatcher extends EventEmitter<FileEvent> {
  private watcher: chokidar.FSWatcher | null = null;
  private logger: Logger;
  private fileFilter: FileFilter;
  private debounceDelay: number;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private watching: boolean = false;
  private vaultPath: string = '';
  private usePolling: boolean;
  private pollInterval: number;

  constructor(config?: VaultWatcherConfig) {
    super();
    this.debounceDelay = config?.debounceDelay ?? 300;
    this.usePolling = config?.usePolling ?? false;
    this.pollInterval = config?.pollInterval ?? 1000;
    this.logger = new Logger('info', 'VaultWatcher');

    const ignorePatterns = config?.ignorePatterns ?? [];
    this.fileFilter = new FileFilter({
      patterns: ignorePatterns,
      extensions: ['.md'],
    });
  }

  /**
   * Start watching the vault directory for file changes.
   */
  async watch(vaultPath: string): Promise<void> {
    if (this.watching) {
      this.logger.warn('Already watching', { vaultPath: this.vaultPath });
      return;
    }

    this.vaultPath = vaultPath;
    this.logger.info('Starting vault watcher', {
      vaultPath,
      usePolling: this.usePolling,
      ...(this.usePolling ? { pollInterval: this.pollInterval } : {}),
    });

    try {
      this.watcher = chokidar.watch(vaultPath, {
        ignored: /(^|[/\\])\.|node_modules|\.git/,
        persistent: true,
        ignoreInitial: true,
        usePolling: this.usePolling,
        interval: this.pollInterval,
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 100,
        },
      });

      this.watcher.on('add', (filepath) => this.handleAdd(filepath));
      this.watcher.on('change', (filepath) => this.handleModify(filepath));
      this.watcher.on('unlink', (filepath) => this.handleDelete(filepath));
      this.watcher.on('unlinkDir', () => {
        // Ignore directory deletions
      });
      this.watcher.on('addDir', () => {
        // Ignore directory additions
      });
      this.watcher.on('error', (error) => this.handleError(error));

      await new Promise<void>((resolve) => {
        this.watcher?.once('ready', () => {
          this.watching = true;
          this.logger.info('Vault watcher ready');
          resolve();
        });
      });
    } catch (error) {
      this.watching = false;
      this.logger.error('Failed to start watcher', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Stop watching the vault directory.
   */
  async unwatch(): Promise<void> {
    if (!this.watching || !this.watcher) {
      this.logger.warn('Not currently watching');
      return;
    }

    this.logger.info('Stopping vault watcher');

    // Clear all pending debounce timers
    this.debounceTimers.forEach((timer) => clearTimeout(timer));
    this.debounceTimers.clear();

    try {
      await this.watcher.close();
      this.watching = false;
      this.logger.info('Vault watcher stopped');
    } catch (error) {
      this.logger.error('Error stopping watcher', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if currently watching.
   */
  isWatching(): boolean {
    return this.watching;
  }

  /**
   * Handle file add event.
   */
  private handleAdd(filepath: string): void {
    if (!this.fileFilter.filter(filepath).allowed) {
      return;
    }

    this.debounceEvent('add', filepath);
  }

  /**
   * Handle file modify event.
   */
  private handleModify(filepath: string): void {
    if (!this.fileFilter.filter(filepath).allowed) {
      return;
    }

    this.debounceEvent('modify', filepath);
  }

  /**
   * Handle file delete event.
   */
  private handleDelete(filepath: string): void {
    if (!this.fileFilter.filter(filepath).allowed) {
      return;
    }

    this.debounceEvent('delete', filepath);
  }

  /**
   * Emit file renamed event (used for testing/manual calls).
   */
  private handleRename(oldFilepath: string, newFilepath: string): void {
    if (!this.fileFilter.filter(newFilepath).allowed) {
      return;
    }

    const key = `rename_${oldFilepath}_${newFilepath}`;
    this.clearDebounceTimer(key);

    const event: FileEvent = {
      type: 'rename',
      filepath: newFilepath,
      oldFilepath,
      timestamp: Date.now(),
    };

    this.emit('rename', event).catch((error) => {
      this.logger.error('Error emitting rename event', { error });
    });
  }

  /**
   * Debounce file events to avoid duplicate processing.
   */
  private debounceEvent(type: 'add' | 'modify' | 'delete', filepath: string): void {
    const key = `${type}_${filepath}`;

    // Clear existing timer if any
    this.clearDebounceTimer(key);

    // Set new timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);

      const event: FileEvent = {
        type,
        filepath,
        timestamp: Date.now(),
      };

      this.emit(type, event).catch((error) => {
        this.logger.error(`Error emitting ${type} event`, { error });
      });
    }, this.debounceDelay);

    this.debounceTimers.set(key, timer);
  }

  /**
   * Clear a debounce timer.
   */
  private clearDebounceTimer(key: string): void {
    const timer = this.debounceTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(key);
    }
  }

  /**
   * Handle watcher errors.
   */
  private handleError(error: Error): void {
    this.logger.error('Watcher error', {
      error: error.message,
    });
  }

  /**
   * Manually trigger a rename event (useful for testing).
   */
  triggerRename(oldFilepath: string, newFilepath: string): void {
    this.handleRename(oldFilepath, newFilepath);
  }

  /**
   * Manually trigger an add event (useful for testing).
   */
  triggerAdd(filepath: string): void {
    this.handleAdd(filepath);
  }

  /**
   * Manually trigger a modify event (useful for testing).
   */
  triggerModify(filepath: string): void {
    this.handleModify(filepath);
  }

  /**
   * Manually trigger a delete event (useful for testing).
   */
  triggerDelete(filepath: string): void {
    this.handleDelete(filepath);
  }

  /**
   * Get pending debounce count (useful for testing).
   */
  getPendingDebounceCount(): number {
    return this.debounceTimers.size;
  }

  /**
   * Flush all pending debounces immediately (useful for testing).
   */
  async flushDebounces(): Promise<void> {
    const entries = Array.from(this.debounceTimers.entries());

    // Clear all timers
    for (const [key, timer] of entries) {
      clearTimeout(timer);
      this.debounceTimers.delete(key);

      // Parse the event from the key
      const parts = key.split('_');
      if (parts.length >= 2) {
        const type = parts[0] as 'add' | 'modify' | 'delete';
        const filepath = parts.slice(1).join('_');

        const event: FileEvent = {
          type,
          filepath,
          timestamp: Date.now(),
        };

        try {
          await this.emit(type, event);
        } catch (error) {
          this.logger.error(`Error emitting ${type} event`, { error });
        }
      }
    }

    // Wait a tick for async emissions to complete
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
