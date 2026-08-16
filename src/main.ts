import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from './config/ConfigManager.js';
import { PublicationService } from './publications/PublicationService.js';
import { VaultWatcher } from './vault/VaultWatcher.js';
import type { CliOptions } from './cli/types.js';

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: false, help: false, configPath: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') options.help = true;
    else if (argv[i] === '--dry-run') options.dryRun = true;
    else if (argv[i] === '--config') options.configPath = argv[++i];
  }
  return options;
}

export function usage(): string {
  return `Usage: obsidian-one-drive-sync [options]\n\nOptions:\n  --config <path>  Path to config.json\n  --dry-run        Scan once and exit\n  --help           Show help`;
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

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (options.configPath) process.env.RULES_CONFIG = path.resolve(options.configPath);
  const config = await new ConfigManager().load();
  if (!fs.existsSync(config.vaultPath)) throw new Error(`Invalid vault path: ${config.vaultPath}`);
  const publicationService = new PublicationService({ logLevel: config.logLevel });
  const watcher = new VaultWatcher({ debounceDelay: config.debounceDelay, ignorePatterns: config.ignorePatterns });
  const evaluate = async (filepath: string) => {
    const result = await publicationService.evaluateFile(filepath, fs.readFileSync(filepath, 'utf-8'));
    console.log(`${result.eligible ? '✅' : '⛔'} ${path.relative(config.vaultPath, filepath)} - ${result.reason}`);
  };
  console.log(`Monitoring vault: ${config.vaultPath}`);
  if (options.dryRun) {
    for (const file of await walkMarkdown(config.vaultPath)) await evaluate(file);
    return 0;
  }
  watcher.on('add', (e) => void evaluate(e.filepath));
  watcher.on('modify', (e) => void evaluate(e.filepath));
  await watcher.watch(config.vaultPath);
  const shutdown = async (signal: string) => {
    console.log(`Shutting down on ${signal}`);
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
