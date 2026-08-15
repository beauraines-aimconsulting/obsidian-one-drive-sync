export interface AppConfig {
  vaultPath: string;
  outputPath: string;
  rulesConfig: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  debounceDelay: number;
  ignorePatterns?: string[];
}
