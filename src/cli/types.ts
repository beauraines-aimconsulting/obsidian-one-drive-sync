export interface CliOptions {
  configPath?: string;
  dryRun: boolean;
  help: boolean;
}

export interface CliRunResult {
  exitCode: number;
  message?: string;
}
