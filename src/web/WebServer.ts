import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo, Socket } from 'net';
import { URL } from 'url';
import { writeHealthResponse } from '../health/HealthServer.js';
import { Router } from './router.js';
import { getConfig } from './api/config.js';
import { getRules, postValidateRules, putRules } from './api/rules.js';
import { getFileContent, getFiles } from './api/files.js';
import { postRulesTest } from './api/ruleTest.js';
import { getStatus } from './api/status.js';
import { getEvents } from './api/events.js';
import { getSyncRun, postSync } from './api/sync.js';
import {
  applyApiSecurity,
  isAuthorizedRequest,
  isLoopbackBindAddress,
  sendApiError,
} from './security.js';
import { serveStaticFile } from './staticFiles.js';
import type { RouteContext, WebServerOptions } from './types.js';

export { type WebServerOptions } from './types.js';

export class WebServer {
  private server: Server | null = null;
  private readonly router = new Router();

  constructor(private readonly options: WebServerOptions) {
    this.router.add('GET', '/healthz', async (_request, response) => {
      writeHealthResponse(response, this.options.healthStatus());
    });
    this.router.add('GET', '/api/status', getStatus);
    this.router.add('GET', '/api/events', getEvents);
    this.router.add('GET', '/api/config', getConfig);
    this.router.add('GET', '/api/rules', getRules);
    this.router.add('PUT', '/api/rules', putRules);
    this.router.add('POST', '/api/rules/validate', postValidateRules);
    this.router.add('POST', '/api/rules/test', postRulesTest);
    this.router.add('GET', '/api/files', getFiles);
    this.router.add('GET', '/api/files/:filepath*', getFileContent);
    this.router.add('POST', '/api/sync', postSync);
    this.router.add('GET', '/api/sync/:runId', getSyncRun);
  }

  async start(): Promise<void> {
    if (this.server) throw new Error('Web server is already running');

    if (!isLoopbackBindAddress(this.options.bindAddress) && !this.options.token) {
      console.warn(
        `⚠️  Web UI is bound to ${this.options.bindAddress} without WEB_UI_TOKEN. Access will rely entirely on network exposure.`
      );
    }

    this.server = createServer((request, response) => {
      void this.handleRequest(request, response).catch((error) => {
        if (!response.headersSent) {
          sendApiError(response, 500, 'Internal server error');
          return;
        }
        const socket = response.socket as Socket | null;
        socket?.destroy(error instanceof Error ? error : new Error(String(error)));
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.options.port, this.options.bindAddress, () => {
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
    if (!this.server) throw new Error('Web server is not running');
    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Web server has no TCP address');
    }
    return (address as AddressInfo).port;
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    if (this.requiresPageToken(requestUrl.pathname)) {
      if (!isAuthorizedRequest(request, requestUrl, this.options.token)) {
        response.writeHead(401, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end('Unauthorized');
        return;
      }
    }

    const security = await applyApiSecurity(request, response, {
      pathname: requestUrl.pathname,
      requestUrl,
      token: this.options.token,
      readOnly: this.options.readOnly,
    });
    if (security === null) return;

    const match = this.router.match(request.method ?? 'GET', requestUrl.pathname);
    if (match) {
      const context: RouteContext = {
        params: match.params,
        requestUrl,
        body: security.body,
        options: this.options,
      };
      await this.router.handle(match, context, request, response);
      return;
    }

    if (requestUrl.pathname.startsWith('/api/')) {
      sendApiError(response, 404, 'Not found');
      return;
    }

    const served = await serveStaticFile(request, response, requestUrl.pathname);
    if (!served) {
      response.writeHead(404).end();
    }
  }

  private requiresPageToken(pathname: string): boolean {
    return Boolean(this.options.token) && (pathname === '/' || pathname.endsWith('.html'));
  }
}
