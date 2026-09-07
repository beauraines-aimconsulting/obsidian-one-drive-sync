import { Logger } from '../utils/Logger.js';
import { formatDuration, parseDuration } from '../utils/duration.js';
import type { RunSignal, ScheduleConfig, ScheduleStatus, ScheduledRun } from './types.js';

export interface SchedulerOptions extends ScheduleConfig {
  /** The work to repeat. Resolves with the run it performed. */
  task: (signal: RunSignal) => Promise<ScheduledRun>;
  /** Injectable clock, so tests can drive the schedule deterministically. */
  now?: () => number;
  /** Called after every completed run — logging, health, history. */
  onRun?: (run: ScheduledRun) => void;
  /** Called once when `maxConsecutiveFailures` is reached. */
  onFailureLimit?: () => void;
  logger?: Logger;
}

/** How many runs are kept in memory. Persistence is a separate concern. */
const RECENT_RUN_LIMIT = 10;

/**
 * Repeats a task on a fixed interval.
 *
 * Deliberately generic: it knows nothing about OneDrive or the vault, which is
 * what makes its timing behaviour testable with fake timers.
 */
export class Scheduler {
  private readonly options: SchedulerOptions;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly intervalMs: number;

  private timer: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  private stopping = false;
  /** The run currently in flight, if any. */
  private active: { promise: Promise<ScheduledRun>; signal: RunSignal } | null = null;
  /** Absolute time the next run is due, on the fixed grid. */
  private nextRunAt: number | undefined;
  private recentRuns: ScheduledRun[] = [];
  private consecutiveFailures = 0;
  private totalRuns = 0;
  private failureLimitFired = false;

  constructor(options: SchedulerOptions) {
    this.options = options;
    this.logger = options.logger ?? new Logger('info', 'Scheduler');
    this.now = options.now ?? (() => Date.now());
    // Parsed eagerly so an invalid spec fails at construction rather than an
    // hour later at the first tick.
    this.intervalMs = parseDuration(options.spec);
  }

  /** Begin the schedule. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopping = false;

    this.logger.info(
      `Scheduled sync every ${formatDuration(this.intervalMs)}` +
        (this.options.runOnStart === false ? '' : ' (running once now)')
    );

    if (this.options.runOnStart === false) {
      this.nextRunAt = this.now() + this.intervalMs;
      this.arm();
      return;
    }

    this.nextRunAt = this.now();
    this.fire();
  }

  /**
   * Stop the schedule, cancelling and draining any run in flight.
   *
   * Idempotent, and safe to call before `start()`.
   */
  async stop(): Promise<void> {
    this.stopping = true;
    this.started = false;
    this.nextRunAt = undefined;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    if (this.active) {
      // The task decides where it is safe to stop; all we can do is ask, then
      // wait, so an interrupted sync leaves consistent state behind.
      this.active.signal.cancelled = true;
      this.logger.info('Waiting for the in-flight scheduled run to finish...');
      await this.active.promise.catch(() => undefined);
    }
  }

  getStatus(): ScheduleStatus {
    return {
      enabled: this.started,
      spec: this.options.spec,
      intervalMs: this.intervalMs,
      running: this.active !== null,
      ...(this.nextRunAt !== undefined
        ? { nextRunAt: new Date(this.nextRunAt).toISOString() }
        : {}),
      ...(this.recentRuns[0] ? { lastRun: this.recentRuns[0] } : {}),
      consecutiveFailures: this.consecutiveFailures,
      totalRuns: this.totalRuns,
    };
  }

  /** Most recent runs, newest first. */
  getRecentRuns(): ScheduledRun[] {
    return [...this.recentRuns];
  }

  /**
   * Run now, out of band.
   *
   * A run already in flight is returned as-is rather than started a second
   * time, so a manual trigger can never overlap a scheduled one.
   */
  async triggerNow(): Promise<ScheduledRun> {
    if (this.active) return this.active.promise;
    return this.execute();
  }

  /** Schedule the next tick, respecting jitter. */
  private arm(): void {
    if (this.stopping || this.nextRunAt === undefined) return;

    const jitter = this.options.jitterMs ? Math.random() * this.options.jitterMs : 0;
    const delay = Math.max(0, this.nextRunAt - this.now() + jitter);

    // Not unref'd: in schedule-only mode the timer is the only thing keeping
    // the process alive, and unref'ing it would exit immediately.
    this.timer = setTimeout(() => this.fire(), delay);
  }

