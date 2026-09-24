import { randomUUID } from 'crypto';
import type { Scheduler } from '../schedule/Scheduler.js';
import type { RunSignal, ScheduledRun } from '../schedule/types.js';
import type { SyncCoordinator } from '../schedule/SyncCoordinator.js';
import { describeRunError } from '../schedule/runErrors.js';
import type { WebEventStream } from './events.js';

const RUN_RECORD_LIMIT = 10;
const RUN_LOG_LIMIT = 500;

export interface SyncTriggerRequest {
  dryRun?: boolean;
  force?: boolean;
}

export interface SyncRunSummary {
  uploaded: number;
  skipped: number;
  removed: number;
  failed: number;
  parseErrors: number;
  totalEligible: number;
  durationMs: number;
}

export interface SyncRunRecord {
  runId: string;
  source: 'web' | 'schedule' | 'startup';
  status: 'running' | 'success' | 'partial' | 'failed';
  startedAt: string;
  finishedAt?: string;
  dryRun: boolean;
  force: boolean;
  logs: string[];
  summary?: SyncRunSummary;
  error?: string;
}

export interface SyncRunSnapshot {
  runId: string;
  source: 'web' | 'schedule' | 'startup';
  status: 'running' | 'success' | 'partial' | 'failed';
  startedAt: string;
  finishedAt?: string;
  dryRun: boolean;
  force: boolean;
  summary?: SyncRunSummary;
  error?: string;
}

export interface SyncExecutionRequest {
  dryRun: boolean;
  force: boolean;
  source: 'web' | 'schedule' | 'startup';
  signal: RunSignal;
  onProgress: (message: string) => void;
}

export interface SyncRunManagerOptions {
  coordinator: SyncCoordinator;
  events: WebEventStream;
  executeSync: (request: SyncExecutionRequest) => Promise<SyncRunSummary>;
  defaults: {
    dryRun: boolean;
    force: boolean;
  };
  scheduler?: Scheduler;
}

interface PendingManualRun {
  options: Required<SyncTriggerRequest>;
  record: SyncRunRecord;
}

export class SyncConflictError extends Error {
  constructor(message = 'A sync is already in progress') {
    super(message);
    this.name = 'SyncConflictError';
  }
}

export class SyncUnavailableError extends Error {
  constructor(message = 'Sync is not enabled; restart with --sync to allow web-triggered runs') {
    super(message);
    this.name = 'SyncUnavailableError';
  }
}

export class SyncRunManager {
  private readonly records = new Map<string, SyncRunRecord>();
  private readonly order: string[] = [];
  private pendingManualRun: PendingManualRun | null = null;

  constructor(private readonly options: SyncRunManagerOptions) {}

  triggerRun(request: SyncTriggerRequest = {}): SyncRunRecord {
    const normalized = this.normalizeOptions(request);
    const record = this.createRecord('web', normalized);

    if (this.options.scheduler) {
      if (this.isRunning()) {
        this.deleteRecord(record.runId);
        throw new SyncConflictError();
      }

      this.pendingManualRun = { options: normalized, record };
      void this.options.scheduler.triggerNow();

      if (this.pendingManualRun?.record.runId === record.runId) {
        this.pendingManualRun = null;
        this.deleteRecord(record.runId);
        throw new SyncConflictError();
      }

      return this.cloneRecord(record);
    }

    const started = this.options.coordinator.startFullSync(
      { cancelled: false },
      (signal) => this.executeRecord(record, normalized, signal).then(() => undefined)
    );
    if (!started) {
      this.deleteRecord(record.runId);
      throw new SyncConflictError();
    }

    void started.catch(() => undefined);
    return this.cloneRecord(record);
  }

  async executeScheduledRun(signal: RunSignal): Promise<ScheduledRun> {
    const pending = this.pendingManualRun;
    if (pending) {
      this.pendingManualRun = null;
    }

    const options = pending?.options ?? this.normalizeOptions({});
    const record = pending?.record ?? this.createRecord('schedule', options);

    try {
      const run = await this.executeRecord(record, options, signal);
      this.options.events.publish({
        type: 'schedule-run',
        timestamp: new Date().toISOString(),
        run: this.toSnapshot(record),
      });
      return run;
    } catch (error) {
      this.options.events.publish({
        type: 'schedule-run',
        timestamp: new Date().toISOString(),
        run: this.toSnapshot(record),
      });
      throw error;
    }
  }

