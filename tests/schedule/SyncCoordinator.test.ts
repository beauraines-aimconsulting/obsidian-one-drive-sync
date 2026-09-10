import { describe, it, expect, vi } from 'vitest';
import { SyncCoordinator } from '../../src/schedule/SyncCoordinator.js';

/** Resolves after `n` microtask/macrotask turns, letting queued work settle. */
async function flush(n = 3): Promise<void> {
  for (let i = 0; i < n; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function deferredPromise(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('SyncCoordinator', () => {
  it('processes a file event', async () => {
    const processFile = vi.fn(() => Promise.resolve());
    const coordinator = new SyncCoordinator({ processFile });

    coordinator.handleFile('a.md');
    await flush();

    expect(processFile).toHaveBeenCalledWith('a.md');
  });

  it('serialises repeated events for one file', async () => {
    const order: string[] = [];
    const first = deferredPromise();
    let call = 0;
    const coordinator = new SyncCoordinator({
      processFile: async () => {
        call += 1;
        const id = `start${call}`;
        order.push(id);
        if (call === 1) await first.promise;
        order.push(`end${call}`);
      },
    });

    coordinator.handleFile('a.md');
    await flush(1);
    coordinator.handleFile('a.md');
    await flush(1);

    // The second event must not begin until the first finishes.
    expect(order).toEqual(['start1']);
    first.resolve();
    await flush();
    expect(order).toEqual(['start1', 'end1', 'start2', 'end2']);
  });

  it('reports the last processed time', async () => {
    const coordinator = new SyncCoordinator({ processFile: () => Promise.resolve() });
    expect(coordinator.getLastFileProcessedAt()).toBeNull();

    coordinator.handleFile('a.md');
    await flush();

    expect(coordinator.getLastFileProcessedAt()).not.toBeNull();
  });

  it('reports a failing file without throwing', async () => {
    const error = vi.fn();
    const coordinator = new SyncCoordinator({
      processFile: () => Promise.reject(new Error('upload failed')),
      logger: { info: vi.fn(), error },
    });

    coordinator.handleFile('a.md');
    await flush();

    expect(error).toHaveBeenCalledWith(expect.stringContaining('upload failed'));
  });

  it('defers file events that arrive during a full sync and replays them once', async () => {
    const processed: string[] = [];
    const release = deferredPromise();
    const coordinator = new SyncCoordinator({
      processFile: (filepath) => {
        processed.push(filepath);
        return Promise.resolve();
      },
      runFullSync: () => release.promise,
    });

    const full = coordinator.runFullSync();
    await flush(1);

    coordinator.handleFile('a.md');
    // Two events for the same file must replay once, not twice.
    coordinator.handleFile('a.md');
    coordinator.handleFile('b.md');
    await flush(1);

    expect(processed).toEqual([]);
    expect(coordinator.getDeferredCount()).toBe(2);

    release.resolve();
    await full;
    await flush();

    expect(processed.sort()).toEqual(['a.md', 'b.md']);
    expect(coordinator.getDeferredCount()).toBe(0);
  });

  it('waits for in-flight per-file work before starting a full sync', async () => {
    const order: string[] = [];
    const fileWork = deferredPromise();
    const coordinator = new SyncCoordinator({
      processFile: async () => {
        order.push('file:start');
        await fileWork.promise;
        order.push('file:end');
      },
      runFullSync: () => {
        order.push('full');
        return Promise.resolve();
      },
    });

    coordinator.handleFile('a.md');
    await flush(1);

    const full = coordinator.runFullSync();
    await flush(1);
    expect(order).toEqual(['file:start']);

    fileWork.resolve();
    await full;

    expect(order).toEqual(['file:start', 'file:end', 'full']);
  });

  it('reports whether a full sync is running', async () => {
    const release = deferredPromise();
    const coordinator = new SyncCoordinator({
      processFile: () => Promise.resolve(),
      runFullSync: () => release.promise,
    });

    expect(coordinator.isFullSyncRunning()).toBe(false);
    const full = coordinator.runFullSync();
    await flush(1);
    expect(coordinator.isFullSyncRunning()).toBe(true);

    release.resolve();
    await full;
    expect(coordinator.isFullSyncRunning()).toBe(false);
  });

  it('clears the gate even when the full sync throws', async () => {
    const coordinator = new SyncCoordinator({
      processFile: () => Promise.resolve(),
      runFullSync: () => Promise.reject(new Error('graph down')),
    });

    await expect(coordinator.runFullSync()).rejects.toThrow('graph down');
    expect(coordinator.isFullSyncRunning()).toBe(false);
  });

  it('still replays deferred files when the full sync throws', async () => {
    const processed: string[] = [];
    const release = deferredPromise();
    const coordinator = new SyncCoordinator({
      processFile: (filepath) => {
        processed.push(filepath);
        return Promise.resolve();
      },
      runFullSync: () => release.promise.then(() => Promise.reject(new Error('boom'))),
    });

    const full = coordinator.runFullSync();
    await flush(1);
    coordinator.handleFile('a.md');

    release.resolve();
    await expect(full).rejects.toThrow('boom');
    await flush();

    expect(processed).toEqual(['a.md']);
  });

  it('drops deferred replays when the run was cancelled by shutdown', async () => {
    const processed: string[] = [];
    const release = deferredPromise();
    const signal = { cancelled: false };
    const coordinator = new SyncCoordinator({
      processFile: (filepath) => {
        processed.push(filepath);
        return Promise.resolve();
      },
      runFullSync: () => release.promise,
    });

    const full = coordinator.runFullSync(signal);
    await flush(1);
    coordinator.handleFile('a.md');

    signal.cancelled = true;
    release.resolve();
    await full;
    await flush();

    expect(processed).toEqual([]);
  });

  it('does nothing when no full sync handler is configured', async () => {
    const coordinator = new SyncCoordinator({ processFile: () => Promise.resolve() });

    await expect(coordinator.runFullSync()).resolves.toBeUndefined();
  });

  it('drains outstanding work', async () => {
    let done = false;
    const work = deferredPromise();
    const coordinator = new SyncCoordinator({
      processFile: async () => {
        await work.promise;
        done = true;
      },
    });

    coordinator.handleFile('a.md');
    await flush(1);

    const drained = coordinator.drain();
    work.resolve();
    await drained;

    expect(done).toBe(true);
    expect(coordinator.getPending().size).toBe(0);
  });
});
