import type { ScheduleConfig } from '../schedule/types.js';

export interface AppConfig {
  vaultPath: string;
  outputPath: string;
  rulesConfig: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  debounceDelay: number;
  ignorePatterns?: string[];
  /** Patterns appended to `ignorePatterns` instead of replacing them. */
  extraIgnorePatterns?: string[];
  clientId?: string;
  tenantId?: string;
  oneDriveFolder: string;
  healthPort: number;
  webEnabled: boolean;
  webPort: number;
  webBindAddress: string;
  webUiToken?: string;
  webUiReadOnly: boolean;
  usePolling: boolean;
  pollInterval: number;
  /** Periodic full sync. Absent when scheduling is off. */
  schedule?: ScheduleConfig;
}
