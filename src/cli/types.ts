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
  /** Vault-relative path of a file to evaluate and explain. */
  explain?: string;
  /** Emit the explain result as raw JSON instead of a tree. */
  explainJson: boolean;
  /** Interval spec for a repeating full sync, e.g. `1h`. */
  schedule?: string;
}

export interface CliRunResult {
  exitCode: number;
  message?: string;
}
