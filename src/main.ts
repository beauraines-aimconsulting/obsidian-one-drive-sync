import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from './config/ConfigManager.js';
import { PublicationService } from './publications/PublicationService.js';
import { VaultWatcher } from './vault/VaultWatcher.js';
import { GraphAuthProvider } from './graph/GraphAuthProvider.js';
import { GraphProbe } from './graph/GraphProbe.js';
import type { CliOptions } from './cli/types.js';

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: false, help: false, probe: false, configPath: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') options.help = true;
    else if (argv[i] === '--dry-run') options.dryRun = true;
    else if (argv[i] === '--probe') options.probe = true;
    else if (argv[i] === '--config') options.configPath = argv[++i];
  }
  return options;
}

export function usage(): string {
  return `Usage: obsidian-one-drive-sync [options]\n\nOptions:\n  --config <path>  Path to config.json\n  --dry-run        Scan once and exit\n  --probe          Test Graph API connectivity and permissions\n  --help           Show help`;
}

async function walkMarkdown(dir: string): Promise<string[]> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walkMarkdown(full)));
    else if (entry.isFile() && full.endsWith('.md')) files.push(full);
  }
  return files;
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

  if (!fs.existsSync(config.vaultPath)) throw new Error(`Invalid vault path: ${config.vaultPath}`);
  const publicationService = new PublicationService({ logLevel: config.logLevel });

  // Load rules from config file
  const rulesPath = configPath ?? config.rulesConfig;
  if (rulesPath && fs.existsSync(rulesPath)) {
    await publicationService.reloadRules(rulesPath);
  } else if (configPath) {
    throw new Error(`Config file not found: ${configPath}`);
  } else {
    console.warn('⚠️  No rules config found — all files will pass (no rules configured)');
  }

  const watcher = new VaultWatcher({ debounceDelay: config.debounceDelay, ignorePatterns: config.ignorePatterns });
  const evaluate = async (filepath: string) => {
    const relativePath = path.relative(config.vaultPath, filepath);
    const result = await publicationService.evaluateFile(relativePath, fs.readFileSync(filepath, 'utf-8'));
    console.log(`${result.eligible ? '✅' : '⛔'} ${relativePath} - ${result.reason}`);
  };
  console.log(`📂 Monitoring vault: ${config.vaultPath}`);
  if (options.dryRun) {
    const files = await walkMarkdown(config.vaultPath);
    console.log(`Scanning ${files.length} markdown files...\n`);
    for (const file of files) await evaluate(file);
    return 0;
  }
  watcher.on('add', (e) => void evaluate(e.filepath));
  watcher.on('modify', (e) => void evaluate(e.filepath));
  await watcher.watch(config.vaultPath);
  const shutdown = async (signal: string) => {
    console.log(`\nShutting down on ${signal}`);
    await watcher.unwatch().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  return await new Promise(() => {});
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
