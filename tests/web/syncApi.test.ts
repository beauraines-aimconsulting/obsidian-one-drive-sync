import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SyncService } from '../../src/graph/SyncService.js';
import type { PublicationService } from '../../src/publications/PublicationService.js';
import type { Scheduler } from '../../src/schedule/Scheduler.js';
import { SyncCoordinator } from '../../src/schedule/SyncCoordinator.js';
import { WebServer } from '../../src/web/WebServer.js';
import { WebEventStream } from '../../src/web/events.js';
import { SyncRunManager, type SyncRunSummary } from '../../src/web/syncRuns.js';

const workspaceRoot = path.resolve(process.cwd(), 'tests/workspace');

function createWorkspace(name: string): string {
  const dir = path.join(workspaceRoot, `${name}-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function waitFor<T>(
  read: () => Promise<T>,
  matches: (value: T) => boolean,
  timeoutMs = 5000
): Promise<T> {
  const start = Date.now();
  let last: T;

  while (Date.now() - start < timeoutMs) {
    last = await read();
    if (matches(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  last = await read();
  return last;
}

async function readUntilChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  fragment: string,
  timeoutMs = 5000
): Promise<string> {
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let collected = '';

  while (Date.now() < deadline) {
    const read = reader.read();
    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        clearTimeout(timer);
        reject(new Error(`Timed out waiting for "${fragment}"`));
      }, Math.max(1, deadline - Date.now()));
    });

    const { done, value } = await Promise.race([read, timeout]);
    if (done) break;

    collected += decoder.decode(value, { stream: true });
    if (collected.includes(fragment)) {
      return collected;
    }
  }

  throw new Error(`Timed out waiting for "${fragment}"`);
}

describe('sync API', () => {
  const servers: Array<{ stop(): Promise<void> }> = [];
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.stop()));
    servers.length = 0;
    for (const directory of directories) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
    directories.length = 0;
  });

  async function startServer(options: {
    readOnly?: boolean;
    syncEnabled?: boolean;
    scheduler?: boolean;
    executeSync?: (request: {
      dryRun: boolean;
      force: boolean;
      source: 'web' | 'schedule';
      onProgress: (message: string) => void;
    }) => Promise<SyncRunSummary>;
  } = {}) {
    const workspace = createWorkspace('sync-api');
    directories.push(workspace);

    const vaultPath = path.join(workspace, 'vault');
    fs.mkdirSync(vaultPath, { recursive: true });
    const rulesConfigPath = path.join(workspace, 'rules.json');
    fs.writeFileSync(rulesConfigPath, JSON.stringify({ rulesVersion: 2, rules: {} }));

    const events = new WebEventStream();
    const coordinator = new SyncCoordinator({
      processFile: async () => undefined,
    });

    const executeSync =
      options.executeSync ??
      (async ({ dryRun, onProgress }) => {
        onProgress(dryRun ? 'dry-run started' : 'sync started');
        return {
          uploaded: dryRun ? 2 : 1,
          skipped: 3,
          removed: 1,
          failed: 0,
          parseErrors: 0,
          totalEligible: 4,
          durationMs: 12,
        };
      });

    let syncRuns: SyncRunManager | undefined;
    let scheduler: Scheduler | undefined;

    if (options.syncEnabled !== false) {
      if (options.scheduler) {
        scheduler = {
          triggerNow: vi.fn(() => syncRuns!.executeScheduledRun({ cancelled: false })),
          getStatus: vi.fn(() => ({
            enabled: true,
            spec: '15m',
            intervalMs: 900000,
            running: syncRuns?.isRunning() ?? false,
            consecutiveFailures: 0,
            totalRuns: 0,
          })),
        } as unknown as Scheduler;
      }

      syncRuns = new SyncRunManager({
        coordinator,
        events,
        ...(scheduler ? { scheduler } : {}),
        defaults: { dryRun: false, force: false },
        executeSync: async ({ dryRun, force, source, onProgress }) =>
          executeSync({ dryRun, force, source, onProgress }),
      });
    }

    const server = new WebServer({
      port: 0,
      bindAddress: '127.0.0.1',
      readOnly: options.readOnly ?? false,
      vaultPath,
      rulesConfigPath,
      ignorePatterns: [],
      publicationService: {
        async reloadRules() {
          return undefined;
        },
      } as PublicationService,
      ...(options.syncEnabled !== false
        ? {
            syncService: {
              getStatusSummary: () => ({
                trackedFileCount: 1,
                lastSyncAt: '2026-09-01T18:00:00.000Z',
                totalBytes: 128,
              }),
            } as SyncService,
            syncRuns,
          }
        : {}),
      ...(scheduler ? { scheduler } : {}),
      events,
      syncCoordinator: coordinator,
      healthStatus: () => ({
        watcherActive: true,
        lastFileProcessedAt: '2026-09-01T18:00:00.000Z',
      }),
    });
    servers.push(server);
    await server.start();

    return {
      baseUrl: `http://127.0.0.1:${server.getPort()}`,
      events,
      syncRuns,
      scheduler,
    };
  }

  it('starts a dry-run sync and exposes the completed run', async () => {
    const executeSync = vi.fn(async ({ dryRun, onProgress }) => {
      expect(dryRun).toBe(true);
      onProgress('phase 1');
      onProgress('phase 2');
      return {
        uploaded: 4,
        skipped: 2,
        removed: 1,
        failed: 0,
        parseErrors: 1,
        totalEligible: 6,
        durationMs: 42,
      };
    });
    const { baseUrl } = await startServer({ executeSync });

    const triggerResponse = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({ dryRun: true }),
    });
    const { runId } = (await triggerResponse.json()) as { runId: string };

    expect(triggerResponse.status).toBe(202);

    const run = await waitFor(
      async () =>
        (
          await (
            await fetch(`${baseUrl}/api/sync/${encodeURIComponent(runId)}`)
          ).json()
        ) as {
          status: string;
          dryRun: boolean;
          logs: string[];
          summary: SyncRunSummary;
        },
      (value) => value.status !== 'running'
    );

    expect(run.status).toBe('success');
    expect(run.dryRun).toBe(true);
    expect(run.logs).toContain('phase 1');
    expect(run.summary).toEqual({
      uploaded: 4,
      skipped: 2,
      removed: 1,
      failed: 0,
      parseErrors: 1,
      totalEligible: 6,
      durationMs: 42,
    });
    expect(executeSync).toHaveBeenCalledTimes(1);
  });

  it('returns 409 when a second sync is triggered during an active run', async () => {
    const deferred = createDeferred();
    const { baseUrl } = await startServer({
      executeSync: async ({ onProgress }) => {
        onProgress('holding');
        await deferred.promise;
        return {
          uploaded: 1,
          skipped: 0,
          removed: 0,
          failed: 0,
          parseErrors: 0,
          totalEligible: 1,
          durationMs: 50,
        };
      },
    });

    const firstResponse = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({ dryRun: true }),
    });
    const { runId } = (await firstResponse.json()) as { runId: string };

    const secondResponse = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({ dryRun: true }),
    });

    expect(secondResponse.status).toBe(409);
    await expect(secondResponse.json()).resolves.toEqual({
      error: 'A sync is already in progress',
    });

    deferred.resolve();

    const completed = await waitFor(
      async () =>
        (
          await (
            await fetch(`${baseUrl}/api/sync/${encodeURIComponent(runId)}`)
          ).json()
        ) as { status: string },
      (value) => value.status !== 'running'
    );
    expect(completed.status).toBe('success');
  });

  it('rejects sync triggers in read-only mode', async () => {
    const { baseUrl } = await startServer({ readOnly: true });

    const response = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({ dryRun: true }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Web UI is running in read-only mode',
    });
  });

  it('returns a clear error when sync is not configured', async () => {
    const { baseUrl } = await startServer({ syncEnabled: false });

    const response = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({ dryRun: true }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'Sync is not enabled; restart with --sync to allow web-triggered runs',
    });
  });

  it('streams sync events over SSE and removes the listener on disconnect', async () => {
    const deferred = createDeferred();
    const { baseUrl, events } = await startServer({
      executeSync: async ({ onProgress }) => {
        onProgress('stream hello');
        await deferred.promise;
        onProgress('stream goodbye');
        return {
          uploaded: 1,
          skipped: 0,
          removed: 0,
          failed: 0,
          parseErrors: 0,
          totalEligible: 1,
          durationMs: 30,
        };
      },
    });

    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/events`, {
      signal: controller.signal,
      headers: {
        Accept: 'text/event-stream',
      },
    });
    expect(response.status).toBe(200);
    expect(events.listenerCount()).toBe(1);

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Event stream body unavailable');
    }

    const trigger = fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({ dryRun: true }),
    });

    const firstEvent = await readUntilChunk(reader, 'event: sync-progress');
    expect(firstEvent).toContain('stream hello');

    deferred.resolve();
    await trigger;

    const completion = await readUntilChunk(reader, 'event: sync-complete');
    expect(completion).toContain('stream goodbye');

    controller.abort();
    await waitFor(
      async () => events.listenerCount(),
      (count) => count === 0
    );
  });

  it('truncates stored run logs to the most recent 500 lines', async () => {
    const { baseUrl } = await startServer({
      executeSync: async ({ onProgress }) => {
        for (let index = 1; index <= 650; index += 1) {
          onProgress(`line ${index}`);
        }
        return {
          uploaded: 0,
          skipped: 0,
          removed: 0,
          failed: 0,
          parseErrors: 0,
          totalEligible: 0,
          durationMs: 5,
        };
      },
    });

    const triggerResponse = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({ dryRun: true }),
    });
    const { runId } = (await triggerResponse.json()) as { runId: string };

    const run = await waitFor(
      async () =>
        (
          await (
            await fetch(`${baseUrl}/api/sync/${encodeURIComponent(runId)}`)
          ).json()
        ) as { status: string; logs: string[] },
      (value) => value.status !== 'running'
    );

    expect(run.logs).toHaveLength(500);
    expect(run.logs[0]).toBe('line 151');
    expect(run.logs.at(-1)).toBe('line 650');
  });

  it('delegates manual triggers to scheduler.triggerNow when a scheduler is present', async () => {
    const executeSync = vi.fn(async ({ onProgress, source }) => {
      expect(source).toBe('web');
      onProgress('scheduled delegation');
      return {
        uploaded: 1,
        skipped: 0,
        removed: 0,
        failed: 0,
        parseErrors: 0,
        totalEligible: 1,
        durationMs: 10,
      };
    });
    const { baseUrl, scheduler } = await startServer({ scheduler: true, executeSync });

    const response = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({ dryRun: true }),
    });

    expect(response.status).toBe(202);
    expect((scheduler!.triggerNow as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect(executeSync).toHaveBeenCalledTimes(1);
  });
});
