import { describe, expect, it, afterEach } from 'vitest';
import { HealthServer } from '../../src/health/HealthServer.js';

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
});
