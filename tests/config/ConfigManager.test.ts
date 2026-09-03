import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigManager, EnvSource } from '../../src/config/ConfigManager.js';

describe('ConfigManager', () => {
  let configManager: ConfigManager;
  // Isolated env source: tests never touch (or leak into) process.env.
  let env: EnvSource;
  // Isolated working directory: no ambient `.env` from the repo root is visible.
  let sandboxDir: string;
  let tempDir: string;
  let rulesConfigPath: string;

  beforeEach(() => {
    sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-manager-'));
    tempDir = path.join(sandboxDir, 'fixtures');
    rulesConfigPath = path.join(tempDir, 'rules.json');
    env = {};
    configManager = new ConfigManager({ cwd: sandboxDir, env });
  });

  afterEach(() => {
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  });

  it('should load config from environment variables', async () => {
    env.VAULT_PATH = '/test/vault';
    env.OUTPUT_PATH = '/test/output';
    env.LOG_LEVEL = 'debug';
    env.DEBOUNCE_DELAY = '500';

    const config = await configManager.load();

    expect(config.vaultPath).toBe('/test/vault');
    expect(config.outputPath).toBe('/test/output');
    expect(config.oneDriveFolder).toBe('ObsidianPublished');
    expect(config.logLevel).toBe('debug');
    expect(config.debounceDelay).toBe(500);
    expect(config.healthPort).toBe(8080);
  });

  it('should throw error when VAULT_PATH is missing', async () => {
    env.OUTPUT_PATH = '/test/output';

    await expect(configManager.load()).rejects.toThrow(
      'VAULT_PATH is required'
    );
  });

  it('should throw error when OUTPUT_PATH is missing', async () => {
    env.VAULT_PATH = '/test/vault';

    await expect(configManager.load()).rejects.toThrow(
      'OUTPUT_PATH is required'
    );
  });

  it('should apply default values', async () => {
    env.VAULT_PATH = '/test/vault';
    env.OUTPUT_PATH = '/test/output';

    const config = await configManager.load();

    expect(config.logLevel).toBe('info');
    expect(config.debounceDelay).toBe(300);
    expect(config.rulesConfig).toBe('./config/rules.json');
    expect(config.oneDriveFolder).toBe('ObsidianPublished');
    expect(config.ignorePatterns).toContain('.git/**');
    expect(config.ignorePatterns).toContain('.obsidian/**');
    expect(config.ignorePatterns).toContain('*.bookmark.md');
    expect(config.ignorePatterns).toContain('**/*.bookmark.md');
  });

  it('should parse ignore patterns from env', async () => {
    env.VAULT_PATH = '/test/vault';
    env.OUTPUT_PATH = '/test/output';
    env.IGNORE_PATTERNS = '.git/**, .obsidian/**, custom/**';

    const config = await configManager.load();

    expect(config.ignorePatterns).toContain('.git/**');
    expect(config.ignorePatterns).toContain('.obsidian/**');
    expect(config.ignorePatterns).toContain('custom/**');
  });

  it('should preserve a OneDrive folder as a remote path', async () => {
    env.VAULT_PATH = '/test/vault';
    env.OUTPUT_PATH = '/test/output';
    env.ONEDRIVE_FOLDER = '~/Shared Notes';

    const config = await configManager.load();

    expect(config.oneDriveFolder).toBe('~/Shared Notes');
  });

  it('should read health port from the environment', async () => {
    env.VAULT_PATH = '/test/vault';
    env.OUTPUT_PATH = '/test/output';
    env.HEALTH_PORT = '9090';

    const config = await configManager.load();

    expect(config.healthPort).toBe(9090);
  });

  it('should reject an invalid health port', async () => {
    env.VAULT_PATH = '/test/vault';
    env.OUTPUT_PATH = '/test/output';
    env.HEALTH_PORT = '70000';

    await expect(configManager.load()).rejects.toThrow(
      'HEALTH_PORT must be an integer between 1 and 65535'
    );
  });

  it('should default polling off with a 1000ms interval', async () => {
    env.VAULT_PATH = '/test/vault';
    env.OUTPUT_PATH = '/test/output';

    const config = await configManager.load();

    expect(config.usePolling).toBe(false);
    expect(config.pollInterval).toBe(1000);
  });

  it('should enable polling from the environment', async () => {
    env.VAULT_PATH = '/test/vault';
    env.OUTPUT_PATH = '/test/output';
    env.WATCH_USE_POLLING = 'true';
    env.WATCH_POLL_INTERVAL = '2500';

    const config = await configManager.load();

    expect(config.usePolling).toBe(true);
    expect(config.pollInterval).toBe(2500);
  });

  it('should treat non-truthy polling values as disabled', async () => {
    env.VAULT_PATH = '/test/vault';
    env.OUTPUT_PATH = '/test/output';
    env.WATCH_USE_POLLING = 'false';

    const config = await configManager.load();

    expect(config.usePolling).toBe(false);
  });

  it('should reject an invalid poll interval', async () => {
    env.VAULT_PATH = '/test/vault';
    env.OUTPUT_PATH = '/test/output';
    env.WATCH_POLL_INTERVAL = '0';

    await expect(configManager.load()).rejects.toThrow(
      'WATCH_POLL_INTERVAL must be a positive integer (milliseconds)'
    );
  });

  it('should cache config after loading', async () => {
    env.VAULT_PATH = '/test/vault';
    env.OUTPUT_PATH = '/test/output';

    const config1 = await configManager.load();
    const config2 = await configManager.load();

    expect(config1).toBe(config2);
  });

  it('should allow reload', async () => {
    env.VAULT_PATH = '/test/vault1';
    env.OUTPUT_PATH = '/test/output1';

    const config1 = await configManager.load();
    expect(config1.vaultPath).toBe('/test/vault1');

    env.VAULT_PATH = '/test/vault2';
    const config2 = await configManager.reload();

    expect(config2.vaultPath).toBe('/test/vault2');
  });

  it('should throw if getConfig called before load', () => {
    expect(() => configManager.getConfig()).toThrow(
      'Config not loaded'
    );
  });

  it('should return config via loadAndGet', async () => {
    env.VAULT_PATH = '/test/vault';
    env.OUTPUT_PATH = '/test/output';

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

    env.RULES_CONFIG = rulesConfigPath;

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

    env.RULES_CONFIG = rulesConfigPath;
    env.VAULT_PATH = '/env/vault';
    env.OUTPUT_PATH = '/env/output';
    env.ONEDRIVE_FOLDER = 'Environment Folder';
    env.LOG_LEVEL = 'error';
    env.DEBOUNCE_DELAY = '125';

    const config = await configManager.load();

    expect(config.vaultPath).toBe('/env/vault');
    expect(config.outputPath).toBe('/env/output');
    expect(config.oneDriveFolder).toBe('Environment Folder');
    expect(config.logLevel).toBe('error');
    expect(config.debounceDelay).toBe(125);
  });

  it('should reload config after env changes', async () => {
    env.VAULT_PATH = '/test/vault1';
    env.OUTPUT_PATH = '/test/output1';

    const config1 = await configManager.load();
    expect(config1.vaultPath).toBe('/test/vault1');

    env.VAULT_PATH = '/test/vault2';
    env.OUTPUT_PATH = '/test/output2';

    const config2 = await configManager.reload();

    expect(config2.vaultPath).toBe('/test/vault2');
    expect(config2.outputPath).toBe('/test/output2');
    expect(config2).not.toBe(config1);
  });

  it('should load a .env file from the injected working directory', async () => {
    fs.writeFileSync(
      path.join(sandboxDir, '.env'),
      'VAULT_PATH=/dotenv/vault\nOUTPUT_PATH=/dotenv/output\nHEALTH_PORT=8123\n'
    );

    const config = await configManager.load();

    expect(config.vaultPath).toBe('/dotenv/vault');
    expect(config.healthPort).toBe(8123);
    expect(process.env.VAULT_PATH).toBeUndefined();
  });

  it('should fill gaps from .env.local without overwriting existing values', async () => {
    fs.writeFileSync(
      path.join(sandboxDir, '.env'),
      'VAULT_PATH=/dotenv/vault\nOUTPUT_PATH=/dotenv/output\n'
    );
    fs.writeFileSync(
      path.join(sandboxDir, '.env.local'),
      'VAULT_PATH=/local/vault\nLOG_LEVEL=warn\n'
    );

    const config = await configManager.load();

    // dotenv never overwrites a value that is already set.
    expect(config.vaultPath).toBe('/dotenv/vault');
    expect(config.logLevel).toBe('warn');
  });

  it('should skip dotenv loading when disabled', async () => {
    fs.writeFileSync(path.join(sandboxDir, '.env'), 'HEALTH_PORT=8123\n');
    env.VAULT_PATH = '/test/vault';
    env.OUTPUT_PATH = '/test/output';

    const config = await new ConfigManager({
      cwd: sandboxDir,
      env,
      loadDotenv: false,
    }).load();

    expect(config.healthPort).toBe(8080);
  });

  it('should not read the ambient process environment when an env is injected', async () => {
    process.env.CONFIG_MANAGER_TEST_VAULT = '/ambient/vault';
    try {
      env.VAULT_PATH = '/test/vault';
      env.OUTPUT_PATH = '/test/output';

      const config = await configManager.load();

      expect(config.vaultPath).toBe('/test/vault');
      expect(env.CONFIG_MANAGER_TEST_VAULT).toBeUndefined();
    } finally {
      delete process.env.CONFIG_MANAGER_TEST_VAULT;
    }
  });

  it('should resolve a relative rules config against the injected working directory', async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(
      rulesConfigPath,
      JSON.stringify({
        config: { vaultPath: '/file/vault', outputPath: '/file/output' },
      })
    );

    env.RULES_CONFIG = path.join('fixtures', 'rules.json');

    const config = await configManager.load();

    expect(config.vaultPath).toBe('/file/vault');
  });
});
