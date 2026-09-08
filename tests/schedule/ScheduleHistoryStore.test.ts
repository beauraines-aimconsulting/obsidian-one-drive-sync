import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HISTORY_LIMIT, ScheduleHistoryStore } from '../../src/schedule/ScheduleHistoryStore.js';
import { Logger } from '../../src/utils/Logger.js';
import type { ScheduledRun } from '../../src/schedule/types.js';

function run(overrides: Partial<ScheduledRun> = {}): ScheduledRun {
  return {
    startedAt: '2026-09-01T18:00:00.000Z',
    finishedAt: '2026-09-01T18:00:05.000Z',
    status: 'success',
    durationMs: 5000,
    ...overrides,
  };
}

describe('ScheduleHistoryStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-history-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const historyPath = (): string => path.join(dir, 'schedule-history.json');

  it('starts empty when no history exists', () => {
    const store = new ScheduleHistoryStore(dir);

    expect(store.getRuns()).toEqual([]);
    expect(store.getMostRecent()).toBeUndefined();
  });

  it('creates the state directory on first write', () => {
    const nested = path.join(dir, 'missing', 'deeper');
    const store = new ScheduleHistoryStore(nested);

    store.record(run());

    expect(fs.existsSync(path.join(nested, 'schedule-history.json'))).toBe(true);
  });

  it('records runs newest first', () => {
    const store = new ScheduleHistoryStore(dir);

    store.record(run({ startedAt: 'first' }));
    store.record(run({ startedAt: 'second' }));

    expect(store.getRuns().map((entry) => entry.startedAt)).toEqual(['second', 'first']);
    expect(store.getMostRecent()?.startedAt).toBe('second');
  });

  it('persists a versioned document', () => {
    const store = new ScheduleHistoryStore(dir);
    store.record(run({ status: 'partial', failed: 2 }));

    const parsed = JSON.parse(fs.readFileSync(historyPath(), 'utf-8')) as {
      version: number;
      runs: ScheduledRun[];
    };

    expect(parsed.version).toBe(1);
    expect(parsed.runs).toHaveLength(1);
    expect(parsed.runs[0]?.status).toBe('partial');
  });

  it('survives a restart', () => {
    const first = new ScheduleHistoryStore(dir);
    first.record(run({ startedAt: 'earlier' }));
    first.record(run({ startedAt: 'later' }));

    const second = new ScheduleHistoryStore(dir);

    expect(second.getRuns().map((entry) => entry.startedAt)).toEqual(['later', 'earlier']);
  });

  it(`caps history at ${HISTORY_LIMIT} runs`, () => {
    const store = new ScheduleHistoryStore(dir);

    for (let i = 0; i < HISTORY_LIMIT + 10; i += 1) {
      store.record(run({ startedAt: `run-${i}` }));
    }

    const runs = store.getRuns();
    expect(runs).toHaveLength(HISTORY_LIMIT);
    expect(runs[0]?.startedAt).toBe(`run-${HISTORY_LIMIT + 9}`);
    expect(runs.at(-1)?.startedAt).toBe('run-10');
  });

  it('trims an over-long history on read', () => {
    fs.writeFileSync(
      historyPath(),
      JSON.stringify({
        version: 1,
        runs: Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => run({ startedAt: `old-${i}` })),
      })
    );

    expect(new ScheduleHistoryStore(dir).getRuns()).toHaveLength(HISTORY_LIMIT);
  });

  it('leaves no temp files behind', () => {
    const store = new ScheduleHistoryStore(dir);
    store.record(run());

    expect(fs.readdirSync(dir)).toEqual(['schedule-history.json']);
  });

  it('recovers from a corrupt history file', () => {
    fs.writeFileSync(historyPath(), '{ not json');
    const warn = vi.fn();

    const store = new ScheduleHistoryStore(dir, {
      warn,
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger);

    expect(store.getRuns()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('starting fresh'));

    // Recording still works and repairs the file.
    store.record(run());
    expect(new ScheduleHistoryStore(dir).getRuns()).toHaveLength(1);
  });

  it('ignores a history document with an unknown version', () => {
    fs.writeFileSync(historyPath(), JSON.stringify({ version: 99, runs: [run()] }));
    const warn = vi.fn();

    const store = new ScheduleHistoryStore(dir, {
      warn,
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger);

    expect(store.getRuns()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unrecognised'));
  });

  it('ignores a history document whose runs are not an array', () => {
    fs.writeFileSync(historyPath(), JSON.stringify({ version: 1, runs: 'nope' }));

    expect(new ScheduleHistoryStore(dir).getRuns()).toEqual([]);
  });

  it('warns rather than throwing when the history cannot be written', () => {
    const store = new ScheduleHistoryStore(dir);
    const warn = vi.fn();
    (store as unknown as { logger: { warn: typeof warn } }).logger = {
      warn,
    } as unknown as Logger & { warn: typeof warn };
    fs.rmSync(dir, { recursive: true, force: true });
    fs.writeFileSync(dir, 'not a directory');

    expect(() => store.record(run())).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not write schedule history'));

    fs.rmSync(dir, { force: true });
    fs.mkdirSync(dir);
  });

  it('clears recorded runs', () => {
    const store = new ScheduleHistoryStore(dir);
    store.record(run());

    store.clear();

    expect(store.getRuns()).toEqual([]);
    expect(new ScheduleHistoryStore(dir).getRuns()).toEqual([]);
  });

  it('exposes the file path it writes to', () => {
    expect(new ScheduleHistoryStore(dir).getFilePath()).toBe(historyPath());
  });
});
