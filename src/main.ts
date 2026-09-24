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
import { Scheduler } from './schedule/Scheduler.js';
import { ScheduleHistoryStore } from './schedule/ScheduleHistoryStore.js';
import { SyncCoordinator } from './schedule/SyncCoordinator.js';
import { describeRunError } from './schedule/runErrors.js';
import { HealthServer } from './health/HealthServer.js';
import { WebServer } from './web/WebServer.js';
import { WebEventStream } from './web/events.js';
import { SyncRunManager, type SyncRunSummary } from './web/syncRuns.js';
import { parseDuration } from './utils/duration.js';
import type { CliOptions } from './cli/types.js';

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    help: false,
    probe: false,
    logout: false,
    sync: false,
    forceSync: false,
    watch: false,
    web: false,
    migrateRules: false,
    yes: false,
    explain: undefined,
    explainJson: false,
    schedule: undefined,
    webPort: undefined,
    configPath: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') options.help = true;
    else if (argv[i] === '--dry-run') options.dryRun = true;
    else if (argv[i] === '--probe') options.probe = true;
    else if (argv[i] === '--logout') options.logout = true;
    else if (argv[i] === '--sync') options.sync = true;
    else if (argv[i] === '--force-sync') options.forceSync = true;
    else if (argv[i] === '--watch') options.watch = true;
    else if (argv[i] === '--web') options.web = true;
    else if (argv[i] === '--migrate-rules') options.migrateRules = true;
    else if (argv[i] === '--yes' || argv[i] === '-y') options.yes = true;
    else if (argv[i] === '--explain') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--explain requires a vault-relative file path');
      }
      options.explain = value;
    } else if (argv[i] === '--explain-json') options.explainJson = true;
    else if (argv[i] === '--schedule') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--schedule requires an interval, e.g. 15m, 1h, 1d');
      }
      options.schedule = value;
    } else if (argv[i] === '--web-port') {
      const value = argv[++i];
      if (value === undefined || value.startsWith('-')) {
        throw new Error('--web-port requires a TCP port number');
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error('--web-port must be an integer between 1 and 65535');
      }
      options.web = true;
      options.webPort = parsed;
    } else if (argv[i] === '--config') options.configPath = argv[++i];
    else throw new Error(`Unknown option: ${argv[i]}`);
  }

  // Migration rewrites the config file; running it alongside a sync or watch
  // would change the rules underneath a run already in progress.
  if (options.migrateRules) {
    const conflicting = (['sync', 'watch', 'probe', 'logout', 'forceSync'] as const).filter(
      (flag) => options[flag]
    );
    if (conflicting.length > 0) {
      throw new Error(
        '--migrate-rules cannot be combined with --sync, --watch, --probe, or --logout'
      );
    }
  }

  // --explain is a one-shot inspection of a single file; pairing it with a mode
  // that watches or uploads would be ambiguous about what actually ran.
  if (options.explain !== undefined) {
    const conflicting = (
      ['sync', 'watch', 'probe', 'logout', 'forceSync', 'migrateRules'] as const
    ).filter((flag) => options[flag]);
    if (conflicting.length > 0 || options.schedule !== undefined) {
      throw new Error(
        '--explain cannot be combined with --sync, --watch, --schedule, --probe, --logout, or --migrate-rules'
      );
    }
  } else if (options.explainJson) {
    throw new Error('--explain-json requires --explain <path>');
  }

  if (options.schedule !== undefined) {
    // Validated here so a typo fails at startup rather than at the first tick,
    // which could be an hour later.
    parseDuration(options.schedule);

    const conflicting = (['probe', 'logout', 'migrateRules'] as const).filter(
      (flag) => options[flag]
    );
    if (conflicting.length > 0) {
      throw new Error('--schedule cannot be combined with --probe, --logout, or --migrate-rules');
    }

    // Scheduling exists to upload; evaluating on a timer would achieve nothing.
    // --dry-run still applies, so a cadence can be validated before it uploads.
    options.sync = true;
  }

  return options;
}

