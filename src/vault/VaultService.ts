import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from '../utils/EventEmitter.js';
import { Logger } from '../utils/Logger.js';
import { FrontmatterParser } from '../parser/FrontmatterParser.js';
import { VaultWatcher } from './VaultWatcher.js';
import { FileFilter } from './FileFilter.js';
import type { FileMetadata, VaultState, VaultServiceConfig, FileEvent } from './types.js';

export class VaultService extends EventEmitter<unknown> {
  private vaultPath: string = '';
  private watcher: VaultWatcher;
  private fileCache: Map<string, FileMetadata> = new Map();
  private logger: Logger;
  private parser: FrontmatterParser;
  private fileFilter: FileFilter;
  private lastScanned: number = 0;
  private monitoring: boolean = false;

  constructor(config?: VaultServiceConfig) {
    super();
    this.logger = new Logger('info', 'VaultService');
    this.parser = new FrontmatterParser();

    // Create file filter with ignore patterns
    const ignorePatterns = config?.ignorePatterns ?? [];
    this.fileFilter = new FileFilter({
      patterns: ignorePatterns,
      extensions: ['.md'],
    });

    // Create watcher with config
    this.watcher = new VaultWatcher({
      debounceDelay: config?.debounceDelay ?? 300,
      ignorePatterns,
    });

    // Set vault path if provided
    if (config?.vaultPath) {
      this.vaultPath = config.vaultPath;
    }
  }

