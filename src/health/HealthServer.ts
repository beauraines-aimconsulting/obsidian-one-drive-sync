import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';

export interface HealthStatus {
  watcherActive: boolean;
  lastFileProcessedAt: string | null;
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
      response.writeHead(status.watcherActive ? 200 : 503, {
        'Content-Type': 'application/json',
      });
      response.end(JSON.stringify({ status: status.watcherActive ? 'ok' : 'unhealthy', ...status }));
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
