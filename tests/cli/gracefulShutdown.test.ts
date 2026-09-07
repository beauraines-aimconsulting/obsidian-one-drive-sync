import { describe, expect, it, vi } from 'vitest';
import { createGracefulShutdown } from '../../src/cli/gracefulShutdown.js';

describe('createGracefulShutdown', () => {
  it('stops the watcher and waits for active evaluations', async () => {
    let finishEvaluation: (() => void) | undefined;
    const evaluation = new Promise<void>((resolve) => {
      finishEvaluation = resolve;
    });
    const unwatch = vi.fn().mockResolvedValue(undefined);
    const info = vi.fn();
    const error = vi.fn();
    const shutdown = createGracefulShutdown(
      { unwatch },
      new Set([evaluation]),
      { info, error }
    );

    let completed = false;
    const result = shutdown('SIGTERM').then((code) => {
      completed = true;
      return code;
    });

    await Promise.resolve();
    expect(unwatch).toHaveBeenCalledOnce();
    expect(completed).toBe(false);

    finishEvaluation?.();
    await expect(result).resolves.toBe(0);
    expect(info).toHaveBeenCalledWith('Shutting down on SIGTERM');
    expect(error).not.toHaveBeenCalled();
  });

  it('only shuts down once when multiple signals arrive', async () => {
    const unwatch = vi.fn().mockResolvedValue(undefined);
    const shutdown = createGracefulShutdown(
      { unwatch },
      new Set(),
      { info: vi.fn(), error: vi.fn() }
    );

    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);

    expect(unwatch).toHaveBeenCalledOnce();
  });

  it('reports shutdown errors and returns a failure exit code', async () => {
    const unwatch = vi.fn().mockRejectedValue(new Error('close failed'));
    const error = vi.fn();
    const shutdown = createGracefulShutdown(
      { unwatch },
      new Set(),
      { info: vi.fn(), error }
    );

    await expect(shutdown('SIGTERM')).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith('Failed to shut down cleanly: close failed');
  });

  it('stops the health server before the watcher', async () => {
    const events: string[] = [];
    const shutdown = createGracefulShutdown(
      { unwatch: async () => { events.push('watcher'); } },
      new Set(),
      { info: vi.fn(), error: vi.fn() },
      { stop: async () => { events.push('health'); } }
    );

    await expect(shutdown('SIGTERM')).resolves.toBe(0);

    expect(events).toEqual(['health', 'watcher']);
  });
  it('stops the scheduler before the watcher and the health server', async () => {
    const order: string[] = [];
    const shutdown = createGracefulShutdown(
      { unwatch: vi.fn().mockImplementation(() => { order.push('watcher'); return Promise.resolve(); }) },
      new Set(),
      { info: vi.fn(), error: vi.fn() },
      { stop: vi.fn().mockImplementation(() => { order.push('health'); return Promise.resolve(); }) },
      { stop: vi.fn().mockImplementation(() => { order.push('scheduler'); return Promise.resolve(); }) }
    );

    await expect(shutdown('SIGTERM')).resolves.toBe(0);

    expect(order).toEqual(['scheduler', 'health', 'watcher']);
  });

  it('reports a scheduler that fails to stop', async () => {
    const error = vi.fn();
    const unwatch = vi.fn().mockResolvedValue(undefined);
    const shutdown = createGracefulShutdown(
      { unwatch },
      new Set(),
      { info: vi.fn(), error },
      undefined,
      { stop: vi.fn().mockRejectedValue(new Error('drain failed')) }
    );

    await expect(shutdown('SIGTERM')).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith('Failed to shut down cleanly: drain failed');
    expect(unwatch).not.toHaveBeenCalled();
  });
});
