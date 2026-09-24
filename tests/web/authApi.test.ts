import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceCodeFlowConflictError } from '../../src/graph/GraphAuthProvider.js';
import type { DeviceCodeFlowState } from '../../src/graph/types.js';
import type { PublicationService } from '../../src/publications/PublicationService.js';
import type { Scheduler } from '../../src/schedule/Scheduler.js';
import { WebServer } from '../../src/web/WebServer.js';

const workspaceRoot = path.resolve(process.cwd(), 'tests/workspace');

function createWorkspace(name: string): string {
  const dir = path.join(workspaceRoot, `${name}-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

class FakeAuthProvider implements WebAuthProvider {
  readonly userCode = 'WEB-CODE-1234';
  readonly verificationUri = 'https://microsoft.com/devicelogin';
  readonly tokenValue = 'TOP-SECRET-TOKEN';
  readonly tokenExpiresAt = '2026-10-01T12:00:00.000Z';

  private onSuccess?: () => void;
  private startedAt: string | null = null;
  private expiresAt: string | null = null;
  private completedAt: string | null = null;
  private hasCachedToken = false;
  private flowState: DeviceCodeFlowState = 'idle';
  private flowPending = false;

  async startDeviceCodeFlow(options?: { scopes?: string[]; onSuccess?: () => void }) {
    if (this.flowPending) {
      throw new DeviceCodeFlowConflictError('A device-code sign-in is already pending');
    }

    this.onSuccess = options?.onSuccess;
    this.startedAt = '2026-09-23T20:00:00.000Z';
    this.expiresAt = '2026-09-23T20:15:00.000Z';
    this.completedAt = null;
    this.flowState = 'pending';
    this.flowPending = true;

    return {
      userCode: this.userCode,
      verificationUri: this.verificationUri,
      expiresAt: this.expiresAt,
    };
  }

  getAuthStatus() {
    return {
      hasCachedToken: this.hasCachedToken,
      tokenExpiresAt: this.hasCachedToken ? this.tokenExpiresAt : null,
      flowState: this.flowState,
      flowPending: this.flowPending,
      flowStartedAt: this.startedAt,
      flowExpiresAt: this.flowPending ? this.expiresAt : null,
      flowCompletedAt: this.flowPending ? null : this.completedAt,
    };
  }

  logout(): void {
    this.hasCachedToken = false;
    this.flowPending = false;
    this.flowState = 'cancelled';
    this.completedAt = '2026-09-23T20:10:00.000Z';
    this.onSuccess = undefined;
  }

  completeSuccess(): void {
    this.hasCachedToken = true;
    this.flowPending = false;
    this.flowState = 'succeeded';
    this.completedAt = '2026-09-23T20:05:00.000Z';
    this.onSuccess?.();
    this.onSuccess = undefined;
  }
}

describe('auth API', () => {
  const servers: Array<{ stop(): Promise<void> }> = [];
  const directories: string[] = [];
  const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    consoleLog.mockClear();
    consoleWarn.mockClear();
    consoleError.mockClear();
  });

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.stop()));
    servers.length = 0;
    for (const directory of directories) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
    directories.length = 0;
  });

  afterEach(() => {
    consoleLog.mockClear();
    consoleWarn.mockClear();
    consoleError.mockClear();
  });

  afterAll(() => {
    consoleLog.mockRestore();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });

  async function startServer(options: {
    token?: string;
    scheduler?: Scheduler;
    authProvider?: FakeAuthProvider;
  } = {}) {
    const workspace = createWorkspace('auth-api');
    directories.push(workspace);

    const vaultPath = path.join(workspace, 'vault');
    fs.mkdirSync(vaultPath, { recursive: true });
    const rulesConfigPath = path.join(workspace, 'rules.json');
    fs.writeFileSync(rulesConfigPath, JSON.stringify({ rulesVersion: 2, rules: {} }));

    const authProvider = options.authProvider ?? new FakeAuthProvider();

    const server = new WebServer({
      port: 0,
      bindAddress: '127.0.0.1',
      token: options.token,
      readOnly: false,
      vaultPath,
      rulesConfigPath,
      ignorePatterns: [],
      publicationService: {
        async reloadRules() {
          return undefined;
        },
      } as PublicationService,
      authProvider,
      ...(options.scheduler ? { scheduler: options.scheduler } : {}),
      healthStatus: () => ({
        watcherActive: true,
        lastFileProcessedAt: '2026-09-01T18:00:00.000Z',
      }),
    });

    servers.push(server);
    await server.start();

    return {
      baseUrl: `http://127.0.0.1:${server.getPort()}`,
      authProvider,
    };
  }

  function combinedConsoleOutput(): string {
    return [consoleLog, consoleWarn, consoleError]
      .flatMap((spy) => spy.mock.calls.flat().map((value) => String(value)))
      .join('\n');
  }

  it('starts a device-code flow and returns the user code and verification URI', async () => {
    const { baseUrl, authProvider } = await startServer();

    const response = await fetch(`${baseUrl}/api/auth/device-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({}),
    });
    const payload = (await response.json()) as {
      userCode: string;
      verificationUri: string;
      expiresAt: string;
    };

    expect(response.status).toBe(202);
    expect(payload).toEqual({
      userCode: authProvider.userCode,
      verificationUri: authProvider.verificationUri,
      expiresAt: '2026-09-23T20:15:00.000Z',
    });
  });

  it('rejects a second concurrent device-code flow request', async () => {
    const { baseUrl } = await startServer();

    const first = await fetch(`${baseUrl}/api/auth/device-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({}),
    });
    const second = await fetch(`${baseUrl}/api/auth/device-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({}),
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toEqual({
      error: 'A device-code sign-in is already pending',
    });
  });

  it('returns only booleans, timestamps, and enum-like auth status fields', async () => {
    const { baseUrl, authProvider } = await startServer();

    await fetch(`${baseUrl}/api/auth/device-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({}),
    });
    authProvider.completeSuccess();

    const response = await fetch(`${baseUrl}/api/auth/status`);
    const payload = (await response.json()) as Record<string, unknown>;
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(Object.keys(payload).sort()).toEqual([
      'flowCompletedAt',
      'flowExpiresAt',
      'flowPending',
      'flowStartedAt',
      'flowState',
      'hasCachedToken',
      'tokenExpiresAt',
    ]);
    expect(payload.flowState).toBe('succeeded');
    expect(serialized).not.toContain(authProvider.userCode);
    expect(serialized).not.toContain(authProvider.tokenValue);
    expect(serialized).not.toContain(authProvider.verificationUri);
  });

  it('logs out and clears cached auth status', async () => {
    const { baseUrl, authProvider } = await startServer();

    await fetch(`${baseUrl}/api/auth/device-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({}),
    });
    authProvider.completeSuccess();

    const response = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({}),
    });
    const payload = (await response.json()) as {
      hasCachedToken: boolean;
      flowState: string;
    };

    expect(response.status).toBe(200);
    expect(payload.hasCachedToken).toBe(false);
    expect(payload.flowState).toBe('cancelled');
  });

  it('applies bearer-token auth and csrf protection to auth routes', async () => {
    const { baseUrl } = await startServer({ token: 'web-secret' });

    const missing = await fetch(`${baseUrl}/api/auth/device-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({}),
    });
    const invalid = await fetch(`${baseUrl}/api/auth/device-code`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer wrong-token',
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({}),
    });
    const crossOrigin = await fetch(`${baseUrl}/api/auth/device-code`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer web-secret',
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({}),
    });

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(crossOrigin.status).toBe(403);
    await expect(crossOrigin.json()).resolves.toEqual({
      error: 'Cross-site requests are not allowed',
    });
  });

  it('resets the scheduler failure counter after successful re-authentication', async () => {
    const scheduler = {
      resetConsecutiveFailures: vi.fn(),
    } as unknown as Scheduler;
    const { baseUrl, authProvider } = await startServer({ scheduler });

    const response = await fetch(`${baseUrl}/api/auth/device-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(202);
    expect(scheduler.resetConsecutiveFailures).not.toHaveBeenCalled();

    authProvider.completeSuccess();

    expect(scheduler.resetConsecutiveFailures).toHaveBeenCalledTimes(1);
  });

  it('does not write device codes or token material to console logs', async () => {
    const { baseUrl, authProvider } = await startServer();

    await fetch(`${baseUrl}/api/auth/device-code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({}),
    });
    authProvider.completeSuccess();
    await fetch(`${baseUrl}/api/auth/status`);
    await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({}),
    });

    const output = combinedConsoleOutput();
    expect(output).not.toContain(authProvider.userCode);
    expect(output).not.toContain(authProvider.verificationUri);
    expect(output).not.toContain(authProvider.tokenValue);
  });
});
