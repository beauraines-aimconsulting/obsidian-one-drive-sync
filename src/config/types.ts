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
  usePolling: boolean;
  pollInterval: number;
}
