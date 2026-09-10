/**
 * Configuration for a repeating sync.
 *
 * Interval-only by design: a cron expression would need a dependency and a
 * timezone policy, and "every N minutes" is what a reconciliation loop actually
 * wants. `spec` is a duration string — see `src/utils/duration.ts`.
 */
export interface ScheduleConfig {
  /** Interval between runs, e.g. `15m`, `1h`, `1d`. */
  spec: string;
  /** Run once immediately on start rather than waiting a full interval. */
  runOnStart?: boolean;
  /** Skip a tick that lands while the previous run is still going. */
  skipIfRunning?: boolean;
  /** Random 0..n milliseconds added to each delay. */
  jitterMs?: number;
  /** Exit-worthy failure streak. `0` (default) never trips. */
  maxConsecutiveFailures?: number;
}

/**
 * Outcome of one scheduled run.
 *
 * `partial` means the run completed but some files failed — "3 of 200 uploads
 * failed" is a different situation from "authentication blew up", and only the
 * latter should count toward a failure streak.
 */
export type ScheduledRunStatus = 'running' | 'success' | 'partial' | 'failed' | 'skipped';

export interface ScheduledRun {
  startedAt: string;
  finishedAt?: string;
  status: ScheduledRunStatus;
  durationMs?: number;
  uploaded?: number;
  skipped?: number;
  removed?: number;
  failed?: number;
  parseErrors?: number;
  /** Present when the run threw. */
  error?: string;
}

export interface ScheduleStatus {
  enabled: boolean;
  spec: string;
  intervalMs: number;
  /** True while a run is in flight. */
  running: boolean;
  /** ISO timestamp of the next scheduled run; absent once stopped. */
  nextRunAt?: string;
  lastRun?: ScheduledRun;
  consecutiveFailures: number;
  totalRuns: number;
}

/**
 * Handed to the task so a long run can notice that shutdown has begun.
 *
 * A plain mutable object rather than an `AbortSignal`: the task decides where
 * it is safe to stop, and nothing here needs event listeners.
 */
export interface RunSignal {
  cancelled: boolean;
}