  /**
   * Start monitoring the vault for file changes.
   * Performs initial scan and sets up file watchers.
   */
  async startMonitoring(vaultPath?: string): Promise<void> {
    if (this.monitoring) {
      this.logger.warn('Already monitoring vault');
      return;
    }

    // Use provided path or stored path
    const pathToMonitor = vaultPath ?? this.vaultPath;
    if (!pathToMonitor) {
      throw new Error('Vault path not specified');
    }

    this.vaultPath = pathToMonitor;

    try {
      this.logger.info('Starting VaultService', { vaultPath: this.vaultPath });

      // Perform initial scan
      await this.initialScan();

      // Start watching for changes
      await this.watcher.watch(this.vaultPath);

      // Subscribe to watcher events
      this.watcher.on('add', (event: FileEvent) => this.handleFileAdd(event));
      this.watcher.on('modify', (event: FileEvent) => this.handleFileModify(event));
      this.watcher.on('delete', (event: FileEvent) => this.handleFileDelete(event));
      this.watcher.on('rename', (event: FileEvent) => this.handleFileRename(event));

      this.monitoring = true;
      this.logger.info('VaultService started');
    } catch (error) {
      this.monitoring = false;
      this.logger.error('Failed to start VaultService', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Stop monitoring the vault.
   * Clears cache and stops watchers.
   */
  async stopMonitoring(): Promise<void> {
    if (!this.monitoring) {
      this.logger.warn('Not currently monitoring vault');
      return;
    }

    try {
      this.logger.info('Stopping VaultService');

      // Stop watcher
      await this.watcher.unwatch();

      // Clear cache and state
      this.fileCache.clear();
      this.lastScanned = 0;
      this.monitoring = false;

      // Remove all listeners
      this.removeAllListeners();

      this.logger.info('VaultService stopped');
    } catch (error) {
      this.logger.error('Error stopping VaultService', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get a snapshot of the vault state.
   */
  getVaultState(): VaultState {
    let publishedCount = 0;
    let unpublishedCount = 0;

    for (const metadata of this.fileCache.values()) {
      if (metadata.published) {
        publishedCount++;
      } else {
        unpublishedCount++;
      }
    }

    return {
      lastScanned: this.lastScanned,
      fileCount: this.fileCache.size,
      published: publishedCount,
      unpublished: unpublishedCount,
    };
  }

  /**
   * Get the cached file list.
   */
  getFileList(): Map<string, FileMetadata> {
    return new Map(this.fileCache);
  }

  /**
   * Get metadata for a specific file.
   */
  getFile(filepath: string): FileMetadata | undefined {
    return this.fileCache.get(filepath);
  }

  /**
   * Perform initial scan of the vault directory.
   */
  private async initialScan(): Promise<void> {
    this.logger.info('Starting initial vault scan', { vaultPath: this.vaultPath });

    try {
      // Clear existing cache
      this.fileCache.clear();

      // Recursively scan directory
      await this.scanDirectory(this.vaultPath);

      this.lastScanned = Date.now();
      this.logger.info('Initial scan complete', { fileCount: this.fileCache.size });
    } catch (error) {
      this.logger.error('Initial scan failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Recursively scan a directory and add markdown files to cache.
   */
  private async scanDirectory(dirPath: string): Promise<void> {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(this.vaultPath, fullPath).replace(/\\/g, '/');

        // Skip hidden directories and files
        if (entry.name.startsWith('.')) {
          continue;
        }

        if (entry.isDirectory()) {
          // Recursively scan subdirectory
          await this.scanDirectory(fullPath);
        } else if (entry.isFile()) {
          // Check if file passes filter
          if (this.fileFilter.filter(relativePath).allowed) {
            // Add to cache
            await this.addFileToCache(fullPath, relativePath);
          }
        }
      }
    } catch (error) {
      this.logger.error('Directory scan error', {
        dirPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Add a file to the cache with its metadata.
   */
  private async addFileToCache(fullPath: string, relativePath: string): Promise<void> {
    try {
      const stats = await fs.promises.stat(fullPath);
      const content = await fs.promises.readFile(fullPath, 'utf-8');

      const frontmatter = this.parser.parseAndCache(relativePath, content);
      const published = this.parser.isPublished(frontmatter);

      const metadata: FileMetadata = {
        filepath: relativePath,
        lastModified: stats.mtimeMs,
        size: stats.size,
        published,
      };

      this.fileCache.set(relativePath, metadata);
    } catch (error) {
      this.logger.warn('Failed to add file to cache', {
        filepath: relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle file add event from watcher.
   */
  private async handleFileAdd(event: FileEvent): Promise<void> {
    const relativePath = path.relative(this.vaultPath, event.filepath).replace(/\\/g, '/');

    try {
      await this.addFileToCache(event.filepath, relativePath);

      const metadata = this.fileCache.get(relativePath);
      if (metadata) {
        await this.emit('fileAdded', metadata as unknown);
      }
    } catch (error) {
      this.logger.error('Error handling file add', {
        filepath: relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle file modify event from watcher.
   */
  private async handleFileModify(event: FileEvent): Promise<void> {
    const relativePath = path.relative(this.vaultPath, event.filepath).replace(/\\/g, '/');

    try {
      // Re-read file stats
      await this.addFileToCache(event.filepath, relativePath);

      const metadata = this.fileCache.get(relativePath);
      if (metadata) {
        await this.emit('fileModified', metadata as unknown);
      }
    } catch (error) {
      this.logger.error('Error handling file modify', {
        filepath: relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle file delete event from watcher.
   */
  private async handleFileDelete(event: FileEvent): Promise<void> {
    const relativePath = path.relative(this.vaultPath, event.filepath).replace(/\\/g, '/');

    try {
      this.fileCache.delete(relativePath);
      this.parser.clearCache(relativePath);

      await this.emit('fileDeleted', relativePath as unknown);
    } catch (error) {
      this.logger.error('Error handling file delete', {
        filepath: relativePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle file rename event from watcher.
   */
  private async handleFileRename(event: FileEvent): Promise<void> {
    const oldPath = event.oldFilepath
      ? path.relative(this.vaultPath, event.oldFilepath).replace(/\\/g, '/')
      : '';
    const newPath = path.relative(this.vaultPath, event.filepath).replace(/\\/g, '/');

    try {
      // Remove old file from cache
      this.fileCache.delete(oldPath);
      this.parser.clearCache(oldPath);

      // Add new file to cache
      await this.addFileToCache(event.filepath, newPath);

      const metadata = this.fileCache.get(newPath);
      if (metadata) {
        const renameEvent = { oldPath, newPath, metadata };
        await this.emit('fileRenamed', renameEvent as unknown);
      }
    } catch (error) {
      this.logger.error('Error handling file rename', {
        oldPath,
        newPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check if currently monitoring.
   */
  isMonitoring(): boolean {
    return this.monitoring;
  }

  /**
   * Get the vault path.
   */
  getVaultPath(): string {
    return this.vaultPath;
  }
}
