import { describe, expect, it, afterEach } from 'vitest';
import { HealthServer } from '../../src/health/HealthServer.js';
import type { ScheduleStatus } from '../../src/schedule/types.js';

describe('HealthServer', () => {
  const servers: HealthServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.stop()));
    servers.length = 0;
  });

  const start = async (watcherActive: boolean, lastFileProcessedAt: string | null = null) => {
    const server = new HealthServer(() => ({ watcherActive, lastFileProcessedAt }), 0);
    servers.push(server);
    await server.start();
    return server;
  };

  it('returns 200 with health state while the watcher is active', async () => {
    const server = await start(true, '2026-09-01T18:00:00.000Z');

    const response = await fetch(`http://127.0.0.1:${server.getPort()}/healthz`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      watcherActive: true,
      lastFileProcessedAt: '2026-09-01T18:00:00.000Z',
    });
  });

  it('returns 503 while the watcher is inactive', async () => {
    const server = await start(false);

    const response = await fetch(`http://127.0.0.1:${server.getPort()}/healthz`);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: 'unhealthy',
      watcherActive: false,
      lastFileProcessedAt: null,
    });
  });

  it('returns 404 for other paths', async () => {
    const server = await start(true);

    const response = await fetch(`http://127.0.0.1:${server.getPort()}/`);

    expect(response.status).toBe(404);
  });
  const scheduleStatus = (overrides: Partial<ScheduleStatus> = {}): ScheduleStatus => ({
    enabled: true,
    spec: '1h',
    intervalMs: 3600000,
    running: false,
    nextRunAt: '2026-09-01T19:00:00.000Z',
    consecutiveFailures: 0,
    totalRuns: 4,
    ...overrides,
  });

  const startWithSchedule = async (
    watcherActive: boolean,
    schedule: ScheduleStatus
  ): Promise<HealthServer> => {
    const server = new HealthServer(
      () => ({ watcherActive, lastFileProcessedAt: null, schedule }),
      0
    );
    servers.push(server);
    await server.start();
    return server;
  };

  it('reports the schedule block alongside watcher state', async () => {
    const schedule = scheduleStatus({
      lastRun: {
        startedAt: '2026-09-01T18:00:00.000Z',
        finishedAt: '2026-09-01T18:00:12.000Z',
        status: 'success',
        durationMs: 12000,
        uploaded: 3,
      },
    });
    const server = await startWithSchedule(true, schedule);

    const response = await fetch(`http://127.0.0.1:${server.getPort()}/healthz`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      watcherActive: true,
      lastFileProcessedAt: null,
      schedule,
    });
  });

  it('returns 200 in schedule-only mode where no watcher is running', async () => {
    const server = await startWithSchedule(false, scheduleStatus());

    const response = await fetch(`http://127.0.0.1:${server.getPort()}/healthz`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: 'ok', watcherActive: false });
  });

  it('stays 200 while scheduled runs are failing, reporting them in the body', async () => {
    const schedule = scheduleStatus({
      consecutiveFailures: 5,
      lastRun: {
        startedAt: '2026-09-01T18:00:00.000Z',
        finishedAt: '2026-09-01T18:00:01.000Z',
        status: 'failed',
        error: 'Authentication expired',
      },
    });
    const server = await startWithSchedule(false, schedule);

    const response = await fetch(`http://127.0.0.1:${server.getPort()}/healthz`);

    // Restarting cannot fix an expired token, so failures never flip the code.
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      schedule: { consecutiveFailures: 5, lastRun: { status: 'failed' } },
    });
  });

  it('returns 503 when the schedule has been stopped and no watcher is running', async () => {
    const server = await startWithSchedule(false, scheduleStatus({ enabled: false }));

    const response = await fetch(`http://127.0.0.1:${server.getPort()}/healthz`);

    expect(response.status).toBe(503);
  });
});
