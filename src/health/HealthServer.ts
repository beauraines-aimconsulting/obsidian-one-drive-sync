import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import type { ScheduleStatus } from '../schedule/types.js';

export interface HealthStatus {
  watcherActive: boolean;
  lastFileProcessedAt: string | null;
  /** Present only when a schedule is configured. */
  schedule?: ScheduleStatus;
}

/**
 * Liveness means "this process is still doing the job it was started for".
 *
 * In schedule-only mode there is no watcher, so watching cannot be the only
 * signal — that would report 503 forever.
 *
 * Deliberately *not* included: scheduled run failures. The likeliest cause of
 * repeated failures is an expired refresh token, and restarting a container
 * cannot fix something that needs an interactive sign-in; a 503 would only
 * produce a restart loop. Failures are reported in the body, and
 * `maxConsecutiveFailures` remains the only path to exiting.
 */
export function isLive(status: HealthStatus): boolean {
  return status.watcherActive || status.schedule?.enabled === true;
}

export type HealthStatusProvider = () => HealthStatus;

export class HealthServer {
  private server: Server | null = null;

  constructor(
    private readonly status: HealthStatusProvider,
    private readonly port: number
  ) {}

  async start(): Promise<void> {
    if (this.server) throw new Error('Health server is already running');

    this.server = createServer((request, response) => {
      if (request.method !== 'GET' || request.url !== '/healthz') {
        response.writeHead(404).end();
        return;
      }

      const status = this.status();
      const live = isLive(status);
      response.writeHead(live ? 200 : 503, {
        'Content-Type': 'application/json',
      });
      response.end(JSON.stringify({ status: live ? 'ok' : 'unhealthy', ...status }));
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.port, () => {
        this.server?.off('error', reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = null;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  getPort(): number {
    if (!this.server) throw new Error('Health server is not running');
    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Health server has no TCP address');
    }
    return (address as AddressInfo).port;
  }
}