  getRun(runId: string): SyncRunRecord | undefined {
    const record = this.records.get(runId);
    return record ? this.cloneRecord(record) : undefined;
  }

  runStartupSync(request: SyncTriggerRequest = {}): {
    record: SyncRunRecord;
    completion: Promise<void>;
  } {
    const normalized = this.normalizeOptions(request);
    const record = this.createRecord('startup', normalized);

    const started = this.options.coordinator.startFullSync(
      { cancelled: false },
      (signal) => this.executeRecord(record, normalized, signal).then(() => undefined)
    );
    if (!started) {
      this.deleteRecord(record.runId);
      throw new SyncConflictError();
    }

    return { record: this.cloneRecord(record), completion: started };
  }

  isRunning(): boolean {
    return this.pendingManualRun !== null || this.options.coordinator.isFullSyncRunning();
  }

  private normalizeOptions(request: SyncTriggerRequest): Required<SyncTriggerRequest> {
    return {
      dryRun: request.dryRun ?? this.options.defaults.dryRun,
      force: request.force ?? this.options.defaults.force,
    };
  }

  private createRecord(
    source: 'web' | 'schedule' | 'startup',
    options: Required<SyncTriggerRequest>
  ): SyncRunRecord {
    const record: SyncRunRecord = {
      runId: randomUUID(),
      source,
      status: 'running',
      startedAt: new Date().toISOString(),
      dryRun: options.dryRun,
      force: options.force,
      logs: [],
    };

    this.records.set(record.runId, record);
    this.order.unshift(record.runId);
    while (this.order.length > RUN_RECORD_LIMIT) {
      const staleRunId = this.order.pop();
      if (staleRunId) this.records.delete(staleRunId);
    }

    return record;
  }

  private deleteRecord(runId: string): void {
    this.records.delete(runId);
    const index = this.order.indexOf(runId);
    if (index >= 0) {
      this.order.splice(index, 1);
    }
  }

  private async executeRecord(
    record: SyncRunRecord,
    options: Required<SyncTriggerRequest>,
    signal: RunSignal
  ): Promise<ScheduledRun> {
    const onProgress = (message: string) => {
      this.appendLog(record, message);
      this.options.events.publish({
        type: 'sync-progress',
        timestamp: new Date().toISOString(),
        runId: record.runId,
        message,
        source: record.source,
        dryRun: record.dryRun,
        force: record.force,
      });
    };

    try {
      const summary = await this.options.executeSync({
        dryRun: options.dryRun,
        force: options.force,
        source: record.source,
        signal,
        onProgress,
      });

      const status = summary.failed > 0 ? 'partial' : 'success';
      record.status = status;
      record.finishedAt = new Date().toISOString();
      record.summary = summary;
      this.options.events.publish({
        type: 'sync-complete',
        timestamp: record.finishedAt,
        run: this.toSnapshot(record),
      });

      return {
        startedAt: record.startedAt,
        status: 'running',
        uploaded: summary.uploaded,
        skipped: summary.skipped,
        removed: summary.removed,
        failed: summary.failed,
        parseErrors: summary.parseErrors,
      };
    } catch (error) {
      const message = describeRunError(error);
      record.status = 'failed';
      record.error = message;
      record.finishedAt = new Date().toISOString();
      this.options.events.publish({
        type: 'sync-complete',
        timestamp: record.finishedAt,
        run: this.toSnapshot(record),
      });
      throw new Error(message);
    }
  }

  private appendLog(record: SyncRunRecord, message: string): void {
    const lines = message.split(/\r?\n/u);
    for (const line of lines) {
      record.logs.push(line);
    }
    if (record.logs.length > RUN_LOG_LIMIT) {
      record.logs.splice(0, record.logs.length - RUN_LOG_LIMIT);
    }
  }

  private cloneRecord(record: SyncRunRecord): SyncRunRecord {
    return {
      ...record,
      logs: [...record.logs],
      ...(record.summary ? { summary: { ...record.summary } } : {}),
    };
  }

  private toSnapshot(record: SyncRunRecord): SyncRunSnapshot {
    return {
      runId: record.runId,
      source: record.source,
      status: record.status,
      startedAt: record.startedAt,
      ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
      dryRun: record.dryRun,
      force: record.force,
      ...(record.summary ? { summary: { ...record.summary } } : {}),
      ...(record.error ? { error: record.error } : {}),
    };
  }
}
