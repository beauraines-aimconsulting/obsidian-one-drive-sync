export interface FilterOptions {
  patterns: string[];
  extensions: string[];
}

export interface FileFilterResult {
  allowed: boolean;
  reason?: string;
}

export interface VaultWatcherConfig {
  debounceDelay?: number;
  ignorePatterns?: string[];
}

export interface FileEvent {
  type: 'add' | 'modify' | 'delete' | 'rename';
  filepath: string;
  oldFilepath?: string;
  timestamp: number;
}
