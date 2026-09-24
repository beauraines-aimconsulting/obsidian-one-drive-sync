import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as dotenv from 'dotenv';
import type { AppConfig } from './types.js';
import type { ScheduleConfig } from '../schedule/types.js';
import { parseDuration } from '../utils/duration.js';

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
  webEnabled: false,
  webBindAddress: '127.0.0.1',
  webUiReadOnly: false,
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
  ],
  extraIgnorePatterns: [],
};

/** The convention `WATCH_USE_POLLING` already established. */
function parseBoolean(value: string): boolean {
  return ['1', 'true', 'yes'].includes(value.trim().toLowerCase());
}

/**
 * Compose passes unset variables through as empty strings, so an empty value
 * has to mean "not set" rather than "zero" or "false".
 */
function envValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseOptionalBoolean(
  value: string | undefined,
  fileValue: boolean | undefined
): boolean | undefined {
  const fromEnv = envValue(value);
  if (fromEnv !== undefined) return parseBoolean(fromEnv);
  return fileValue;
}

function parsePatternList(value: string): string[] {
  return value
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export type EnvSource = Record<string, string | undefined>;
export type ConfigValueSource = 'default' | 'file' | 'env';
export type AppConfigSources = Partial<Record<keyof AppConfig, ConfigValueSource>>;

export interface ConfigManagerOptions {
  /** Directory used to resolve `.env`, `.env.local` and relative config paths. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Environment source to read from (and for dotenv to write into). Defaults to `process.env`. */
  env?: EnvSource;
  /** Set to false to skip reading `.env` files from disk entirely. Defaults to true. */
  loadDotenv?: boolean;
}

export interface LoadedConfig {
  config: AppConfig;
  sources: AppConfigSources;
}

function resolveValue<T>(
  defaultValue: T,
  fileValue: T | undefined,
  envResolvedValue: T | undefined
): { value: T; source: ConfigValueSource } {
  if (envResolvedValue !== undefined) return { value: envResolvedValue, source: 'env' };
  if (fileValue !== undefined) return { value: fileValue, source: 'file' };
  return { value: defaultValue, source: 'default' };
}

function resolveOptionalValue<T>(
  fileValue: T | undefined,
  envResolvedValue: T | undefined
): { value: T | undefined; source?: ConfigValueSource } {
  if (envResolvedValue !== undefined) return { value: envResolvedValue, source: 'env' };
  if (fileValue !== undefined) return { value: fileValue, source: 'file' };
  return { value: undefined };
}

function resolveInteger(
  name: string,
  defaultValue: number,
  fileValue: number | undefined,
  envRawValue: string | undefined,
  validate: (value: number) => boolean,
  message: string
): { value: number; source: ConfigValueSource } {
  const envResolvedValue = envRawValue !== undefined ? Number(envRawValue) : undefined;
  const resolved = resolveValue(defaultValue, fileValue, envResolvedValue);

  if (!Number.isInteger(resolved.value) || !validate(resolved.value)) {
    throw new Error(message.replace('{name}', name));
  }

  return resolved;
}

function resolveSchedule(
  env: EnvSource,
  fromFile: ScheduleConfig | undefined
): { value: ScheduleConfig | undefined; source?: ConfigValueSource } {
  const specSource =
    envValue(env.SYNC_SCHEDULE) !== undefined ? 'env' : fromFile?.spec ? 'file' : undefined;
  const spec = env.SYNC_SCHEDULE?.trim() || fromFile?.spec;
  if (!spec) return { value: undefined };

  try {
    parseDuration(spec);
  } catch (error) {
    throw new Error(
      `SYNC_SCHEDULE is not a valid interval: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const maxFailuresValue =
    envValue(env.SYNC_SCHEDULE_MAX_FAILURES) ?? fromFile?.maxConsecutiveFailures;
  const maxConsecutiveFailures =
    maxFailuresValue === undefined ? undefined : Number(maxFailuresValue);
  if (
    maxConsecutiveFailures !== undefined &&
    (!Number.isInteger(maxConsecutiveFailures) || maxConsecutiveFailures < 0)
  ) {
    throw new Error('SYNC_SCHEDULE_MAX_FAILURES must be a non-negative integer');
  }

  const jitterValue = envValue(env.SYNC_SCHEDULE_JITTER_MS) ?? fromFile?.jitterMs;
  const jitterMs = jitterValue === undefined ? undefined : Number(jitterValue);
  if (jitterMs !== undefined && (!Number.isInteger(jitterMs) || jitterMs < 0)) {
    throw new Error('SYNC_SCHEDULE_JITTER_MS must be a non-negative integer (milliseconds)');
  }

  const runOnStart = parseOptionalBoolean(env.SYNC_SCHEDULE_RUN_ON_START, fromFile?.runOnStart);
  const skipIfRunning = parseOptionalBoolean(
    env.SYNC_SCHEDULE_SKIP_IF_RUNNING,
    fromFile?.skipIfRunning
  );

  return {
    value: {
      spec,
      ...(runOnStart !== undefined ? { runOnStart } : {}),
      ...(skipIfRunning !== undefined ? { skipIfRunning } : {}),
      ...(jitterMs !== undefined ? { jitterMs } : {}),
      ...(maxConsecutiveFailures !== undefined ? { maxConsecutiveFailures } : {}),
    },
    source: specSource,
  };
}

export class ConfigManager {
  private config: AppConfig | null = null;
  private sources: AppConfigSources = {};
  private readonly options: ConfigManagerOptions;

  constructor(options: ConfigManagerOptions = {}) {
    this.options = options;
  }

  async load(): Promise<AppConfig> {
    return (await this.loadDetailed()).config;
  }

  async loadDetailed(): Promise<LoadedConfig> {
    if (this.config) {
      return { config: this.config, sources: { ...this.sources } };
    }

    const cwd = this.options.cwd ?? process.cwd();
    const env: EnvSource = this.options.env ?? process.env;

    if (this.options.loadDotenv ?? true) {
      const envPath = path.join(cwd, '.env');
      if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath, processEnv: env as dotenv.DotenvPopulateInput });
      }

      const envLocalPath = path.join(cwd, '.env.local');
      if (fs.existsSync(envLocalPath)) {
        dotenv.config({
          path: envLocalPath,
          processEnv: env as dotenv.DotenvPopulateInput,
        });
      }
    }

    let configFromFile: Partial<AppConfig> = {};
    const rulesConfigSetting = env.RULES_CONFIG || DEFAULT_CONFIG.rulesConfig;
    const rulesConfigPath = rulesConfigSetting
      ? path.resolve(cwd, expandTilde(rulesConfigSetting))
      : undefined;
    if (rulesConfigPath && fs.existsSync(rulesConfigPath)) {
      try {
        const content = fs.readFileSync(rulesConfigPath, 'utf-8');
        const parsed = JSON.parse(content) as { config?: Partial<AppConfig> };
        configFromFile = parsed.config || {};
      } catch (err) {
        console.warn(`Failed to load config from ${rulesConfigPath}:`, err);
      }
    }

    const sources: AppConfigSources = {};

    const vaultPath = resolveOptionalValue(configFromFile.vaultPath, envValue(env.VAULT_PATH));
    if (!vaultPath.value) {
      throw new Error('VAULT_PATH is required (set via env var or config file)');
    }
    sources.vaultPath = vaultPath.source ?? 'file';

    const outputPath = resolveOptionalValue(configFromFile.outputPath, envValue(env.OUTPUT_PATH));
    if (!outputPath.value) {
      throw new Error('OUTPUT_PATH is required (set via env var or config file)');
    }
    sources.outputPath = outputPath.source ?? 'file';

    const rulesConfig = resolveValue(
      DEFAULT_CONFIG.rulesConfig ?? './config/rules.json',
      configFromFile.rulesConfig,
      envValue(env.RULES_CONFIG)
    );
    sources.rulesConfig = rulesConfig.source;

    const oneDriveFolder = resolveValue(
      DEFAULT_CONFIG.oneDriveFolder ?? 'ObsidianPublished',
      configFromFile.oneDriveFolder,
      envValue(env.ONEDRIVE_FOLDER)
    );
    sources.oneDriveFolder = oneDriveFolder.source;

    const logLevel = resolveValue(
      DEFAULT_CONFIG.logLevel ?? 'info',
      configFromFile.logLevel,
      envValue(env.LOG_LEVEL) as AppConfig['logLevel'] | undefined
    );
    sources.logLevel = logLevel.source;

    const debounceDelay = resolveInteger(
      'DEBOUNCE_DELAY',
      DEFAULT_CONFIG.debounceDelay ?? 300,
      configFromFile.debounceDelay,
      envValue(env.DEBOUNCE_DELAY),
      (value) => value >= 0,
      '{name} must be a non-negative integer'
    );
    sources.debounceDelay = debounceDelay.source;

    const healthPort = resolveInteger(
      'HEALTH_PORT',
      DEFAULT_CONFIG.healthPort ?? 8080,
      configFromFile.healthPort,
      envValue(env.HEALTH_PORT),
      (value) => value >= 1 && value <= 65535,
      '{name} must be an integer between 1 and 65535'
    );
    sources.healthPort = healthPort.source;

    const webEnabled = resolveValue(
      DEFAULT_CONFIG.webEnabled ?? false,
      configFromFile.webEnabled,
      parseOptionalBoolean(env.WEB_UI_ENABLED, undefined)
    );
    sources.webEnabled = webEnabled.source;

    const webPortFromEnv = envValue(env.WEB_PORT);
    const webPort =
      webPortFromEnv !== undefined || configFromFile.webPort !== undefined
        ? resolveInteger(
            'WEB_PORT',
            healthPort.value,
            configFromFile.webPort,
            webPortFromEnv,
            (value) => value >= 1 && value <= 65535,
            '{name} must be an integer between 1 and 65535'
          )
        : { value: healthPort.value, source: healthPort.source };
    sources.webPort = webPort.source;

    const webBindAddress = resolveValue(
      DEFAULT_CONFIG.webBindAddress ?? '127.0.0.1',
      configFromFile.webBindAddress,
      envValue(env.WEB_BIND_ADDRESS)
    );
    sources.webBindAddress = webBindAddress.source;

    const webUiToken = resolveOptionalValue(configFromFile.webUiToken, envValue(env.WEB_UI_TOKEN));
    if (webUiToken.source) sources.webUiToken = webUiToken.source;

    const webUiReadOnly = resolveValue(
      DEFAULT_CONFIG.webUiReadOnly ?? false,
      configFromFile.webUiReadOnly,
      parseOptionalBoolean(env.WEB_UI_READONLY, undefined)
    );
    sources.webUiReadOnly = webUiReadOnly.source;

    const usePolling = resolveValue(
      DEFAULT_CONFIG.usePolling ?? false,
      configFromFile.usePolling,
      parseOptionalBoolean(env.WATCH_USE_POLLING, undefined)
    );
    sources.usePolling = usePolling.source;

    const pollInterval = resolveInteger(
      'WATCH_POLL_INTERVAL',
      DEFAULT_CONFIG.pollInterval ?? 1000,
      configFromFile.pollInterval,
      envValue(env.WATCH_POLL_INTERVAL),
      (value) => value >= 1,
      '{name} must be a positive integer (milliseconds)'
    );
    sources.pollInterval = pollInterval.source;

    const schedule = resolveSchedule(env, configFromFile.schedule);
    if (schedule.source) sources.schedule = schedule.source;

    const basePatterns = env.IGNORE_PATTERNS
      ? parsePatternList(env.IGNORE_PATTERNS)
      : (configFromFile.ignorePatterns ?? DEFAULT_CONFIG.ignorePatterns ?? []);
    const extraPatterns = [
      ...(configFromFile.extraIgnorePatterns ?? []),
      ...(env.EXTRA_IGNORE_PATTERNS ? parsePatternList(env.EXTRA_IGNORE_PATTERNS) : []),
    ];

    if (env.IGNORE_PATTERNS || configFromFile.ignorePatterns) {
      const dropped = (DEFAULT_CONFIG.ignorePatterns ?? []).filter(
        (pattern) => !basePatterns.includes(pattern) && !extraPatterns.includes(pattern)
      );
      if (dropped.length > 0) {
        console.warn(
          `ignorePatterns replaces the defaults rather than adding to them; these defaults are no longer applied: ${dropped.join(', ')}. ` +
            'Use extraIgnorePatterns / EXTRA_IGNORE_PATTERNS to add patterns while keeping the defaults.'
        );
      }
    }

    sources.ignorePatterns =
      env.IGNORE_PATTERNS || env.EXTRA_IGNORE_PATTERNS
        ? 'env'
        : configFromFile.ignorePatterns || configFromFile.extraIgnorePatterns
          ? 'file'
          : 'default';
    sources.extraIgnorePatterns =
      env.EXTRA_IGNORE_PATTERNS !== undefined
        ? 'env'
        : configFromFile.extraIgnorePatterns
          ? 'file'
          : 'default';

    const clientId = resolveOptionalValue(configFromFile.clientId, envValue(env.GRAPH_CLIENT_ID));
    if (clientId.source) sources.clientId = clientId.source;

    const tenantId = resolveOptionalValue(configFromFile.tenantId, envValue(env.GRAPH_TENANT_ID));
    if (tenantId.source) sources.tenantId = tenantId.source;

    const merged: AppConfig = {
      vaultPath: expandTilde(vaultPath.value),
      outputPath: expandTilde(outputPath.value),
      rulesConfig: rulesConfig.value,
      oneDriveFolder: oneDriveFolder.value,
      logLevel: logLevel.value,
      debounceDelay: debounceDelay.value,
      healthPort: healthPort.value,
      webEnabled: webEnabled.value,
      webPort: webPort.value,
      webBindAddress: webBindAddress.value,
      webUiToken: webUiToken.value,
      webUiReadOnly: webUiReadOnly.value,
      usePolling: usePolling.value,
      pollInterval: pollInterval.value,
      ignorePatterns: [...new Set([...basePatterns, ...extraPatterns])],
      extraIgnorePatterns: extraPatterns,
      clientId: clientId.value,
      tenantId: tenantId.value,
      ...(schedule.value ? { schedule: schedule.value } : {}),
    };

    this.config = merged;
    this.sources = sources;
    return { config: this.config, sources: { ...this.sources } };
  }

  getConfig(): AppConfig {
    if (!this.config) {
      throw new Error('Config not loaded. Call load() first or use loadAndGet()');
    }
    return this.config;
  }

  getSources(): AppConfigSources {
    if (!this.config) {
      throw new Error('Config not loaded. Call load() first or use loadAndGet()');
    }
    return { ...this.sources };
  }

  async loadAndGet(): Promise<AppConfig> {
    return this.load();
  }

  reload(): Promise<AppConfig> {
    this.config = null;
    this.sources = {};
    return this.load();
  }
}

export const configManager = new ConfigManager();
