import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '../utils/Logger.js';
import { writeFileAtomic } from '../utils/atomicWrite.js';
import type { ScheduledRun } from './types.js';

const DEFAULT_STATE_DIR = path.join(os.homedir(), '.obsidian-sync');
const HISTORY_FILE = 'schedule-history.json';

/** How many runs are kept. Enough to see a pattern, small enough to read. */
export const HISTORY_LIMIT = 50;

export interface ScheduleHistory {
  version: number;
  runs: ScheduledRun[];
}

/**
 * Persists the outcome of scheduled runs.
 *
 * Lives beside `sync-state.json` in `~/.obsidian-sync`, which is already the
 * volume-mounted directory in the container, so history survives a restart
 * without a new mount.
 *
 * History is diagnostic data. Nothing here may prevent the app from starting
 * or syncing, so every failure degrades to an empty history and a warning.
 */
export class ScheduleHistoryStore {
  private readonly filePath: string;
  private readonly logger: Logger;
  private runs: ScheduledRun[];

  constructor(stateDir?: string, logger?: Logger) {
    this.filePath = path.join(stateDir ?? DEFAULT_STATE_DIR, HISTORY_FILE);
    this.logger = logger ?? new Logger('info', 'ScheduleHistory');
    this.runs = this.load();
  }

  /** Recorded runs, newest first. */
  getRuns(): ScheduledRun[] {
    return [...this.runs];
  }

  getMostRecent(): ScheduledRun | undefined {
    return this.runs[0];
  }

  /** Record a run and persist immediately, so a crash keeps the evidence. */
  record(run: ScheduledRun): void {
    this.runs.unshift(run);
    if (this.runs.length > HISTORY_LIMIT) this.runs.length = HISTORY_LIMIT;
    this.save();
  }

  /** Forget every recorded run. */
  clear(): void {
    this.runs = [];
    this.save();
  }

  getFilePath(): string {
    return this.filePath;
  }

  private load(): ScheduledRun[] {
    if (!fs.existsSync(this.filePath)) return [];

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as ScheduleHistory;
      if (parsed.version !== 1 || !Array.isArray(parsed.runs)) {
        this.logger.warn(`Ignoring unrecognised schedule history at ${this.filePath}`);
        return [];
      }
      // Trim on read too: the cap could have been lowered between versions.
      return parsed.runs.slice(0, HISTORY_LIMIT);
    } catch (error) {
      this.logger.warn(
        `Could not read schedule history at ${this.filePath}, starting fresh: ` +
          (error instanceof Error ? error.message : String(error))
      );
      return [];
    }
  }

  private save(): void {
    const history: ScheduleHistory = { version: 1, runs: this.runs };

    try {
      writeFileAtomic(this.filePath, JSON.stringify(history, null, 2));
    } catch (error) {
      this.logger.warn(
        `Could not write schedule history to ${this.filePath}: ` +
          (error instanceof Error ? error.message : String(error))
      );
    }
  }
}
