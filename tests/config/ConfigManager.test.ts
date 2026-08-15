import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../../src/config/ConfigManager.js';

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  const tempDir = path.join(process.cwd(), '.test-config');

  beforeEach(() => {
    configManager = new ConfigManager();
    // Clean up env
    delete process.env.VAULT_PATH;
    delete process.env.OUTPUT_PATH;
    delete process.env.RULES_CONFIG;
    delete process.env.LOG_LEVEL;
    delete process.env.DEBOUNCE_DELAY;
    delete process.env.IGNORE_PATTERNS;
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('should load config from environment variables', async () => {
    process.env.VAULT_PATH = '/test/vault';
    process.env.OUTPUT_PATH = '/test/output';
    process.env.LOG_LEVEL = 'debug';
    process.env.DEBOUNCE_DELAY = '500';

    const config = await configManager.load();

    expect(config.vaultPath).toBe('/test/vault');
    expect(config.outputPath).toBe('/test/output');
    expect(config.logLevel).toBe('debug');
    expect(config.debounceDelay).toBe(500);
  });

  it('should throw error when VAULT_PATH is missing', async () => {
    process.env.OUTPUT_PATH = '/test/output';

    await expect(configManager.load()).rejects.toThrow(
      'VAULT_PATH is required'
    );
  });

  it('should throw error when OUTPUT_PATH is missing', async () => {
    process.env.VAULT_PATH = '/test/vault';

    await expect(configManager.load()).rejects.toThrow(
      'OUTPUT_PATH is required'
    );
  });

  it('should apply default values', async () => {
    process.env.VAULT_PATH = '/test/vault';
    process.env.OUTPUT_PATH = '/test/output';

    const config = await configManager.load();

    expect(config.logLevel).toBe('info');
    expect(config.debounceDelay).toBe(300);
    expect(config.rulesConfig).toBe('./config/rules.json');
    expect(config.ignorePatterns).toContain('.git/**');
    expect(config.ignorePatterns).toContain('.obsidian/**');
  });

  it('should parse ignore patterns from env', async () => {
    process.env.VAULT_PATH = '/test/vault';
    process.env.OUTPUT_PATH = '/test/output';
    process.env.IGNORE_PATTERNS = '.git/**, .obsidian/**, custom/**';

    const config = await configManager.load();

    expect(config.ignorePatterns).toContain('.git/**');
    expect(config.ignorePatterns).toContain('.obsidian/**');
    expect(config.ignorePatterns).toContain('custom/**');
  });

  it('should cache config after loading', async () => {
    process.env.VAULT_PATH = '/test/vault';
    process.env.OUTPUT_PATH = '/test/output';

    const config1 = await configManager.load();
    const config2 = await configManager.load();

    expect(config1).toBe(config2);
  });

  it('should allow reload', async () => {
    process.env.VAULT_PATH = '/test/vault1';
    process.env.OUTPUT_PATH = '/test/output1';

    const config1 = await configManager.load();
    expect(config1.vaultPath).toBe('/test/vault1');

    process.env.VAULT_PATH = '/test/vault2';
    const config2 = await configManager.reload();

    expect(config2.vaultPath).toBe('/test/vault2');
  });

  it('should throw if getConfig called before load', () => {
    expect(() => configManager.getConfig()).toThrow(
      'Config not loaded'
    );
  });

  it('should return config via loadAndGet', async () => {
    process.env.VAULT_PATH = '/test/vault';
    process.env.OUTPUT_PATH = '/test/output';

    const config = await configManager.loadAndGet();

    expect(config.vaultPath).toBe('/test/vault');
  });
});