export function usage(): string {
  return `Usage: obsidian-one-drive-sync [options]\n\nOptions:\n  --config <path>  Path to config.json\n  --dry-run        Scan once and exit (or preview sync without uploading)\n  --sync           Sync eligible files to OneDrive\n  --watch          Keep running and sync changes as they happen\n                   (combine with --sync for an initial full sync)\n  --web            Enable the local web UI on the configured port\n  --web-port <n>   Override the web UI port (implies --web)\n  --force-sync     Re-upload all eligible files regardless of changes\n  --schedule <interval>\n                   Run a full sync repeatedly (e.g. 15m, 1h, 1d). Implies\n                   --sync; combine with --watch for event-driven updates\n                   plus periodic reconciliation\n  --explain <path> Evaluate one vault file and print why it was or was not\n                   eligible (exit 0 eligible, 1 ineligible, 2 error)\n  --explain-json   With --explain, emit the raw result as JSON\n  --migrate-rules  Rewrite the rules config as rulesVersion 2 (preview only\n                   unless --yes is given)\n  --yes, -y        Confirm an action that otherwise only previews\n  --probe          Test Graph API connectivity and permissions\n  --logout         Clear cached authentication tokens\n  --help           Show help`;
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
    console.log(
      '   Note: Files.ReadWrite may not be available without a custom app registration\n'
    );
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
  options: CliOptions,
  authProvider?: GraphAuthProvider
): SyncService | null {
  const clientId = config.clientId ?? process.env.GRAPH_CLIENT_ID;
  const tenantId = config.tenantId ?? process.env.GRAPH_TENANT_ID ?? 'common';
  const provider =
    authProvider ?? (clientId ? new GraphAuthProvider({ clientId, tenantId }) : null);
  if (!provider) {
    console.error('❌ Sync requires a Graph API client ID.');
    console.error('   Set GRAPH_CLIENT_ID or add "clientId" to your config.json.');
    return null;
  }

  const syncState = new SyncStateStore();

  return new SyncService(publicationService, provider, syncState, {
    vaultPath: config.vaultPath,
    targetFolder: config.oneDriveFolder,
    forceSync: options.forceSync,
    dryRun: options.dryRun,
    ignorePatterns: config.ignorePatterns,
  });
}

/**
 * Outcome of one sync, as both an exit code and the counts a scheduled run
 * needs to report. The scheduler distinguishes "some files failed" from "the
 * run threw", so the counts have to survive past the console output.
 */
interface SyncOutcome {
  exitCode: number;
  uploaded: number;
  skipped: number;
  removed: number;
  failed: number;
  parseErrors: number;
}

