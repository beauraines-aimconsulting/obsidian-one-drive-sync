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

export interface CachedTokenStatus {
  hasCachedToken: boolean;
  expiresAt: string | null;
}

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

  getCachedTokenStatus(): CachedTokenStatus {
    if (!fs.existsSync(this.cacheFilePath)) {
      return { hasCachedToken: false, expiresAt: null };
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.cacheFilePath, 'utf-8')) as {
        AccessToken?: Record<string, Record<string, unknown>>;
      };
      const entries = Object.values(parsed.AccessToken ?? {});
      const expiresAt =
        entries
          .map((entry) => this.readExpiry(entry))
          .filter((value): value is string => value !== null)
          .sort()
          .at(-1) ?? null;

      return {
        hasCachedToken: true,
        expiresAt,
      };
    } catch {
      return {
        hasCachedToken: true,
        expiresAt: null,
      };
    }
  }

  getCachePath(): string {
    return this.cacheFilePath;
  }

  private ensureDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }

  private readExpiry(entry: Record<string, unknown>): string | null {
    const rawValue = entry.expires_on ?? entry.expiresOn ?? entry.expiresOnTimestamp;
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return new Date(rawValue * 1000).toISOString();
    }
    if (typeof rawValue === 'string' && rawValue.trim() !== '') {
      const asNumber = Number(rawValue);
      if (Number.isFinite(asNumber)) {
        return new Date(asNumber * 1000).toISOString();
      }
      const parsed = new Date(rawValue);
      return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
    }
    return null;
  }
}