  /**
   * Handle one tick.
   *
   * The next timer is armed immediately rather than after the run finishes, so
   * ticks keep landing on the fixed grid and a slow run does not push the whole
   * schedule later and later.
   */
  private fire(): void {
    this.timer = undefined;
    if (this.stopping) return;

    if (this.active && this.options.skipIfRunning !== false) {
      // A full sync reconciles complete state, so coalescing to "run again next
      // tick" loses nothing — queueing would only pile up redundant work.
      this.logger.warn('Skipping scheduled run: the previous run is still in progress');
      const at = new Date(this.now()).toISOString();
      this.record({ startedAt: at, finishedAt: at, status: 'skipped', durationMs: 0 });
    } else {
      // Not awaited: the schedule must keep ticking while this runs. With
      // skipIfRunning disabled, overlapping runs are the caller's explicit
      // choice, and `active` then tracks the most recent one.
      void this.execute();
    }

    this.advance();
    this.arm();
  }

  /** Move `nextRunAt` forward onto the next slot at or after now. */
  private advance(): void {
    const base = this.nextRunAt ?? this.now();
    let next = base + this.intervalMs;

    // If a run overran by more than an interval, fire once and realign to the
    // grid instead of replaying every tick that was missed while it ran.
    const now = this.now();
    if (next <= now) {
      const missed = Math.floor((now - next) / this.intervalMs) + 1;
      next += missed * this.intervalMs;
    }

    this.nextRunAt = next;
  }

  /** Invoke the task, recording the outcome whatever happens. */
  private async execute(): Promise<ScheduledRun> {
    const startedAt = this.now();
    const signal: RunSignal = { cancelled: false };
    const running: ScheduledRun = {
      startedAt: new Date(startedAt).toISOString(),
      status: 'running',
    };

    const promise = this.options
      .task(signal)
      .then((run): ScheduledRun => this.finish(run, startedAt))
      .catch((error: unknown): ScheduledRun =>
        this.finish(
          {
            startedAt: running.startedAt,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          },
          startedAt
        )
      );

    this.active = { promise, signal };

    try {
      return await promise;
    } finally {
      this.active = null;
    }
  }

  /** Normalise a completed run and fold it into the counters. */
  private finish(run: ScheduledRun, startedAt: number): ScheduledRun {
    const finishedAt = this.now();
    const completed: ScheduledRun = {
      ...run,
      startedAt: run.startedAt,
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: run.durationMs ?? finishedAt - startedAt,
    };

    // A run that completed with some files failing is `partial`, not `failed`:
    // it made progress, and it must not trip the circuit breaker.
    if (completed.status === 'running') {
      completed.status = (completed.failed ?? 0) > 0 ? 'partial' : 'success';
    }

    this.record(completed);
    return completed;
  }

  /** Store a run and update failure accounting. */
  private record(run: ScheduledRun): void {
    this.recentRuns.unshift(run);
    if (this.recentRuns.length > RECENT_RUN_LIMIT) {
      this.recentRuns.length = RECENT_RUN_LIMIT;
    }

    if (run.status === 'skipped') {
      // A skipped tick is neither progress nor a failure.
      this.options.onRun?.(run);
      return;
    }

    this.totalRuns += 1;

    if (run.status === 'failed') {
      this.consecutiveFailures += 1;
      this.logger.error(`Scheduled run failed: ${run.error ?? 'unknown error'}`);
    } else {
      if (this.consecutiveFailures > 0) {
        this.logger.info('Scheduled run succeeded; failure streak reset');
      }
      this.consecutiveFailures = 0;
    }

    this.options.onRun?.(run);

    const limit = this.options.maxConsecutiveFailures ?? 0;
    if (limit > 0 && this.consecutiveFailures >= limit && !this.failureLimitFired) {
      this.failureLimitFired = true;
      this.logger.error(`Scheduled sync failed ${this.consecutiveFailures} times consecutively`);
      this.options.onFailureLimit?.();
    }
  }
}
