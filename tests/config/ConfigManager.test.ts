import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../../src/config/ConfigManager.js';

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  const tempDir = path.join(process.cwd(), '.test-config');
  const rulesConfigPath = path.join(tempDir, 'rules.json');

  beforeEach(() => {
    configManager = new ConfigManager();
    // Clean up env
    delete process.env.VAULT_PATH;
    delete process.env.OUTPUT_PATH;
    delete process.env.ONEDRIVE_FOLDER;
    delete process.env.RULES_CONFIG;
    delete process.env.LOG_LEVEL;
    delete process.env.DEBOUNCE_DELAY;
    delete process.env.IGNORE_PATTERNS;
    delete process.env.RULES_CONFIG;

    fs.rmSync(tempDir, { recursive: true, force: true });
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
    expect(config.oneDriveFolder).toBe('ObsidianPublished');
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
    expect(config.oneDriveFolder).toBe('ObsidianPublished');
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

  it('should preserve a OneDrive folder as a remote path', async () => {
    process.env.VAULT_PATH = '/test/vault';
    process.env.OUTPUT_PATH = '/test/output';
    process.env.ONEDRIVE_FOLDER = '~/Shared Notes';

    const config = await configManager.load();

    expect(config.oneDriveFolder).toBe('~/Shared Notes');
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

  it('should load config values from a rules config file', async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(
      rulesConfigPath,
      JSON.stringify({
        config: {
          vaultPath: '/file/vault',
          outputPath: '/file/output',
          oneDriveFolder: 'Team Notes',
          logLevel: 'warn',
          debounceDelay: 750,
          ignorePatterns: ['temp/**', '.cache/**'],
        },
      })
    );

    process.env.RULES_CONFIG = rulesConfigPath;

    const config = await configManager.load();

    expect(config.vaultPath).toBe('/file/vault');
    expect(config.outputPath).toBe('/file/output');
    expect(config.oneDriveFolder).toBe('Team Notes');
    expect(config.logLevel).toBe('warn');
    expect(config.debounceDelay).toBe(750);
    expect(config.ignorePatterns).toEqual(['temp/**', '.cache/**']);
  });

  it('should let env vars override config file values', async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(
      rulesConfigPath,
      JSON.stringify({
        config: {
          vaultPath: '/file/vault',
          outputPath: '/file/output',
          oneDriveFolder: 'File Folder',
          logLevel: 'warn',
          debounceDelay: 750,
        },
      })
    );

    process.env.RULES_CONFIG = rulesConfigPath;
    process.env.VAULT_PATH = '/env/vault';
    process.env.OUTPUT_PATH = '/env/output';
    process.env.ONEDRIVE_FOLDER = 'Environment Folder';
    process.env.LOG_LEVEL = 'error';
    process.env.DEBOUNCE_DELAY = '125';

    const config = await configManager.load();

    expect(config.vaultPath).toBe('/env/vault');
    expect(config.outputPath).toBe('/env/output');
    expect(config.oneDriveFolder).toBe('Environment Folder');
    expect(config.logLevel).toBe('error');
    expect(config.debounceDelay).toBe(125);
  });

  it('should reload config after env changes', async () => {
    process.env.VAULT_PATH = '/test/vault1';
    process.env.OUTPUT_PATH = '/test/output1';

    const config1 = await configManager.load();
    expect(config1.vaultPath).toBe('/test/vault1');

    process.env.VAULT_PATH = '/test/vault2';
    process.env.OUTPUT_PATH = '/test/output2';

    const config2 = await configManager.reload();

    expect(config2.vaultPath).toBe('/test/vault2');
    expect(config2.outputPath).toBe('/test/output2');
    expect(config2).not.toBe(config1);
  });
});
