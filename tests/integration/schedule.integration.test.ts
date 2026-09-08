import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Scheduler } from '../../src/schedule/Scheduler.js';
import { SyncCoordinator } from '../../src/schedule/SyncCoordinator.js';
import { Logger } from '../../src/utils/Logger.js';

/**
 * Exercises the two halves of scheduled syncing together: the timer that
 * decides *when* a full sync runs, and the coordinator that decides *what else
 * may run at the same time*. Bugs here only show up when both are wired up —
 * a file event landing mid-run is the whole reason the coordinator exists.
 */
describe('scheduled sync integration', () => {
  const silent = new Logger('error', 'test');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Advance fake time and let the promise chains queued by timers settle. */
  async function advance(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await Promise.resolve();
  }

  function build(options: {
    fullSync: (signal: { cancelled: boolean }) => Promise<void>;
    processFile: (filepath: string) => Promise<void>;
    spec?: string;
    runOnStart?: boolean;
  }): { scheduler: Scheduler; coordinator: SyncCoordinator } {
    const coordinator = new SyncCoordinator({
      processFile: options.processFile,
      runFullSync: options.fullSync,
    });

    const scheduler = new Scheduler({
      spec: options.spec ?? '1h',
      runOnStart: options.runOnStart ?? false,
      logger: silent,
      task: async (signal) => {
        const startedAt = new Date().toISOString();
        await coordinator.runFullSync(signal);
        return { startedAt, status: 'running' };
      },
    });

    return { scheduler, coordinator };
  }

  it('runs a full sync on each interval', async () => {
    const runs: string[] = [];
    const { scheduler } = build({
      processFile: () => Promise.resolve(),
      fullSync: () => {
        runs.push(new Date().toISOString());
        return Promise.resolve();
      },
    });

    scheduler.start();
    await advance(60 * 60 * 1000);
    await advance(60 * 60 * 1000);

    expect(runs).toEqual(['2025-01-01T01:00:00.000Z', '2025-01-01T02:00:00.000Z']);
    expect(scheduler.getStatus().totalRuns).toBe(2);

    await scheduler.stop();
  });

  it('runs immediately when runOnStart is set', async () => {
    const runs: string[] = [];
    const { scheduler } = build({
      runOnStart: true,
      processFile: () => Promise.resolve(),
      fullSync: () => {
        runs.push(new Date().toISOString());
        return Promise.resolve();
      },
    });

    scheduler.start();
    await advance(0);

    expect(runs).toEqual(['2025-01-01T00:00:00.000Z']);

    await scheduler.stop();
  });

  it('defers watcher events raised during a scheduled run and replays them after', async () => {
    const processed: string[] = [];
    let coordinator!: SyncCoordinator;

    const built = build({
      processFile: (filepath) => {
        processed.push(filepath);
        return Promise.resolve();
      },
      // The file event lands while the full sync is still in progress.
      fullSync: async () => {
        coordinator.handleFile('during-run.md');
        await new Promise((resolve) => setTimeout(resolve, 5000));
      },
    });
    coordinator = built.coordinator;

    built.scheduler.start();
    await advance(60 * 60 * 1000);

    // Still inside the run: nothing may touch files yet.
    expect(processed).toEqual([]);
    expect(coordinator.isFullSyncRunning()).toBe(true);

    await advance(5000);

    expect(processed).toEqual(['during-run.md']);
    expect(coordinator.getDeferredCount()).toBe(0);

    await built.scheduler.stop();
  });

  it('lets watcher events run normally between scheduled syncs', async () => {
    const processed: string[] = [];
    const { scheduler, coordinator } = build({
      processFile: (filepath) => {
        processed.push(filepath);
        return Promise.resolve();
      },
      fullSync: () => Promise.resolve(),
    });

    scheduler.start();
    coordinator.handleFile('between.md');
    await advance(0);

    expect(processed).toEqual(['between.md']);

    await scheduler.stop();
  });

  it('marks a run with failed files as partial without tripping the breaker', async () => {
    const coordinator = new SyncCoordinator({
      processFile: () => Promise.resolve(),
      runFullSync: () => Promise.resolve(),
    });
    const scheduler = new Scheduler({
      spec: '1h',
      runOnStart: false,
      maxConsecutiveFailures: 1,
      logger: silent,
      task: async (signal) => {
        const startedAt = new Date().toISOString();
        await coordinator.runFullSync(signal);
        return { startedAt, status: 'running', uploaded: 3, failed: 2 };
      },
    });

    scheduler.start();
    await advance(60 * 60 * 1000);

    const status = scheduler.getStatus();
    expect(status.lastRun?.status).toBe('partial');
    expect(status.consecutiveFailures).toBe(0);

    await scheduler.stop();
  });

  it('reports the failure limit when the sync keeps throwing', async () => {
    const onFailureLimit = vi.fn();
    const coordinator = new SyncCoordinator({
      processFile: () => Promise.resolve(),
      runFullSync: () => Promise.reject(new Error('token expired')),
    });
    const scheduler = new Scheduler({
      spec: '1h',
      runOnStart: false,
      maxConsecutiveFailures: 2,
      onFailureLimit,
      logger: silent,
      task: async (signal) => {
        const startedAt = new Date().toISOString();
        await coordinator.runFullSync(signal);
        return { startedAt, status: 'running' };
      },
    });

    scheduler.start();
    await advance(60 * 60 * 1000);
    expect(onFailureLimit).not.toHaveBeenCalled();

    await advance(60 * 60 * 1000);
    expect(onFailureLimit).toHaveBeenCalledOnce();
    expect(scheduler.getStatus().lastRun?.error).toBe('token expired');

    await scheduler.stop();
  });

  it('cancels an in-flight run on shutdown and abandons the deferred replay', async () => {
    const processed: string[] = [];
    let observedCancel = false;
    let coordinator!: SyncCoordinator;

    const built = build({
      processFile: (filepath) => {
        processed.push(filepath);
        return Promise.resolve();
      },
      fullSync: async (signal) => {
        coordinator.handleFile('during-run.md');
        await new Promise((resolve) => setTimeout(resolve, 5000));
        observedCancel = signal.cancelled;
      },
    });
    coordinator = built.coordinator;

    built.scheduler.start();
    await advance(60 * 60 * 1000);

    const stopped = built.scheduler.stop();
    await advance(5000);
    await stopped;

    expect(observedCancel).toBe(true);
    expect(processed).toEqual([]);
    expect(built.scheduler.getStatus().nextRunAt).toBeUndefined();
  });
});
