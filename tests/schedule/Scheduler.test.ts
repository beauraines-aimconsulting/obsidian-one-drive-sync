import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Scheduler } from '../../src/schedule/Scheduler.js';
import { Logger } from '../../src/utils/Logger.js';
import type { RunSignal, ScheduledRun } from '../../src/schedule/types.js';

const HOUR = 60 * 60 * 1000;

/** Silent logger, so the suite's output stays readable. */
const quiet = new Logger('error', 'Scheduler');

/** Advance fake timers and let any resulting promise chains settle. */
async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

function successfulRun(): ScheduledRun {
  return { startedAt: new Date().toISOString(), status: 'running', uploaded: 1 };
}

let clock: number;

beforeEach(() => {
  vi.useFakeTimers();
  clock = Date.UTC(2026, 0, 1, 0, 0, 0);
  vi.setSystemTime(clock);
});

afterEach(() => {
  vi.useRealTimers();
});

/** A scheduler whose clock follows the fake timers. */
function makeScheduler(
  task: (signal: RunSignal) => Promise<ScheduledRun>,
  overrides: Partial<ConstructorParameters<typeof Scheduler>[0]> = {}
): Scheduler {
  return new Scheduler({
    spec: '1h',
    task,
    now: () => Date.now(),
    logger: quiet,
    ...overrides,
  });
}

