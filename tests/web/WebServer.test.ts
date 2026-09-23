import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { HealthServer, type HealthStatus, type HealthStatusProvider } from '../../src/health/HealthServer.js';
import { PublicationService } from '../../src/publications/PublicationService.js';
import { WebServer } from '../../src/web/WebServer.js';
import type { SyncService } from '../../src/graph/SyncService.js';

const workspaceRoot = path.resolve(process.cwd(), 'tests/workspace');

function createWorkspace(name: string): string {
  const dir = path.join(workspaceRoot, `${name}-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makePublicationService(vaultPath: string): PublicationService {
  return new PublicationService({ vaultPath, logLevel: 'warn' });
}

function makeSyncService(): SyncService {
  return {
    getStatusSummary: () => ({
      trackedFileCount: 3,
      lastSyncAt: '2026-09-01T18:00:00.000Z',
      totalBytes: 4096,
    }),
  } as unknown as SyncService;
}

function makeStatusProvider(overrides: Partial<HealthStatus> = {}): HealthStatusProvider {
  return () => ({
    watcherActive: true,
    lastFileProcessedAt: '2026-09-01T18:00:00.000Z',
    ...overrides,
  });
}

describe('WebServer', () => {
  const servers: Array<{ stop(): Promise<void> }> = [];
  const directories: string[] = [];
  const originalEnv = {
    GRAPH_CLIENT_ID: process.env.GRAPH_CLIENT_ID,
    GRAPH_TENANT_ID: process.env.GRAPH_TENANT_ID,
    HEALTH_PORT: process.env.HEALTH_PORT,
    OUTPUT_PATH: process.env.OUTPUT_PATH,
    ONEDRIVE_FOLDER: process.env.ONEDRIVE_FOLDER,
    RULES_CONFIG: process.env.RULES_CONFIG,
    VAULT_PATH: process.env.VAULT_PATH,
    WEB_BIND_ADDRESS: process.env.WEB_BIND_ADDRESS,
    WEB_PORT: process.env.WEB_PORT,
    WEB_UI_ENABLED: process.env.WEB_UI_ENABLED,
    WEB_UI_READONLY: process.env.WEB_UI_READONLY,
    WEB_UI_TOKEN: process.env.WEB_UI_TOKEN,
  };

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.stop()));
    servers.length = 0;
    for (const directory of directories) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
    directories.length = 0;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  async function startWebServer(options: {
    token?: string;
    readOnly?: boolean;
    syncService?: SyncService;
    healthStatus?: HealthStatusProvider;
  } = {}): Promise<WebServer> {
    const workspace = createWorkspace('web-server');
    directories.push(workspace);
    const vaultPath = path.join(workspace, 'vault');
    fs.mkdirSync(vaultPath, { recursive: true });
    const rulesConfigPath = path.join(workspace, 'rules.json');
    fs.writeFileSync(rulesConfigPath, JSON.stringify({ config: {} }));

    const server = new WebServer({
      port: 0,
      bindAddress: '127.0.0.1',
      token: options.token,
      readOnly: options.readOnly ?? false,
      vaultPath,
      rulesConfigPath,
      ignorePatterns: [],
      publicationService: makePublicationService(vaultPath),
      ...(options.syncService ? { syncService: options.syncService } : {}),
      healthStatus: options.healthStatus ?? makeStatusProvider(),
    });
    servers.push(server);
    await server.start();
    return server;
  }

  it('keeps /healthz byte-identical with HealthServer', async () => {
    const status = makeStatusProvider({ watcherActive: false });
    const healthServer = new HealthServer(status, 0);
    servers.push(healthServer);
    await healthServer.start();

    const webServer = await startWebServer({ healthStatus: status });

    const [healthResponse, webResponse] = await Promise.all([
      fetch(`http://127.0.0.1:${healthServer.getPort()}/healthz`),
      fetch(`http://127.0.0.1:${webServer.getPort()}/healthz`),
    ]);

    expect(webResponse.status).toBe(healthResponse.status);
    expect(await webResponse.text()).toBe(await healthResponse.text());
  });

  it('serves /api/status with health and sync summary', async () => {
    const server = await startWebServer({ syncService: makeSyncService() });

    const response = await fetch(`http://127.0.0.1:${server.getPort()}/api/status`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      watcherActive: true,
      lastFileProcessedAt: '2026-09-01T18:00:00.000Z',
      readOnly: false,
      sync: {
        enabled: true,
        trackedFileCount: 3,
        lastSyncAt: '2026-09-01T18:00:00.000Z',
        totalBytes: 4096,
      },
    });
  });

  it('serves sanitized /api/config with sources', async () => {
    const workspace = createWorkspace('config-endpoint');
    directories.push(workspace);
    const rulesConfigPath = path.join(workspace, 'rules.json');
    fs.writeFileSync(
      rulesConfigPath,
      JSON.stringify({
        config: {
          vaultPath: '/file/vault',
          outputPath: '/file/output',
          oneDriveFolder: 'Team Notes',
          webBindAddress: '127.0.0.1',
        },
      })
    );

    process.env.RULES_CONFIG = rulesConfigPath;
    process.env.VAULT_PATH = '/env/vault';
    process.env.OUTPUT_PATH = '/env/output';
    process.env.ONEDRIVE_FOLDER = '';
    process.env.GRAPH_CLIENT_ID = 'client-id-1234';
    process.env.GRAPH_TENANT_ID = 'tenant-id-5678';
    process.env.WEB_UI_TOKEN = 'top-secret';
    process.env.WEB_UI_ENABLED = 'true';

    const server = await startWebServer();
    const response = await fetch(`http://127.0.0.1:${server.getPort()}/api/config`);
    const text = await response.text();
    const payload = JSON.parse(text) as {
      config: Record<string, unknown>;
      sources: Record<string, string>;
    };

    expect(response.status).toBe(200);
    expect(text).not.toContain('top-secret');
    expect(payload.config.clientId).toBe('**********1234');
    expect(payload.config.tenantId).toBe('**********5678');
    expect(payload.config).not.toHaveProperty('webUiToken');
    expect(payload.sources.vaultPath).toBe('env');
    expect(payload.sources.outputPath).toBe('env');
    expect(payload.sources.oneDriveFolder).toBe('file');
    expect(payload.sources.clientId).toBe('env');
    expect(payload.sources.webEnabled).toBe('env');
  });

  it('rejects missing and invalid bearer tokens', async () => {
    const server = await startWebServer({ token: 's3cret-token' });
    const url = `http://127.0.0.1:${server.getPort()}/api/status`;

    const [missing, invalid, valid] = await Promise.all([
      fetch(url),
      fetch(url, { headers: { Authorization: 'Bearer wrong-token' } }),
      fetch(url, { headers: { Authorization: 'Bearer s3cret-token' } }),
    ]);

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(valid.status).toBe(200);
  });

  it('rejects cross-origin mutating requests', async () => {
    const server = await startWebServer();
    const response = await fetch(`http://127.0.0.1:${server.getPort()}/api/unknown`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({ hello: 'world' }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Cross-site requests are not allowed' });
  });

  it('rejects oversized request bodies', async () => {
    const server = await startWebServer();
    const origin = `http://127.0.0.1:${server.getPort()}`;
    const oversizedPayload = JSON.stringify({ data: 'a'.repeat(256 * 1024) });

    const response = await fetch(`http://127.0.0.1:${server.getPort()}/api/unknown`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
      },
      body: oversizedPayload,
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: 'Request body exceeds 256 KiB' });
  });

  it('rejects mutating requests when read-only mode is enabled', async () => {
    const server = await startWebServer({ readOnly: true });
    const origin = `http://127.0.0.1:${server.getPort()}`;

    const response = await fetch(`http://127.0.0.1:${server.getPort()}/api/unknown`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
      },
      body: JSON.stringify({ hello: 'world' }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Web UI is running in read-only mode',
    });
  });

  it('returns a JSON 404 shape for unknown API routes', async () => {
    const server = await startWebServer();

    const response = await fetch(`http://127.0.0.1:${server.getPort()}/api/does-not-exist`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Not found' });
  });

  it('serves the static status shell and browser assets', async () => {
    const server = await startWebServer();

    const [indexResponse, statusResponse, appResponse, rulesResponse, testResponse, filesResponse] = await Promise.all([
      fetch(`http://127.0.0.1:${server.getPort()}/`),
      fetch(`http://127.0.0.1:${server.getPort()}/status.html`),
      fetch(`http://127.0.0.1:${server.getPort()}/app.js`),
      fetch(`http://127.0.0.1:${server.getPort()}/rules.html`),
      fetch(`http://127.0.0.1:${server.getPort()}/test.html`),
      fetch(`http://127.0.0.1:${server.getPort()}/files.html`),
    ]);

    expect(indexResponse.status).toBe(200);
    expect(indexResponse.headers.get('content-type')).toContain('text/html');
    expect(await indexResponse.text()).toContain('Sync control');

    expect(statusResponse.status).toBe(200);
    expect(statusResponse.headers.get('content-type')).toContain('text/html');
    expect(await statusResponse.text()).toContain('live events');

    expect(appResponse.status).toBe(200);
    expect(appResponse.headers.get('content-type')).toContain('text/javascript');
    expect(await appResponse.text()).toContain('new EventSource');

    expect(rulesResponse.status).toBe(200);
    expect(rulesResponse.headers.get('content-type')).toContain('text/html');
    expect(await rulesResponse.text()).toContain('Rules editor');

    expect(testResponse.status).toBe(200);
    expect(testResponse.headers.get('content-type')).toContain('text/html');
    expect(await testResponse.text()).toContain('Rule tester');

    expect(filesResponse.status).toBe(200);
    expect(filesResponse.headers.get('content-type')).toContain('text/html');
    expect(await filesResponse.text()).toContain('Vault files');
  });
});
