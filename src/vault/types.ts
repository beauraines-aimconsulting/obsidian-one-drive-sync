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

export interface FileMetadata {
  filepath: string;
  lastModified: number;
  size: number;
  published: boolean;
}

export interface VaultState {
  lastScanned: number;
  fileCount: number;
  published: number;
  unpublished: number;
}

export interface VaultServiceConfig {
  vaultPath?: string;
  debounceDelay?: number;
  ignorePatterns?: string[];
}
