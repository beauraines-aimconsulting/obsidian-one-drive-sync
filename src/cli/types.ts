export interface CliOptions {
  configPath?: string;
  dryRun: boolean;
  help: boolean;
  probe: boolean;
  logout: boolean;
  sync: boolean;
  forceSync: boolean;
  watch: boolean;
}

export interface CliRunResult {
  exitCode: number;
  message?: string;
}
