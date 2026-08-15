export interface FilterOptions {
  patterns: string[];
  extensions: string[];
}

export interface FileFilterResult {
  allowed: boolean;
  reason?: string;
}