describe('Scheduler', () => {
  it('rejects an invalid spec at construction, not at the first tick', () => {
    expect(() => makeScheduler(() => Promise.resolve(successfulRun()), { spec: 'hourly' })).toThrow(
      'Invalid duration'
    );
  });

  it('runs immediately on start by default', async () => {
    const task = vi.fn(() => Promise.resolve(successfulRun()));
    const scheduler = makeScheduler(task);

    scheduler.start();
    await advance(0);

    expect(task).toHaveBeenCalledTimes(1);
    await scheduler.stop();
  });

  it('waits a full interval when runOnStart is false', async () => {
    const task = vi.fn(() => Promise.resolve(successfulRun()));
    const scheduler = makeScheduler(task, { runOnStart: false });

    scheduler.start();
    await advance(HOUR - 1);
    expect(task).not.toHaveBeenCalled();

    await advance(1);
    expect(task).toHaveBeenCalledTimes(1);
    await scheduler.stop();
  });

  it('keeps a fixed spacing across several ticks', async () => {
    const startedAt: number[] = [];
    const scheduler = makeScheduler(() => {
      startedAt.push(Date.now());
      return Promise.resolve(successfulRun());
    });

    scheduler.start();
    await advance(0);
    await advance(HOUR);
    await advance(HOUR);

    expect(startedAt).toEqual([clock, clock + HOUR, clock + 2 * HOUR]);
    await scheduler.stop();
  });

  it('does not drift when a run overruns', async () => {
    const startedAt: number[] = [];
    // Each run takes 20 minutes; the next must still start on the hour.
    const scheduler = makeScheduler(async () => {
      startedAt.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 20 * 60 * 1000));
      return successfulRun();
    });

    scheduler.start();
    await advance(0);
    await advance(3 * HOUR + 20 * 60 * 1000);

    expect(startedAt).toEqual([clock, clock + HOUR, clock + 2 * HOUR, clock + 3 * HOUR]);
    await scheduler.stop();
  });

  it('realigns to the grid instead of replaying every missed tick', async () => {
    const startedAt: number[] = [];
    let first = true;
    const scheduler = makeScheduler(async () => {
      startedAt.push(Date.now());
      if (first) {
        first = false;
        // Overruns by two and a half intervals.
        await new Promise((resolve) => setTimeout(resolve, 3 * HOUR + 30 * 60 * 1000));
      }
      return successfulRun();
    });

    scheduler.start();
    await advance(0);
    await advance(4 * HOUR);

    // Ticks at 1h, 2h and 3h landed mid-run and were skipped; the schedule
    // resumes on the grid at 4h rather than firing three times back-to-back.
    expect(startedAt).toEqual([clock, clock + 4 * HOUR]);
    expect(scheduler.getRecentRuns().filter((run) => run.status === 'skipped')).toHaveLength(3);
    await scheduler.stop();
  });

  it('records a skipped run when a tick lands during an active run', async () => {
    const started: number[] = [];
    let slow = true;
    const scheduler = makeScheduler(async () => {
      started.push(Date.now());
      if (slow) {
        slow = false;
        // Overruns the next tick by half an interval.
        await new Promise((resolve) => setTimeout(resolve, 90 * 60 * 1000));
      }
      return successfulRun();
    });

    scheduler.start();
    await advance(0);
    await advance(3 * HOUR);

    // The tick at 1h landed mid-run and was skipped; 2h and 3h ran normally.
    expect(started).toEqual([clock, clock + 2 * HOUR, clock + 3 * HOUR]);
    const runs = scheduler.getRecentRuns();
    expect(runs.filter((run) => run.status === 'skipped')).toHaveLength(1);
    await scheduler.stop();
  });

  it('does not count a skipped tick as a run', async () => {
    let slow = true;
    const scheduler = makeScheduler(async () => {
      if (slow) {
        slow = false;
        await new Promise((resolve) => setTimeout(resolve, 90 * 60 * 1000));
      }
      return successfulRun();
    });

    scheduler.start();
    await advance(0);
    await advance(HOUR);

    // Only the run that is still in flight counts so far; the skip does not.
    expect(scheduler.getStatus().totalRuns).toBe(0);
    await advance(2 * HOUR);
    expect(scheduler.getStatus().totalRuns).toBe(3);
    await scheduler.stop();
  });

  it('overlaps runs when skipIfRunning is explicitly disabled', async () => {
    const started: number[] = [];
    const scheduler = makeScheduler(
      async () => {
        started.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 90 * 60 * 1000));
        return successfulRun();
      },
      { skipIfRunning: false }
    );

    scheduler.start();
    await advance(0);
    await advance(2 * HOUR);

    expect(started).toEqual([clock, clock + HOUR, clock + 2 * HOUR]);

    // Stopping has to be raced against the clock: the in-flight run only
    // finishes once its own timer fires.
    const stopped = scheduler.stop();
    await advance(90 * 60 * 1000);
    await stopped;
  });

  it('records a failure and continues on the next tick', async () => {
    let calls = 0;
    const scheduler = makeScheduler(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('Graph 503'));
      return Promise.resolve(successfulRun());
    });

    scheduler.start();
    await advance(0);

    let status = scheduler.getStatus();
    expect(status.lastRun?.status).toBe('failed');
    expect(status.lastRun?.error).toBe('Graph 503');
    expect(status.consecutiveFailures).toBe(1);

    await advance(HOUR);
    status = scheduler.getStatus();
    expect(status.lastRun?.status).toBe('success');
    expect(status.consecutiveFailures).toBe(0);

    await scheduler.stop();
  });

  it('classifies a completed run with failed files as partial, not failed', async () => {
    const scheduler = makeScheduler(() =>
      Promise.resolve({
        startedAt: new Date().toISOString(),
        status: 'running' as const,
        uploaded: 197,
        failed: 3,
      })
    );

    scheduler.start();
    await advance(0);

    const status = scheduler.getStatus();
    expect(status.lastRun?.status).toBe('partial');
    // A partial run made progress, so it must not trip the circuit breaker.
    expect(status.consecutiveFailures).toBe(0);
    await scheduler.stop();
  });

  it('fires onFailureLimit exactly once when the streak is reached', async () => {
    const onFailureLimit = vi.fn();
    const scheduler = makeScheduler(() => Promise.reject(new Error('nope')), {
      maxConsecutiveFailures: 2,
      onFailureLimit,
    });

    scheduler.start();
    await advance(0);
    expect(onFailureLimit).not.toHaveBeenCalled();

    await advance(HOUR);
    expect(onFailureLimit).toHaveBeenCalledTimes(1);

    await advance(HOUR);
    expect(onFailureLimit).toHaveBeenCalledTimes(1);
    expect(scheduler.getStatus().consecutiveFailures).toBe(3);

    await scheduler.stop();
  });

  it('never trips the circuit breaker when maxConsecutiveFailures is 0', async () => {
    const onFailureLimit = vi.fn();
    const scheduler = makeScheduler(() => Promise.reject(new Error('nope')), { onFailureLimit });

    scheduler.start();
    await advance(0);
    await advance(5 * HOUR);

    expect(onFailureLimit).not.toHaveBeenCalled();
    await scheduler.stop();
  });

  it('reports each completed run through onRun', async () => {
    const onRun = vi.fn();
    const scheduler = makeScheduler(() => Promise.resolve(successfulRun()), { onRun });

    scheduler.start();
    await advance(0);
    await advance(HOUR);

    expect(onRun).toHaveBeenCalledTimes(2);
    expect(onRun.mock.calls[0]?.[0]).toMatchObject({ status: 'success' });
    await scheduler.stop();
  });

  it('awaits the in-flight run on stop and signals cancellation', async () => {
    let observed = false;
    let release: (() => void) | undefined;
    const scheduler = makeScheduler(async (signal) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      observed = signal.cancelled;
      return successfulRun();
    });

    scheduler.start();
    await advance(0);

    const stopped = scheduler.stop();
    release?.();
    await stopped;

    expect(observed).toBe(true);
    expect(scheduler.getStatus().running).toBe(false);
  });

  it('is safe to stop twice, and to stop before starting', async () => {
    const scheduler = makeScheduler(() => Promise.resolve(successfulRun()));

    await expect(scheduler.stop()).resolves.toBeUndefined();

    scheduler.start();
    await advance(0);
    await scheduler.stop();
    await expect(scheduler.stop()).resolves.toBeUndefined();
  });

  it('does not run again after stop', async () => {
    const task = vi.fn(() => Promise.resolve(successfulRun()));
    const scheduler = makeScheduler(task);

    scheduler.start();
    await advance(0);
    await scheduler.stop();
    await advance(5 * HOUR);

    expect(task).toHaveBeenCalledTimes(1);
  });

  it('ignores a second start', async () => {
    const task = vi.fn(() => Promise.resolve(successfulRun()));
    const scheduler = makeScheduler(task);

    scheduler.start();
    scheduler.start();
    await advance(0);

    expect(task).toHaveBeenCalledTimes(1);
    await scheduler.stop();
  });

  it('returns the in-flight run from triggerNow rather than starting a second', async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const scheduler = makeScheduler(async () => {
      calls += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return successfulRun();
    });

    scheduler.start();
    await advance(0);

    const triggered = scheduler.triggerNow();
    release?.();
    await triggered;

    expect(calls).toBe(1);
    await scheduler.stop();
  });

  it('runs on demand when nothing is in flight', async () => {
    const task = vi.fn(() => Promise.resolve(successfulRun()));
    const scheduler = makeScheduler(task, { runOnStart: false });

    scheduler.start();
    const run = await scheduler.triggerNow();

    expect(run.status).toBe('success');
    expect(task).toHaveBeenCalledTimes(1);
    await scheduler.stop();
  });

  it('caps the in-memory history at ten runs, newest first', async () => {
    let counter = 0;
    const scheduler = makeScheduler(() => {
      counter += 1;
      return Promise.resolve({
        startedAt: new Date().toISOString(),
        status: 'running' as const,
        uploaded: counter,
      });
    });

    scheduler.start();
    await advance(0);
    await advance(14 * HOUR);

    const runs = scheduler.getRecentRuns();
    expect(runs).toHaveLength(10);
    expect(runs[0]?.uploaded).toBe(15);
    expect(runs[9]?.uploaded).toBe(6);
    await scheduler.stop();
  });

  it('reports an accurate nextRunAt', async () => {
    const scheduler = makeScheduler(() => Promise.resolve(successfulRun()));

    scheduler.start();
    await advance(0);

    expect(scheduler.getStatus().nextRunAt).toBe(new Date(clock + HOUR).toISOString());
    await scheduler.stop();
    expect(scheduler.getStatus().nextRunAt).toBeUndefined();
  });

  it('reports status before the first run', () => {
    const scheduler = makeScheduler(() => Promise.resolve(successfulRun()), { runOnStart: false });

    expect(scheduler.getStatus()).toMatchObject({
      enabled: false,
      spec: '1h',
      intervalMs: HOUR,
      running: false,
      consecutiveFailures: 0,
      totalRuns: 0,
    });

    scheduler.start();
    expect(scheduler.getStatus().enabled).toBe(true);
  });

  it('records how long a run took', async () => {
    const scheduler = makeScheduler(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return successfulRun();
    });

    scheduler.start();
    await advance(5000);

    expect(scheduler.getStatus().lastRun?.durationMs).toBe(5000);
    await scheduler.stop();
  });

  it('applies jitter within the configured bound', async () => {
    const started: number[] = [];
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const scheduler = makeScheduler(
      () => {
        started.push(Date.now());
        return Promise.resolve(successfulRun());
      },
      { jitterMs: 60_000 }
    );

    scheduler.start();
    await advance(0);
    await advance(HOUR + 30_000);

    expect(started).toEqual([clock, clock + HOUR + 30_000]);
    random.mockRestore();
    await scheduler.stop();
  });
});
