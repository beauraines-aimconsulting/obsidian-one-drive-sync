import type { IncomingMessage, ServerResponse } from 'http';
import type { URL } from 'url';
import type { Scheduler } from '../schedule/Scheduler.js';
import type { SyncCoordinator } from '../schedule/SyncCoordinator.js';
import type { AuthStatusSnapshot, DeviceCodeFlowStartResult } from '../graph/types.js';
import type { SyncService } from '../graph/SyncService.js';
import type { HealthStatusProvider } from '../health/HealthServer.js';
import type { PublicationService } from '../publications/PublicationService.js';
import type { WebEventStream } from './events.js';
import type { SyncRunManager } from './syncRuns.js';

export interface WebAuthProvider {
  startDeviceCodeFlow(options?: {
    scopes?: string[];
    onSuccess?: () => void;
  }): Promise<DeviceCodeFlowStartResult>;
  getAuthStatus(): AuthStatusSnapshot;
  logout(): void;
}

export interface WebServerOptions {
  port: number;
  bindAddress: string;
  token?: string;
  readOnly: boolean;
  vaultPath: string;
  rulesConfigPath: string;
  ignorePatterns?: string[];
  publicationService: PublicationService;
  syncService?: SyncService;
  authProvider?: WebAuthProvider;
  scheduler?: Scheduler;
  syncCoordinator?: SyncCoordinator;
  events?: WebEventStream;
  syncRuns?: SyncRunManager;
  healthStatus: HealthStatusProvider;
}

export interface RouteContext {
  params: Record<string, string>;
  requestUrl: URL;
  body?: unknown;
  options: WebServerOptions;
}

export type RouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  context: RouteContext
) => Promise<void>;

export interface ApiErrorBody {
  error: string;
}
