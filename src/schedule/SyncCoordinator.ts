import type { RunSignal } from './types.js';

export interface SyncCoordinatorLogger {
  info: (message: string) => void;
  error: (message: string) => void;
}

export interface SyncCoordinatorOptions {
  /** Handle one changed file. Errors are reported, never thrown. */
  processFile: (filepath: string) => Promise<void>;
  /** Perform a full reconciling sync. */
  runFullSync?: (signal: RunSignal) => Promise<void>;
  logger?: SyncCoordinatorLogger;
}

/**
 * Serialises the two ways files get synced: per-file, driven by the watcher,
 * and whole-vault, driven by the scheduler.
 *
 * They can otherwise touch the same file and the same `SyncStateStore` at the
 * same time. The full sync's stale-file cleanup is the dangerous half — it
 * deletes anything tracked but no longer eligible, computed from a file list
 * that a concurrent edit can invalidate.
 *
 * The gate is deliberately one explicit object rather than locking scattered
 * through `SyncService`: while a full sync runs, file events are collected and
 * replayed afterwards. Most replays are no-ops, because the full sync already
 * picked the change up and `SyncStateStore.hasChanged()` returns false.
 */
export class SyncCoordinator {
  private readonly options: SyncCoordinatorOptions;
  private readonly pending = new Set<Promise<void>>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly deferred = new Set<string>();
  private fullSyncRunning = false;
  private lastFileProcessedAt: string | null = null;

  constructor(options: SyncCoordinatorOptions) {
    this.options = options;
  }

  /** ISO timestamp of the last file handled, for the health endpoint. */
  getLastFileProcessedAt(): string | null {
    return this.lastFileProcessedAt;
  }

  isFullSyncRunning(): boolean {
    return this.fullSyncRunning;
  }

  /** Files seen during a full sync and not yet replayed. */
  getDeferredCount(): number {
    return this.deferred.size;
  }

  /** Promises for work still in progress, for graceful shutdown. */
  getPending(): Set<Promise<void>> {
    return this.pending;
  }

  /**
   * Handle a file event.
   *
   * During a full sync the path is remembered instead of processed. A `Set`
   * means repeated edits to one file replay once, not once per event.
   */
  handleFile(filepath: string): void {
    if (this.fullSyncRunning) {
      this.deferred.add(filepath);
      return;
    }

    // Serialise per file so rapid edits cannot upload out of order.
    const previous = this.inFlight.get(filepath) ?? Promise.resolve();
    const work = previous
      .catch(() => undefined)
      .then(() => this.options.processFile(filepath))
      .then(() => {
        this.lastFileProcessedAt = new Date().toISOString();
      });

    this.inFlight.set(filepath, work);
    this.pending.add(work);

    void work.then(
      () => this.settle(filepath, work),
      (error: unknown) => {
        this.settle(filepath, work);
        this.options.logger?.error(
          `Failed to evaluate ${filepath}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    );
  }

  /**
   * Run a full sync with per-file work held off for its duration.
   *
   * In-flight per-file work is awaited first, so a full sync never starts
   * halfway through an individual upload.
   */
  async runFullSync(signal: RunSignal = { cancelled: false }): Promise<void> {
    const runner = this.options.runFullSync;
    if (!runner) return;

    await this.drain();
    this.fullSyncRunning = true;

    try {
      await runner(signal);
    } finally {
      this.fullSyncRunning = false;
      this.replayDeferred(signal);
    }
  }

  /** Wait for all outstanding per-file work. */
  async drain(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }

  /**
   * Replay files that changed during the full sync.
   *
   * Skipped entirely when shutting down: the pending work would only be
   * abandoned again by the shutdown handler.
   */
  private replayDeferred(signal: RunSignal): void {
    if (this.deferred.size === 0) return;

    const paths = [...this.deferred];
    this.deferred.clear();

    if (signal.cancelled) return;

    this.options.logger?.info(
      `Replaying ${paths.length} file change(s) deferred during the full sync`
    );
    for (const filepath of paths) this.handleFile(filepath);
  }

  private settle(filepath: string, work: Promise<void>): void {
    this.pending.delete(work);
    if (this.inFlight.get(filepath) === work) this.inFlight.delete(filepath);
  }
}
