export interface CliOptions {
  configPath?: string;
  dryRun: boolean;
  help: boolean;
  probe: boolean;
  logout: boolean;
}

export interface CliRunResult {
  exitCode: number;
  message?: string;
}
