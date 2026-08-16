import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileCachePlugin } from '../../src/graph/FileCachePlugin.js';

describe('FileCachePlugin', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `cache-test-${Date.now()}`);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  it('should create cache directory if it does not exist', () => {
    const plugin = new FileCachePlugin(testDir);
    expect(fs.existsSync(testDir)).toBe(true);
    expect(plugin.getCachePath()).toBe(path.join(testDir, 'token-cache.json'));
  });

  it('should report no cached tokens initially', () => {
    const plugin = new FileCachePlugin(testDir);
    expect(plugin.hasCachedTokens()).toBe(false);
  });

  it('should persist data via afterCacheAccess', async () => {
    const plugin = new FileCachePlugin(testDir);

    const mockContext = {
      cacheHasChanged: true,
      tokenCache: {
        serialize: () => '{"AccessToken":{"key":"value"}}',
        deserialize: () => undefined,
      },
    };

    await plugin.afterCacheAccess(mockContext as never);
    expect(plugin.hasCachedTokens()).toBe(true);

    const content = fs.readFileSync(plugin.getCachePath(), 'utf-8');
    expect(content).toBe('{"AccessToken":{"key":"value"}}');
  });

  it('should read data via beforeCacheAccess', async () => {
    const plugin = new FileCachePlugin(testDir);
    const cacheData = '{"AccessToken":{"cached":"data"}}';

    // Write cache manually
    fs.writeFileSync(plugin.getCachePath(), cacheData);

    let deserializedData = '';
    const mockContext = {
      cacheHasChanged: false,
      tokenCache: {
        serialize: () => '',
        deserialize: (data: string) => {
          deserializedData = data;
        },
      },
    };

    await plugin.beforeCacheAccess(mockContext as never);
    expect(deserializedData).toBe(cacheData);
  });

  it('should not write if cache has not changed', async () => {
    const plugin = new FileCachePlugin(testDir);

    const mockContext = {
      cacheHasChanged: false,
      tokenCache: {
        serialize: () => '{"should":"not be written"}',
        deserialize: () => undefined,
      },
    };

    await plugin.afterCacheAccess(mockContext as never);
    expect(plugin.hasCachedTokens()).toBe(false);
  });

  it('should clear cache on clearCache()', async () => {
    const plugin = new FileCachePlugin(testDir);

    // Create a cache file
    fs.writeFileSync(plugin.getCachePath(), '{}');
    expect(plugin.hasCachedTokens()).toBe(true);

    plugin.clearCache();
    expect(plugin.hasCachedTokens()).toBe(false);
  });

  it('should set restrictive file permissions', async () => {
    const plugin = new FileCachePlugin(testDir);

    const mockContext = {
      cacheHasChanged: true,
      tokenCache: {
        serialize: () => '{"token":"secret"}',
        deserialize: () => undefined,
      },
    };

    await plugin.afterCacheAccess(mockContext as never);

    const stats = fs.statSync(plugin.getCachePath());
    // 0o600 = owner read+write only (on Unix)
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
