import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as dotenv from 'dotenv';
import type { AppConfig } from './types.js';

function expandTilde(filepath: string): string {
  if (filepath.startsWith('~/')) {
    return path.join(os.homedir(), filepath.slice(2));
  }
  return filepath;
}

const DEFAULT_CONFIG: Partial<AppConfig> = {
  logLevel: 'info',
  debounceDelay: 300,
  healthPort: 8080,
  usePolling: false,
  pollInterval: 1000,
  rulesConfig: './config/rules.json',
  oneDriveFolder: 'ObsidianPublished',
  ignorePatterns: [
    '.git/**',
    '.obsidian/**',
    '.trash/**',
    'node_modules/**',
    'Templates/**',
    '.DS_Store',
    '*.bookmark.md',
    '**/*.bookmark.md',
  ],
};

export type EnvSource = Record<string, string | undefined>;

export interface ConfigManagerOptions {
  /** Directory used to resolve `.env`, `.env.local` and relative config paths. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Environment source to read from (and for dotenv to write into). Defaults to `process.env`. */
  env?: EnvSource;
  /** Set to false to skip reading `.env` files from disk entirely. Defaults to true. */
  loadDotenv?: boolean;
}

export class ConfigManager {
  private config: AppConfig | null = null;
  private readonly options: ConfigManagerOptions;

  constructor(options: ConfigManagerOptions = {}) {
    this.options = options;
  }

  async load(): Promise<AppConfig> {
    if (this.config) {
      return this.config;
    }

    const cwd = this.options.cwd ?? process.cwd();
    const env: EnvSource = this.options.env ?? process.env;

    if (this.options.loadDotenv ?? true) {
      // Load environment variables from .env file
      const envPath = path.join(cwd, '.env');
      if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath, processEnv: env as dotenv.DotenvPopulateInput });
      }

      // Load .env.local if it exists (fills in anything .env did not set)
      const envLocalPath = path.join(cwd, '.env.local');
      if (fs.existsSync(envLocalPath)) {
        dotenv.config({
          path: envLocalPath,
          processEnv: env as dotenv.DotenvPopulateInput,
        });
      }
    }

    // Try to load from config file
    let configFromFile: Partial<AppConfig> = {};
    const rulesConfigSetting = env.RULES_CONFIG || DEFAULT_CONFIG.rulesConfig;
    const rulesConfigPath = rulesConfigSetting
      ? path.resolve(cwd, expandTilde(rulesConfigSetting))
      : undefined;
    if (rulesConfigPath && fs.existsSync(rulesConfigPath)) {
      try {
        const content = fs.readFileSync(rulesConfigPath, 'utf-8');
        const parsed = JSON.parse(content);
        configFromFile = parsed.config || {};
      } catch (err) {
        console.warn(`Failed to load config from ${rulesConfigPath}:`, err);
      }
    }

    // Merge sources: defaults < file < env vars
    const debounceDelayValue =
      env.DEBOUNCE_DELAY ||
      (configFromFile.debounceDelay !== undefined
        ? String(configFromFile.debounceDelay)
        : undefined) ||
      String(DEFAULT_CONFIG.debounceDelay);
    const healthPortValue =
      env.HEALTH_PORT ||
      (configFromFile.healthPort !== undefined ? String(configFromFile.healthPort) : undefined) ||
      String(DEFAULT_CONFIG.healthPort);
    const pollIntervalValue =
      env.WATCH_POLL_INTERVAL ||
      (configFromFile.pollInterval !== undefined
        ? String(configFromFile.pollInterval)
        : undefined) ||
      String(DEFAULT_CONFIG.pollInterval);
    const usePolling =
      env.WATCH_USE_POLLING !== undefined
        ? ['1', 'true', 'yes'].includes(env.WATCH_USE_POLLING.trim().toLowerCase())
        : (configFromFile.usePolling ?? DEFAULT_CONFIG.usePolling ?? false);

    const merged = {
      ...DEFAULT_CONFIG,
      ...configFromFile,
      vaultPath:
        env.VAULT_PATH ||
        configFromFile.vaultPath ||
        DEFAULT_CONFIG.vaultPath,
      outputPath:
        env.OUTPUT_PATH ||
        configFromFile.outputPath ||
        DEFAULT_CONFIG.outputPath,
      rulesConfig:
        env.RULES_CONFIG ||
        configFromFile.rulesConfig ||
        DEFAULT_CONFIG.rulesConfig,
      oneDriveFolder:
        env.ONEDRIVE_FOLDER ||
        configFromFile.oneDriveFolder ||
        DEFAULT_CONFIG.oneDriveFolder,
      logLevel: (env.LOG_LEVEL ||
        configFromFile.logLevel ||
        DEFAULT_CONFIG.logLevel) as 'debug' | 'info' | 'warn' | 'error',
      debounceDelay: parseInt(debounceDelayValue, 10),
      healthPort: parseInt(healthPortValue, 10),
      usePolling,
      pollInterval: parseInt(pollIntervalValue, 10),
    };

    // Validate required fields
    if (!merged.vaultPath) {
      throw new Error('VAULT_PATH is required (set via env var or config file)');
    }
    if (!merged.outputPath) {
      throw new Error('OUTPUT_PATH is required (set via env var or config file)');
    }
    if (!Number.isInteger(merged.healthPort) || merged.healthPort < 1 || merged.healthPort > 65535) {
      throw new Error('HEALTH_PORT must be an integer between 1 and 65535');
    }
    if (!Number.isInteger(merged.pollInterval) || merged.pollInterval < 1) {
      throw new Error('WATCH_POLL_INTERVAL must be a positive integer (milliseconds)');
    }

    // Expand ~ in paths
    merged.vaultPath = expandTilde(merged.vaultPath);
    merged.outputPath = expandTilde(merged.outputPath);

    // Parse ignore patterns if provided as env string
    if (env.IGNORE_PATTERNS) {
      merged.ignorePatterns = env.IGNORE_PATTERNS.split(',').map((p) =>
        p.trim()
      );
    }

    // Graph API config (optional)
    merged.clientId =
      env.GRAPH_CLIENT_ID || configFromFile.clientId || undefined;
    merged.tenantId =
      env.GRAPH_TENANT_ID || configFromFile.tenantId || undefined;

    this.config = merged as AppConfig;
    return this.config;
  }

  getConfig(): AppConfig {
    if (!this.config) {
      throw new Error(
        'Config not loaded. Call load() first or use loadAndGet()'
      );
    }
    return this.config;
  }

  async loadAndGet(): Promise<AppConfig> {
    return this.load();
  }

  reload(): Promise<AppConfig> {
    this.config = null;
    return this.load();
  }
}

export const configManager = new ConfigManager();
