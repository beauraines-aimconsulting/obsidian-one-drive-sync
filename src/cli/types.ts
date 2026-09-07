export interface CliOptions {
  configPath?: string;
  dryRun: boolean;
  help: boolean;
  probe: boolean;
  logout: boolean;
  sync: boolean;
  forceSync: boolean;
  watch: boolean;
  /** Rewrite the rules config as rulesVersion 2. */
  migrateRules: boolean;
  /** Confirm a destructive action that otherwise only previews. */
  yes: boolean;
}

export interface CliRunResult {
  exitCode: number;
  message?: string;
}
