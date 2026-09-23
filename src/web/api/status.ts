import * as fs from 'fs';
import * as path from 'path';
import type { RouteHandler } from '../types.js';
import { sendApiJson } from '../security.js';

function readAppVersion(): string {
  try {
    const packageJsonPath = path.resolve(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
      version?: string;
    };
    return packageJson.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export const getStatus: RouteHandler = async (_request, response, context) => {
  const syncSummary = context.options.syncService?.getStatusSummary();

  sendApiJson(response, 200, {
    ...context.options.healthStatus(),
    version: readAppVersion(),
    readOnly: context.options.readOnly,
    sync: {
      enabled: context.options.syncService !== undefined,
      trackedFileCount: syncSummary?.trackedFileCount ?? 0,
      lastSyncAt: syncSummary?.lastSyncAt ?? null,
      totalBytes: syncSummary?.totalBytes ?? 0,
    },
    ...(context.options.scheduler ? { schedule: context.options.scheduler.getStatus() } : {}),
  });
};
