import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from './config/ConfigManager.js';
import { PublicationService } from './publications/PublicationService.js';
import { VaultWatcher } from './vault/VaultWatcher.js';
import { walkMarkdown } from './vault/walkMarkdown.js';
import { GraphAuthProvider } from './graph/GraphAuthProvider.js';
import { GraphProbe } from './graph/GraphProbe.js';
import { SyncService } from './graph/SyncService.js';
import { SyncStateStore } from './graph/SyncStateStore.js';
import { createGracefulShutdown } from './cli/gracefulShutdown.js';
import { HealthServer } from './health/HealthServer.js';
import type { CliOptions } from './cli/types.js';

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: false, help: false, probe: false, logout: false, sync: false, forceSync: false, watch: false, configPath: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') options.help = true;
    else if (argv[i] === '--dry-run') options.dryRun = true;
    else if (argv[i] === '--probe') options.probe = true;
    else if (argv[i] === '--logout') options.logout = true;
    else if (argv[i] === '--sync') options.sync = true;
    else if (argv[i] === '--force-sync') options.forceSync = true;
    else if (argv[i] === '--watch') options.watch = true;
    else if (argv[i] === '--config') options.configPath = argv[++i];
    else throw new Error(`Unknown option: ${argv[i]}`);
  }
  return options;
}

export function usage(): string {
  return `Usage: obsidian-one-drive-sync [options]\n\nOptions:\n  --config <path>  Path to config.json\n  --dry-run        Scan once and exit (or preview sync without uploading)\n  --sync           Sync eligible files to OneDrive\n  --watch          Keep running and sync changes as they happen\n                   (combine with --sync for an initial full sync)\n  --force-sync     Re-upload all eligible files regardless of changes\n  --probe          Test Graph API connectivity and permissions\n  --logout         Clear cached authentication tokens\n  --help           Show help`;
}

async function runProbe(config: import('./config/types.js').AppConfig): Promise<number> {
  const clientId = config.clientId ?? process.env.GRAPH_CLIENT_ID;
  const tenantId = config.tenantId ?? process.env.GRAPH_TENANT_ID ?? 'common';

  let authProvider: GraphAuthProvider;
  let quickTest = false;

  if (!clientId) {
    // Use Azure CLI well-known client ID for quick connectivity test
    console.log('🔍 Graph API Quick Connectivity Test (Azure CLI credentials)');
    console.log('   No custom app registration — using Azure CLI client ID');
    console.log('   Note: Files.ReadWrite may not be available without a custom app registration\n');
    authProvider = GraphAuthProvider.withAzureCliCredentials(tenantId);
    quickTest = true;
  } else {
    console.log('🔍 Graph API Connectivity Probe');
    authProvider = new GraphAuthProvider({ clientId, tenantId });
  }

  console.log('────────────────────────────────────────');
  console.log(`  Client ID: ${quickTest ? '(Azure CLI)' : clientId}`);
  console.log(`  Tenant ID: ${tenantId}`);
  console.log('');

  const probe = new GraphProbe(authProvider);

  const report = await probe.runAll((message) => {
    console.log('🔐 ' + message);
  });

  // Display results
  console.log('\n────────────────────────────────────────');
  console.log('Results:');
  console.log(`  Authentication: ${report.authentication.success ? '✅ Success' : '❌ Failed'}`);

  if (report.authentication.error) {
    console.log(`  Error: ${report.authentication.error}`);
  }

  for (const result of report.permissions) {
    const icon = result.success ? '✅' : '❌';
    console.log(`  ${icon} ${result.endpoint}`);
    if (result.error) {
      console.log(`     Error: ${result.error}`);
    }
  }

  console.log('');
  if (report.summary.allPassed) {
    console.log('🎉 All checks passed! OneDrive sync is ready.');
  } else if (report.summary.adminConsentRequired) {
    console.log('⚠️  Admin consent required. Generating request...\n');
    console.log(probe.generateAdminConsentRequest());
  } else {
    console.log('❌ Some checks failed. Review errors above.');
  }

  return report.summary.allPassed ? 0 : 1;
}

