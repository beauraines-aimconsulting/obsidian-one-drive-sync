import { SyncConflictError, SyncUnavailableError } from '../syncRuns.js';
import { sendApiError, sendApiJson } from '../security.js';
import type { RouteHandler } from '../types.js';

interface SyncTriggerBody {
  dryRun?: boolean;
  force?: boolean;
}

function readTriggerBody(body: unknown): SyncTriggerBody {
  if (body === undefined) {
    return {};
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Request body must be a JSON object');
  }

  const candidate = body as Record<string, unknown>;
  if (candidate.dryRun !== undefined && typeof candidate.dryRun !== 'boolean') {
    throw new Error('dryRun must be a boolean when provided');
  }
  if (candidate.force !== undefined && typeof candidate.force !== 'boolean') {
    throw new Error('force must be a boolean when provided');
  }

  return {
    ...(typeof candidate.dryRun === 'boolean' ? { dryRun: candidate.dryRun } : {}),
    ...(typeof candidate.force === 'boolean' ? { force: candidate.force } : {}),
  };
}

export const postSync: RouteHandler = async (_request, response, context) => {
  const syncRuns = context.options.syncRuns;
  if (!syncRuns || !context.options.syncService) {
    sendApiError(response, 503, 'Sync is not enabled; restart with --sync to allow web-triggered runs');
    return;
  }

  let body: SyncTriggerBody;
  try {
    body = readTriggerBody(context.body);
  } catch (error) {
    sendApiError(response, 400, error instanceof Error ? error.message : String(error));
    return;
  }

  try {
    const run = syncRuns.triggerRun(body);
    sendApiJson(response, 202, { runId: run.runId });
  } catch (error) {
    if (error instanceof SyncConflictError) {
      sendApiError(response, 409, error.message);
      return;
    }
    if (error instanceof SyncUnavailableError) {
      sendApiError(response, 503, error.message);
      return;
    }
    throw error;
  }
};

export const getSyncRun: RouteHandler = async (_request, response, context) => {
  const syncRuns = context.options.syncRuns;
  if (!syncRuns) {
    sendApiError(response, 503, 'Sync run history is not available');
    return;
  }

  const runId = context.params.runId;
  const run = runId ? syncRuns.getRun(runId) : undefined;
  if (!run) {
    sendApiError(response, 404, 'Sync run not found');
    return;
  }

  sendApiJson(response, 200, run);
};
