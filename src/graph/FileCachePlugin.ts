/**
 * File-based MSAL token cache plugin.
 * Persists tokens to disk so users don't re-authenticate every run.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ICachePlugin, TokenCacheContext } from '@azure/msal-node';

const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.obsidian-sync');
const DEFAULT_CACHE_FILE = 'token-cache.json';

export class FileCachePlugin implements ICachePlugin {
  private cacheFilePath: string;

  constructor(cacheDir?: string) {
    const dir = cacheDir ?? DEFAULT_CACHE_DIR;
    this.cacheFilePath = path.join(dir, DEFAULT_CACHE_FILE);
    this.ensureDirectory(dir);
  }

  async beforeCacheAccess(context: TokenCacheContext): Promise<void> {
    if (fs.existsSync(this.cacheFilePath)) {
      const data = fs.readFileSync(this.cacheFilePath, 'utf-8');
      context.tokenCache.deserialize(data);
    }
  }

  async afterCacheAccess(context: TokenCacheContext): Promise<void> {
    if (context.cacheHasChanged) {
      const data = context.tokenCache.serialize();
      fs.writeFileSync(this.cacheFilePath, data, { mode: 0o600 });
    }
  }

  /**
   * Clear the token cache file (logout).
   */
  clearCache(): void {
    if (fs.existsSync(this.cacheFilePath)) {
      fs.unlinkSync(this.cacheFilePath);
    }
  }

  /**
   * Check if a cached token exists.
   */
  hasCachedTokens(): boolean {
    return fs.existsSync(this.cacheFilePath);
  }

  getCachePath(): string {
    return this.cacheFilePath;
  }

  private ensureDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }
}