async function runSync(
  config: import('./config/types.js').AppConfig,
  publicationService: PublicationService,
  options: CliOptions,
  syncService?: SyncService,
  label?: string
): Promise<SyncOutcome> {
  const service = syncService ?? buildSyncService(config, publicationService, options);
  if (!service) {
    return { exitCode: 1, uploaded: 0, skipped: 0, removed: 0, failed: 0, parseErrors: 0 };
  }

  console.log(label ? `🔄 ${label}` : '🔄 Starting sync...');
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

  return {
    exitCode: result.failed.length > 0 ? 1 : 0,
    uploaded: result.uploaded.length,
    skipped: result.skipped.length,
    removed: result.removed.length,
    failed: result.failed.length,
    parseErrors: result.parseErrors.length,
  };
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

  // Rules migration only touches the config file, so it runs before any of the
  // vault or Graph setup below.
  if (options.migrateRules) {
    const { migrateRulesFile } = await import('./cli/migrateRules.js');
    const target = configPath ?? path.resolve(config.rulesConfig);
    return migrateRulesFile(target, { confirm: options.yes });
  }

  if (options.explain !== undefined) {
    const { explainFile } = await import('./cli/explain.js');
    const rulesPath = configPath ?? config.rulesConfig;
    const { exitCode, output } = await explainFile(options.explain, {
      vaultPath: config.vaultPath,
      rulesPath: rulesPath && fs.existsSync(rulesPath) ? rulesPath : undefined,
      json: options.explainJson,
      // Rule-loading chatter would be interleaved with the trace, and with
      // --explain-json it would corrupt the JSON on stdout.
      logLevel: config.logLevel === 'debug' ? 'debug' : 'warn',
    });
    console.log(output);
    return exitCode;
  }

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

  // A schedule keeps the process alive exactly like --watch does.
  const scheduleConfig = options.schedule
    ? { ...config.schedule, spec: options.schedule }
    : config.schedule;
  const webEnabled = options.web || config.webEnabled;
  const webPort = options.webPort ?? config.webPort;
  const longRunning = options.watch || webEnabled || scheduleConfig !== undefined;

  // One-shot sync mode (nothing keeping the process alive afterwards)
  if (options.sync && !longRunning) {
    return (await runSync(config, publicationService, options)).exitCode;
  }

  // Watch and schedule modes optionally upload; without --sync they only
  // evaluate rules.
  let syncService: SyncService | null = null;
  const clientId = config.clientId ?? process.env.GRAPH_CLIENT_ID;
  const tenantId = config.tenantId ?? process.env.GRAPH_TENANT_ID ?? 'common';
  const authProvider = clientId ? new GraphAuthProvider({ clientId, tenantId }) : undefined;
  if (options.sync) {
    if (!authProvider) {
      console.error('❌ Sync requires a Graph API client ID.');
      console.error('   Set GRAPH_CLIENT_ID or add "clientId" to your config.json.');
      return 1;
    }
    syncService = buildSyncService(config, publicationService, options, authProvider);

    // With a schedule, the first run is the scheduler's job — running one here
    // too would sync the whole vault twice on startup. With the web UI
    // enabled, the initial sync instead runs through the coordinator further
    // below so the server can start immediately and stream its progress
    // over SSE, rather than blocking startup until it finishes.
    if (!scheduleConfig && !webEnabled) {
      const { exitCode } = await runSync(
        config,
        publicationService,
        options,
        syncService ?? undefined
      );
      if (exitCode !== 0) return exitCode;
      console.log('');
    }
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
      events?.publish({
        type: 'file-evaluated',
        timestamp: new Date().toISOString(),
        filepath: relativePath,
        action: result.action,
        ...(result.error ? { error: result.error } : {}),
      });
      if (result.action === 'failed') {
        console.error(`❌ ${relativePath} - sync failed: ${result.error}`);
      }
      return;
    }
    const result = await publicationService.evaluateFile(
      relativePath,
      fs.readFileSync(filepath, 'utf-8')
    );
    const icon = result.parseError ? '⚠️' : result.eligible ? '✅' : '⛔';
    events?.publish({
      type: 'file-evaluated',
      timestamp: new Date().toISOString(),
      filepath: relativePath,
      action: result.parseError ? 'parse-error' : result.eligible ? 'eligible' : 'ineligible',
      eligible: result.eligible,
      reason: result.reason,
      parseError: Boolean(result.parseError),
    });
    console.log(`${icon} ${relativePath} - ${result.reason}`);
  };
  if (options.watch) {
    console.log(`📂 Monitoring vault: ${config.vaultPath}`);
    if (syncService) {
      console.log(`   Uploading changes to OneDrive:/${config.oneDriveFolder}`);
    } else {
      console.log('   Evaluate-only (add --sync to upload changes)');
    }
  }

  if (options.dryRun && !scheduleConfig) {
    const files = walkMarkdown(config.vaultPath, { ignorePatterns: config.ignorePatterns });
    console.log(`Scanning ${files.length} markdown files...\n`);
    for (const file of files) await evaluate(file);
    return 0;
  }

  let failureLimitReached = false;
  let runNumber = 0;
  const events = new WebEventStream();
  const coordinator = new SyncCoordinator({
    processFile: evaluate,
    logger: {
      info: (message) => console.log(message),
      error: (message) => console.error(message),
    },
  });

  if (options.watch) {
    watcher.on('add', (e) => coordinator.handleFile(e.filepath));
    watcher.on('modify', (e) => coordinator.handleFile(e.filepath));
    // Deletions matter only when uploading; evaluate-only mode cannot read the file.
    if (syncService) {
      watcher.on('delete', (e) => coordinator.handleFile(e.filepath));
    }
    await watcher.watch(config.vaultPath);
  }

  // Resolved once the shutdown handler exists; the scheduler is built first
  // because the handler needs to stop it.
  let requestShutdown: ((signal: string) => void) | undefined;
  // The breaker can trip before the handler is wired, while the health server
  // is still starting. Remember it rather than dropping it on the floor.
  let pendingShutdownSignal: string | undefined;

  let scheduler: Scheduler | undefined;
  let syncRuns: SyncRunManager | undefined;
  if (scheduleConfig && syncService) {
    const history = new ScheduleHistoryStore();
    console.log(`🗂️  Run history: ${history.getFilePath()}`);

    scheduler = new Scheduler({
      ...scheduleConfig,
      // Skipped ticks are logged but not persisted: a schedule shorter than
      // its own sync would otherwise fill all 50 history slots with skips and
      // hide the runs someone actually wants to look at.
      onRun: (run) => {
        if (run.status !== 'skipped') history.record(run);
      },
      task: async (signal) => {
        if (!syncRuns) {
          throw new Error('Sync run manager is not configured');
        }
        return syncRuns.executeScheduledRun(signal);
      },
      // A repeatedly failing sync is usually expired credentials or a dead
      // network. Exiting lets the supervisor (systemd, Docker) restart or
      // alert, which is more useful than looping on the same error forever.
      onFailureLimit: () => {
        console.error('❌ Stopping: the scheduled sync failed too many times in a row');
        failureLimitReached = true;
        if (requestShutdown) requestShutdown('failure limit');
        else pendingShutdownSignal = 'failure limit';
      },
    });
  } else if (scheduleConfig) {
    console.warn(
      '⚠️  A schedule is configured but --sync is not enabled; nothing will be uploaded'
    );
  }

  if (syncService) {
    syncRuns = new SyncRunManager({
      coordinator,
      events,
      scheduler,
      defaults: {
        dryRun: options.dryRun,
        force: options.forceSync,
      },
      executeSync: async ({ dryRun, force, source, onProgress }): Promise<SyncRunSummary> => {
        runNumber += source === 'schedule' ? 1 : 0;
        const label =
          source === 'schedule'
            ? `Scheduled sync #${runNumber}...`
            : source === 'startup'
              ? 'Startup sync...'
              : 'Web-triggered sync...';
        const log = (message: string) => {
          console.log(message);
          onProgress(message);
        };

        log(`🔄 ${label}`);
        log(`   Vault: ${config.vaultPath}`);
        log(`   Target: OneDrive:/${config.oneDriveFolder}`);
        if (dryRun) log('   Mode: DRY RUN (no uploads)');
        if (force) log('   Mode: FORCE (re-upload all)');
        log('');

        try {
          const result = await syncService.syncWithOverrides({ dryRun, forceSync: force }, log);

          log('');
          log('────────────────────────────────────────');
          log('Sync complete:');
          log(`  ⬆️  Uploaded: ${result.uploaded.length}`);
          log(`  ⏭️  Skipped (unchanged): ${result.skipped.length}`);
          log(`  🗑️  Removed: ${result.removed.length}`);
          if (result.parseErrors.length > 0) {
            log(`  ⚠️  Skipped (frontmatter parse errors): ${result.parseErrors.length}`);
            for (const parseError of result.parseErrors) {
              log(`     ${parseError.filepath}: ${parseError.reason}`);
            }
          }
          if (result.failed.length > 0) {
            log(`  ❌ Failed: ${result.failed.length}`);
            for (const failure of result.failed) {
              log(`     ${failure.filepath}: ${failure.error}`);
            }
          }
          log(`  ⏱️  Duration: ${(result.duration / 1000).toFixed(1)}s`);

          return {
            uploaded: result.uploaded.length,
            skipped: result.skipped.length,
            removed: result.removed.length,
            failed: result.failed.length,
            parseErrors: result.parseErrors.length,
            totalEligible: result.totalEligible,
            durationMs: result.duration,
          };
        } catch (error) {
          throw new Error(describeRunError(error));
        }
      },
    });
  }

  // With the web UI enabled and no schedule, the initial sync runs here
  // instead of blocking before the server starts, so the web UI is
  // reachable — and can show live progress via SSE — immediately.
  let initialSyncFailed = false;
  if (syncService && !scheduleConfig && webEnabled && syncRuns) {
    const { record, completion } = syncRuns.runStartupSync({
      dryRun: options.dryRun,
      force: options.forceSync,
    });
    console.log(`🔄 Starting sync in the background (run ${record.runId})...`);
    console.log('');
    completion.catch((error) => {
      initialSyncFailed = true;
      console.error(
        `❌ Startup sync failed: ${error instanceof Error ? error.message : String(error)}`
      );
    });
  }

  scheduler?.start();

  const healthStatus = () => ({
    watcherActive: watcher.isWatching(),
    lastFileProcessedAt: coordinator.getLastFileProcessedAt(),
    ...(scheduler ? { schedule: scheduler.getStatus() } : {}),
  });

  const server = webEnabled
    ? new WebServer({
        port: webPort,
        bindAddress: config.webBindAddress,
        token: config.webUiToken,
        readOnly: config.webUiReadOnly,
        vaultPath: config.vaultPath,
        rulesConfigPath: rulesPath,
        ignorePatterns: config.ignorePatterns,
        publicationService,
        ...(syncService ? { syncService } : {}),
        ...(authProvider ? { authProvider } : {}),
        ...(scheduler ? { scheduler } : {}),
        events,
        ...(syncRuns ? { syncRuns } : {}),
        syncCoordinator: coordinator,
        healthStatus,
      })
    : new HealthServer(healthStatus, config.healthPort);

  await server.start();
  console.log(`❤️  Health probe: http://localhost:${server.getPort()}/healthz`);
  if (webEnabled) {
    console.log(`🌐 Web UI: http://${config.webBindAddress}:${server.getPort()}/`);
  }

  return await new Promise<number>((resolve) => {
    const shutdownHandler = createGracefulShutdown(
      watcher,
      coordinator.getPending(),
      {
        info: (message) => console.log(`\n${message}`),
        error: (message) => console.error(message),
      },
      server,
      scheduler
    );
    const shutdown = async (signal: string): Promise<void> => {
      const code = await shutdownHandler(signal);
      resolve((failureLimitReached || initialSyncFailed) && code === 0 ? 1 : code);
    };
    requestShutdown = (signal: string): void => void shutdown(signal);
    if (pendingShutdownSignal) requestShutdown(pendingShutdownSignal);

    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
