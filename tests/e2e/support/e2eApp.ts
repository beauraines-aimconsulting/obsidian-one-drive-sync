import * as fs from 'fs';
import * as path from 'path';
import { PublicationService } from '../../../dist/publications/PublicationService.js';
import type { SyncService, SyncStatusSummary } from '../../../dist/graph/SyncService.js';
import { WebServer } from '../../../dist/web/WebServer.js';
import { WebEventStream } from '../../../dist/web/events.js';
import { SyncCoordinator } from '../../../dist/schedule/SyncCoordinator.js';
import { SyncRunManager, type SyncRunSummary } from '../../../dist/web/syncRuns.js';
import { walkMarkdown } from '../../../dist/vault/walkMarkdown.js';
import { seedFixtureWorkspace } from './fixtures.ts';

export interface StartedE2EApp {
  baseUrl: string;
  vaultPath: string;
  rulesConfigPath: string;
  stop(): Promise<void>;
}

export interface E2EAppOptions {
  workspaceRoot: string;
  port?: number;
  bindAddress?: string;
  token?: string;
  readOnly?: boolean;
  resetWorkspace?: boolean;
  syncEnabled?: boolean;
}

interface MutableSyncStatus extends SyncStatusSummary {
  lastFileProcessedAt: string | null;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeRelativePath(vaultPath: string, absolutePath: string): string {
  return path.relative(vaultPath, absolutePath).replace(/\\/g, '/');
}

async function runFixtureDryRunSync(options: {
  vaultPath: string;
  publicationService: PublicationService;
  ignorePatterns: string[];
  events: WebEventStream;
  syncStatus: MutableSyncStatus;
  onProgress: (message: string) => void;
}): Promise<SyncRunSummary> {
  const startedAt = Date.now();
  const files = walkMarkdown(options.vaultPath, { ignorePatterns: options.ignorePatterns });
  let uploaded = 0;
  let parseErrors = 0;
  let totalBytes = 0;

  options.onProgress('📂 Scanning vault...');
  options.onProgress(`   Found ${files.length} markdown files`);
  await sleep(20);

  for (const absolutePath of files) {
    const relativePath = normalizeRelativePath(options.vaultPath, absolutePath);
    const content = fs.readFileSync(absolutePath, 'utf-8');
    const evaluation = await options.publicationService.evaluateFile(relativePath, content);
    options.syncStatus.lastFileProcessedAt = new Date().toISOString();

    if (evaluation.parseError) {
      parseErrors += 1;
      options.onProgress(`   ⚠️  Skipped (frontmatter): ${relativePath} — ${evaluation.reason}`);
      options.events.publish({
        type: 'file-evaluated',
        timestamp: new Date().toISOString(),
        filepath: relativePath,
        action: 'parse-error',
        eligible: false,
        reason: evaluation.reason,
        parseError: true,
      });
      await sleep(10);
      continue;
    }

    if (evaluation.eligible) {
      uploaded += 1;
      totalBytes += Buffer.byteLength(content, 'utf-8');
      options.onProgress(`   [dry-run] Would upload: ${relativePath}`);
      options.events.publish({
        type: 'file-evaluated',
        timestamp: new Date().toISOString(),
        filepath: relativePath,
        action: 'eligible',
        eligible: true,
        reason: evaluation.reason,
      });
      await sleep(10);
      continue;
    }

    options.events.publish({
      type: 'file-evaluated',
      timestamp: new Date().toISOString(),
      filepath: relativePath,
      action: 'ineligible',
      eligible: false,
      reason: evaluation.reason,
    });
  }

  options.syncStatus.trackedFileCount = uploaded;
  options.syncStatus.lastSyncAt = new Date().toISOString();
  options.syncStatus.totalBytes = totalBytes;

  options.onProgress('');
  options.onProgress('Sync complete:');
  options.onProgress(`  ⬆️  Uploaded: ${uploaded}`);
  options.onProgress('  ⏭️  Skipped (unchanged): 0');
  options.onProgress('  🗑️  Removed: 0');
  options.onProgress(`  ⚠️  Skipped (frontmatter parse errors): ${parseErrors}`);
  options.onProgress(`  ⏱️  Duration: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

  return {
    uploaded,
    skipped: 0,
    removed: 0,
    failed: 0,
    parseErrors,
    totalEligible: uploaded,
    durationMs: Date.now() - startedAt,
  };
}

export async function startE2EApp(options: E2EAppOptions): Promise<StartedE2EApp> {
  if (options.resetWorkspace !== false) {
    await seedFixtureWorkspace(options.workspaceRoot);
  }

  const vaultPath = path.join(options.workspaceRoot, 'vault');
  const rulesConfigPath = path.join(options.workspaceRoot, 'rules.json');
  const events = new WebEventStream();
  const ignorePatterns: string[] = [];
  const publicationService = new PublicationService({
    vaultPath,
    logLevel: 'warn',
  });
  await publicationService.reloadRules(rulesConfigPath);

  const syncStatus: MutableSyncStatus = {
    trackedFileCount: 0,
    lastSyncAt: null,
    totalBytes: 0,
    lastFileProcessedAt: null,
  };

  const coordinator = new SyncCoordinator({
    processFile: async () => undefined,
  });

  let syncRuns: SyncRunManager | undefined;
  let syncService: SyncService | undefined;

  if (options.syncEnabled !== false) {
    syncService = {
      getStatusSummary: () => ({
        trackedFileCount: syncStatus.trackedFileCount,
        lastSyncAt: syncStatus.lastSyncAt,
        totalBytes: syncStatus.totalBytes,
      }),
    } as SyncService;

    syncRuns = new SyncRunManager({
      coordinator,
      events,
      defaults: { dryRun: true, force: false },
      executeSync: async ({ onProgress }) =>
        runFixtureDryRunSync({
          vaultPath,
          publicationService,
          ignorePatterns,
          events,
          syncStatus,
          onProgress,
        }),
    });
  }

  const server = new WebServer({
    port: options.port ?? 0,
    bindAddress: options.bindAddress ?? '127.0.0.1',
    ...(options.token ? { token: options.token } : {}),
    readOnly: options.readOnly ?? false,
    vaultPath,
    rulesConfigPath,
    ignorePatterns,
    publicationService,
    ...(syncService ? { syncService } : {}),
    ...(syncRuns ? { syncRuns } : {}),
    events,
    syncCoordinator: coordinator,
    healthStatus: () => ({
      watcherActive: true,
      lastFileProcessedAt: syncStatus.lastFileProcessedAt,
    }),
  });

  await server.start();

  return {
    baseUrl: `http://${options.bindAddress ?? '127.0.0.1'}:${server.getPort()}`,
    vaultPath,
    rulesConfigPath,
    stop: async () => {
      await server.stop();
    },
  };
}