function buildSyncService(
  config: import('./config/types.js').AppConfig,
  publicationService: PublicationService,
  options: CliOptions
): SyncService | null {
  const clientId = config.clientId ?? process.env.GRAPH_CLIENT_ID;
  const tenantId = config.tenantId ?? process.env.GRAPH_TENANT_ID ?? 'common';

  if (!clientId) {
    console.error('❌ Sync requires a Graph API client ID.');
    console.error('   Set GRAPH_CLIENT_ID or add "clientId" to your config.json.');
    return null;
  }

  const authProvider = new GraphAuthProvider({ clientId, tenantId });
  const syncState = new SyncStateStore();

  return new SyncService(publicationService, authProvider, syncState, {
    vaultPath: config.vaultPath,
    targetFolder: config.oneDriveFolder,
    forceSync: options.forceSync,
    dryRun: options.dryRun,
    ignorePatterns: config.ignorePatterns,
  });
}

async function runSync(
  config: import('./config/types.js').AppConfig,
  publicationService: PublicationService,
  options: CliOptions,
  syncService?: SyncService
): Promise<number> {
  const service = syncService ?? buildSyncService(config, publicationService, options);
  if (!service) return 1;

  console.log('🔄 Starting sync...');
  console.log(`   Vault: ${config.vaultPath}`);
  console.log(`   Target: OneDrive:/${config.oneDriveFolder}`);
  if (options.dryRun) console.log('   Mode: DRY RUN (no uploads)');
  if (options.forceSync) console.log('   Mode: FORCE (re-upload all)');
  console.log('');

  const result = await service.sync((msg) => console.log(msg));

  console.log('\n────────────────────────────────────────');
  console.log('Sync complete:');
  console.log(`  ⬆️  Uploaded: ${result.uploaded.length}`);
  console.log(`  ⏭️  Skipped (unchanged): ${result.skipped.length}`);
  console.log(`  🗑️  Removed: ${result.removed.length}`);
  if (result.parseErrors.length > 0) {
    console.log(`  ⚠️  Skipped (frontmatter parse errors): ${result.parseErrors.length}`);
    for (const p of result.parseErrors) {
      console.log(`     ${p.filepath}: ${p.reason}`);
    }
  }
  if (result.failed.length > 0) {
    console.log(`  ❌ Failed: ${result.failed.length}`);
    for (const f of result.failed) {
      console.log(`     ${f.filepath}: ${f.error}`);
    }
  }
  console.log(`  ⏱️  Duration: ${(result.duration / 1000).toFixed(1)}s`);

  return result.failed.length > 0 ? 1 : 0;
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const configPath = options.configPath ? path.resolve(options.configPath) : undefined;
  if (configPath) process.env.RULES_CONFIG = configPath;
  const config = await new ConfigManager().load();

  // Graph API probe mode
  if (options.probe) {
    return runProbe(config);
  }

  // Logout mode
  if (options.logout) {
    const { FileCachePlugin } = await import('./graph/FileCachePlugin.js');
    const cache = new FileCachePlugin();
    cache.clearCache();
    console.log('✅ Cached tokens cleared.');
    return 0;
  }

  if (!fs.existsSync(config.vaultPath)) throw new Error(`Invalid vault path: ${config.vaultPath}`);
  const publicationService = new PublicationService({ 
    logLevel: config.logLevel,
    vaultPath: config.vaultPath,
  });

  // Load rules from config file
  const rulesPath = configPath ?? config.rulesConfig;
  if (rulesPath && fs.existsSync(rulesPath)) {
    await publicationService.reloadRules(rulesPath);
  } else if (configPath) {
    throw new Error(`Config file not found: ${configPath}`);
  } else {
    console.warn('⚠️  No rules config found — all files will pass (no rules configured)');
  }

  // One-shot sync mode (no watching)
  if (options.sync && !options.watch) {
    return runSync(config, publicationService, options);
  }

  // Watch mode optionally uploads; without --sync it only evaluates rules.
  let syncService: SyncService | null = null;
  if (options.watch && options.sync) {
    syncService = buildSyncService(config, publicationService, options);
    if (!syncService) return 1;
    const exitCode = await runSync(config, publicationService, options, syncService);
    if (exitCode !== 0) return exitCode;
    console.log('');
  }

  const watcher = new VaultWatcher({
    debounceDelay: config.debounceDelay,
    ignorePatterns: config.ignorePatterns,
    usePolling: config.usePolling,
    pollInterval: config.pollInterval,
  });
  const evaluate = async (filepath: string) => {
    const relativePath = path.relative(config.vaultPath, filepath);
    if (syncService) {
      const result = await syncService.syncFile(relativePath, (msg) => console.log(msg));
      if (result.action === 'failed') {
        console.error(`❌ ${relativePath} - sync failed: ${result.error}`);
      }
      return;
    }
    const result = await publicationService.evaluateFile(relativePath, fs.readFileSync(filepath, 'utf-8'));
    const icon = result.parseError ? '⚠️' : result.eligible ? '✅' : '⛔';
    console.log(`${icon} ${relativePath} - ${result.reason}`);
  };
  console.log(`📂 Monitoring vault: ${config.vaultPath}`);
  if (syncService) {
    console.log(`   Uploading changes to OneDrive:/${config.oneDriveFolder}`);
  } else {
    console.log('   Evaluate-only (add --sync to upload changes)');
  }
  if (options.dryRun) {
    const files = walkMarkdown(config.vaultPath, { ignorePatterns: config.ignorePatterns });
    console.log(`Scanning ${files.length} markdown files...\n`);
    for (const file of files) await evaluate(file);
    return 0;
  }

  const pendingEvaluations = new Set<Promise<void>>();
  const inFlight = new Map<string, Promise<void>>();
  let lastFileProcessedAt: string | null = null;
  const evaluateFile = (filepath: string): void => {
    // Serialize per file so rapid edits can't upload out of order.
    const previous = inFlight.get(filepath) ?? Promise.resolve();
    const evaluation = previous
      .catch(() => undefined)
      .then(() => evaluate(filepath))
      .then(() => {
        lastFileProcessedAt = new Date().toISOString();
      });
    inFlight.set(filepath, evaluation);
    pendingEvaluations.add(evaluation);
    void evaluation.then(
      () => {
        pendingEvaluations.delete(evaluation);
        if (inFlight.get(filepath) === evaluation) inFlight.delete(filepath);
      },
      (error: unknown) => {
        pendingEvaluations.delete(evaluation);
        if (inFlight.get(filepath) === evaluation) inFlight.delete(filepath);
        console.error(
          `Failed to evaluate ${filepath}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    );
  };

  watcher.on('add', (e) => evaluateFile(e.filepath));
  watcher.on('modify', (e) => evaluateFile(e.filepath));
  // Deletions matter only when uploading; evaluate-only mode can't read the file.
  if (syncService) {
    watcher.on('delete', (e) => evaluateFile(e.filepath));
  }
  await watcher.watch(config.vaultPath);
  const healthServer = new HealthServer(
    () => ({
      watcherActive: watcher.isWatching(),
      lastFileProcessedAt,
    }),
    config.healthPort
  );
  await healthServer.start();
  console.log(`❤️  Health probe: http://localhost:${config.healthPort}/healthz`);

  return await new Promise<number>((resolve) => {
    const shutdownHandler = createGracefulShutdown(watcher, pendingEvaluations, {
      info: (message) => console.log(`\n${message}`),
      error: (message) => console.error(message),
    }, healthServer);
    const shutdown = async (signal: string): Promise<void> => resolve(await shutdownHandler(signal));

    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
