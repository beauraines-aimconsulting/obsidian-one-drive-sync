import { ConfigManager, type AppConfigSources } from '../../config/ConfigManager.js';
import type { AppConfig } from '../../config/types.js';
import type { RouteHandler } from '../types.js';
import { sendApiJson } from '../security.js';

function maskSecret(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length <= 4) return '*'.repeat(value.length);
  return `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;
}

function sourceOf<K extends keyof AppConfig>(sources: AppConfigSources, key: K): string {
  return sources[key] ?? 'default';
}

export const getConfig: RouteHandler = async (_request, response) => {
  const manager = new ConfigManager();
  const { config, sources } = await manager.loadDetailed();

  sendApiJson(response, 200, {
    config: {
      vaultPath: config.vaultPath,
      outputPath: config.outputPath,
      rulesConfig: config.rulesConfig,
      oneDriveFolder: config.oneDriveFolder,
      logLevel: config.logLevel,
      debounceDelay: config.debounceDelay,
      ignorePatterns: config.ignorePatterns ?? [],
      extraIgnorePatterns: config.extraIgnorePatterns ?? [],
      clientId: maskSecret(config.clientId),
      tenantId: maskSecret(config.tenantId),
      healthPort: config.healthPort,
      webEnabled: config.webEnabled,
      webPort: config.webPort,
      webBindAddress: config.webBindAddress,
      webUiReadOnly: config.webUiReadOnly,
      usePolling: config.usePolling,
      pollInterval: config.pollInterval,
      ...(config.schedule ? { schedule: config.schedule } : {}),
    },
    sources: {
      vaultPath: sourceOf(sources, 'vaultPath'),
      outputPath: sourceOf(sources, 'outputPath'),
      rulesConfig: sourceOf(sources, 'rulesConfig'),
      oneDriveFolder: sourceOf(sources, 'oneDriveFolder'),
      logLevel: sourceOf(sources, 'logLevel'),
      debounceDelay: sourceOf(sources, 'debounceDelay'),
      ignorePatterns: sourceOf(sources, 'ignorePatterns'),
      extraIgnorePatterns: sourceOf(sources, 'extraIgnorePatterns'),
      clientId: sourceOf(sources, 'clientId'),
      tenantId: sourceOf(sources, 'tenantId'),
      healthPort: sourceOf(sources, 'healthPort'),
      webEnabled: sourceOf(sources, 'webEnabled'),
      webPort: sourceOf(sources, 'webPort'),
      webBindAddress: sourceOf(sources, 'webBindAddress'),
      webUiReadOnly: sourceOf(sources, 'webUiReadOnly'),
      usePolling: sourceOf(sources, 'usePolling'),
      pollInterval: sourceOf(sources, 'pollInterval'),
      schedule: sourceOf(sources, 'schedule'),
    },
  });
};
