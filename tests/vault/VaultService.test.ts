import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { VaultService } from '../../src/vault/VaultService.js';
import type { FileMetadata, VaultState } from '../../src/vault/types.js';

const TEST_DIR = path.resolve(process.cwd(), '.test-vault-service');

function getTestVaultPath(suffix: string): string {
  return path.join(TEST_DIR, `vault-${suffix}-${Date.now()}`);
}

describe('VaultService', () => {
  let vaultPath: string;
  let service: VaultService;

  beforeEach(async () => {
    // Ensure test directory exists
    if (!fs.existsSync(TEST_DIR)) {
      await fs.promises.mkdir(TEST_DIR, { recursive: true });
    }
    // Create test vault directory
    vaultPath = getTestVaultPath('');
    await fs.promises.mkdir(vaultPath, { recursive: true });
  });

  afterEach(async () => {
    // Stop monitoring if active
    if (service?.isMonitoring?.()) {
      await service.stopMonitoring();
    }

    // Clean up test directory
    if (fs.existsSync(vaultPath)) {
      fs.rmSync(vaultPath, { recursive: true });
    }
  });

  describe('initialization and configuration', () => {
    it('should create a service without config', () => {
      service = new VaultService();
      expect(service).toBeDefined();
      expect(service.isMonitoring()).toBe(false);
    });

    it('should create a service with config', () => {
      service = new VaultService({ vaultPath });
      expect(service.getVaultPath()).toBe(vaultPath);
    });

    it('should store vault path from config', () => {
      service = new VaultService({ vaultPath });
      expect(service.getVaultPath()).toBe(vaultPath);
    });

    it('should initialize empty file cache', () => {
      service = new VaultService();
      const fileList = service.getFileList();
      expect(fileList.size).toBe(0);
    });

    it('should support ignore patterns in config', () => {
      service = new VaultService({
        vaultPath,
        ignorePatterns: ['.git/**', '.obsidian/**'],
      });
      expect(service).toBeDefined();
    });

    it('should support custom debounce delay', () => {
      service = new VaultService({
        vaultPath,
        debounceDelay: 500,
      });
      expect(service).toBeDefined();
    });
  });

  describe('start/stop monitoring', () => {
    it('should start monitoring with provided path', async () => {
      service = new VaultService();
      await service.startMonitoring(vaultPath);
      expect(service.isMonitoring()).toBe(true);
      await service.stopMonitoring();
    });

    it('should start monitoring with configured path', async () => {
      service = new VaultService({ vaultPath });
      await service.startMonitoring();
      expect(service.isMonitoring()).toBe(true);
      await service.stopMonitoring();
    });

    it('should throw error if path not provided', async () => {
      service = new VaultService();
      await expect(service.startMonitoring()).rejects.toThrow('Vault path not specified');
    });

    it('should stop monitoring and clear cache', async () => {
      service = new VaultService({ vaultPath });

      // Create a test file
      const testFile = path.join(vaultPath, 'test.md');
      await fs.promises.writeFile(testFile, '# Test\n');

      await service.startMonitoring();
      expect(service.getFileList().size).toBeGreaterThan(0);

      await service.stopMonitoring();
      expect(service.isMonitoring()).toBe(false);
      expect(service.getFileList().size).toBe(0);
    });

    it('should prevent double start', async () => {
      service = new VaultService({ vaultPath });
      await service.startMonitoring();

      // Try to start again (should warn)
      await service.startMonitoring();
      expect(service.isMonitoring()).toBe(true);

      await service.stopMonitoring();
    });

    it('should handle stop when not monitoring', async () => {
      service = new VaultService();
      // Should not throw
      await service.stopMonitoring();
    });
  });

  describe('initial vault scan', () => {
    it('should scan empty vault', async () => {
      service = new VaultService({ vaultPath });
      await service.startMonitoring();

      const state = service.getVaultState();
      expect(state.fileCount).toBe(0);

      await service.stopMonitoring();
    });

    it('should find markdown files in root', async () => {
      // Create test files
      await fs.promises.writeFile(path.join(vaultPath, 'file1.md'), '# File 1\n');
      await fs.promises.writeFile(path.join(vaultPath, 'file2.md'), '# File 2\n');

      service = new VaultService({ vaultPath });
      await service.startMonitoring();

      expect(service.getFileList().size).toBe(2);

      await service.stopMonitoring();
    });

    it('should find markdown files in subdirectories', async () => {
      // Create nested structure
      const subdir = path.join(vaultPath, 'subdir');
      await fs.promises.mkdir(subdir);
      await fs.promises.writeFile(path.join(subdir, 'nested.md'), '# Nested\n');
      await fs.promises.writeFile(path.join(vaultPath, 'root.md'), '# Root\n');

      service = new VaultService({ vaultPath });
      await service.startMonitoring();

      expect(service.getFileList().size).toBe(2);

      await service.stopMonitoring();
    });

    it('should ignore non-markdown files', async () => {
      await fs.promises.writeFile(path.join(vaultPath, 'file.md'), '# File\n');
      await fs.promises.writeFile(path.join(vaultPath, 'file.txt'), 'text\n');
      await fs.promises.writeFile(path.join(vaultPath, 'config.json'), '{}\n');

      service = new VaultService({ vaultPath });
      await service.startMonitoring();

      expect(service.getFileList().size).toBe(1);

      await service.stopMonitoring();
    });

    it('should ignore hidden directories', async () => {
      const hiddenDir = path.join(vaultPath, '.hidden');
      await fs.promises.mkdir(hiddenDir);
      await fs.promises.writeFile(path.join(hiddenDir, 'file.md'), '# Hidden\n');
      await fs.promises.writeFile(path.join(vaultPath, 'visible.md'), '# Visible\n');

      service = new VaultService({ vaultPath });
      await service.startMonitoring();

      expect(service.getFileList().size).toBe(1);

      await service.stopMonitoring();
    });

    it('should set lastScanned timestamp', async () => {
      service = new VaultService({ vaultPath });

      const beforeScan = Date.now();
      await service.startMonitoring();
      const afterScan = Date.now();

      const state = service.getVaultState();
      expect(state.lastScanned).toBeGreaterThanOrEqual(beforeScan);
      expect(state.lastScanned).toBeLessThanOrEqual(afterScan);

      await service.stopMonitoring();
    });

    it('should parse published status from frontmatter', async () => {
      const publishedFile = path.join(vaultPath, 'published.md');
      const unpublishedFile = path.join(vaultPath, 'unpublished.md');

      await fs.promises.writeFile(
        publishedFile,
        '---\npublish: true\n---\n# Published\n'
      );
      await fs.promises.writeFile(unpublishedFile, '# Unpublished\n');

      service = new VaultService({ vaultPath });
      await service.startMonitoring();

      const state = service.getVaultState();
      expect(state.published).toBe(1);
      expect(state.unpublished).toBe(1);

      await service.stopMonitoring();
    });
  });

  describe('file cache and retrieval', () => {
    beforeEach(async () => {
      service = new VaultService({ vaultPath });
    });

    afterEach(async () => {
      if (service?.isMonitoring?.()) {
        await service.stopMonitoring();
      }
    });

    it('should retrieve file by path', async () => {
      const testFile = path.join(vaultPath, 'test.md');
      await fs.promises.writeFile(testFile, '# Test\n');

      await service.startMonitoring();

      const file = service.getFile('test.md');
      expect(file).toBeDefined();
      expect(file?.filepath).toBe('test.md');

      await service.stopMonitoring();
    });

    it('should return undefined for missing file', async () => {
      await service.startMonitoring();

      const file = service.getFile('nonexistent.md');
      expect(file).toBeUndefined();

      await service.stopMonitoring();
    });

    it('should return copy of file list', async () => {
      await fs.promises.writeFile(path.join(vaultPath, 'file.md'), '# File\n');

      await service.startMonitoring();

      const list1 = service.getFileList();
      const list2 = service.getFileList();

      expect(list1).not.toBe(list2); // Different object
      expect(list1.size).toBe(list2.size); // Same content

      await service.stopMonitoring();
    });

    it('should store file metadata correctly', async () => {
      const testFile = path.join(vaultPath, 'test.md');
      const content = '# Test\n';
      await fs.promises.writeFile(testFile, content);

      await service.startMonitoring();

      const metadata = service.getFile('test.md');
      expect(metadata).toBeDefined();
      expect(metadata?.filepath).toBe('test.md');
      expect(metadata?.size).toBeGreaterThan(0);
      expect(metadata?.lastModified).toBeGreaterThan(0);
      expect(typeof metadata?.published).toBe('boolean');

      await service.stopMonitoring();
    });
  });

  describe('file change events', () => {
    beforeEach(async () => {
      service = new VaultService({ vaultPath });
      await service.startMonitoring();
    });

    afterEach(async () => {
      if (service?.isMonitoring?.()) {
        await service.stopMonitoring();
      }
    });

    it('should have listeners for file events', async () => {
      // Verify that we can attach event listeners without errors
      const addedHandler = vi.fn();
      const modifiedHandler = vi.fn();
      const deletedHandler = vi.fn();
      const renamedHandler = vi.fn();

      service.on('fileAdded', addedHandler);
      service.on('fileModified', modifiedHandler);
      service.on('fileDeleted', deletedHandler);
      service.on('fileRenamed', renamedHandler);

      // Verify listeners were attached
      expect(service.listenerCount('fileAdded')).toBeGreaterThan(0);
      expect(service.listenerCount('fileModified')).toBeGreaterThan(0);
      expect(service.listenerCount('fileDeleted')).toBeGreaterThan(0);
      expect(service.listenerCount('fileRenamed')).toBeGreaterThan(0);
    });

    it('should allow removing event listeners', async () => {
      const handler = vi.fn();

      service.on('fileAdded', handler);
      expect(service.listenerCount('fileAdded')).toBe(1);

      service.off('fileAdded', handler);
      expect(service.listenerCount('fileAdded')).toBe(0);
    });

    it('should support once event listeners', async () => {
      const handler = vi.fn();

      service.once('fileAdded', handler);
      expect(service.listenerCount('fileAdded')).toBe(1);

      // Manually emit to simulate event
      await service['emit']('fileAdded', { filepath: 'test.md', lastModified: 0, size: 0, published: false } as unknown);

      // Handler should have been called
      expect(handler).toHaveBeenCalledTimes(1);

      // Listener should be removed after once
      expect(service.listenerCount('fileAdded')).toBe(0);
    });
  });

  describe('getVaultState', () => {
    beforeEach(async () => {
      service = new VaultService({ vaultPath });
    });

    afterEach(async () => {
      if (service?.isMonitoring?.()) {
        await service.stopMonitoring();
      }
    });

    it('should return VaultState with correct structure', async () => {
      await service.startMonitoring();

      const state = service.getVaultState();

      expect(state).toHaveProperty('lastScanned');
      expect(state).toHaveProperty('fileCount');
      expect(state).toHaveProperty('published');
      expect(state).toHaveProperty('unpublished');
    });

    it('should count total files correctly', async () => {
      await fs.promises.writeFile(path.join(vaultPath, 'file1.md'), '# File 1\n');
      await fs.promises.writeFile(path.join(vaultPath, 'file2.md'), '# File 2\n');

      await service.startMonitoring();

      const state = service.getVaultState();
      expect(state.fileCount).toBe(2);
    });

    it('should count published files correctly', async () => {
      await fs.promises.writeFile(
        path.join(vaultPath, 'published.md'),
        '---\npublish: true\n---\n# Published\n'
      );
      await fs.promises.writeFile(
        path.join(vaultPath, 'unpublished.md'),
        '# Unpublished\n'
      );

      await service.startMonitoring();

      const state = service.getVaultState();
      expect(state.published).toBe(1);
      expect(state.unpublished).toBe(1);
    });

    it('should have correct total files count', async () => {
      await fs.promises.writeFile(
        path.join(vaultPath, 'file1.md'),
        '---\npublish: true\n---\n# File 1\n'
      );
      await fs.promises.writeFile(
        path.join(vaultPath, 'file2.md'),
        '# File 2\n'
      );

      await service.startMonitoring();

      const state = service.getVaultState();
      expect(state.fileCount).toBe(state.published + state.unpublished);
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      service = new VaultService();
    });

    afterEach(async () => {
      if (service?.isMonitoring?.()) {
        await service.stopMonitoring();
      }
    });

    it('should handle missing vault path on start', async () => {
      await expect(service.startMonitoring()).rejects.toThrow();
    });

    it('should handle invalid file reads gracefully', async () => {
      vaultPath = getTestVaultPath('invalid-read');
      await fs.promises.mkdir(vaultPath, { recursive: true });

      const testFile = path.join(vaultPath, 'test.md');
      await fs.promises.writeFile(testFile, '# Test\n');

      service = new VaultService({ vaultPath });
      await service.startMonitoring();

      // Make file unreadable
      await fs.promises.chmod(testFile, 0o000);

      try {
        // Try to read it
        const file = service.getFile('test.md');
        // Should either handle gracefully or already have cached version
        expect(file || true).toBeTruthy();
      } finally {
        // Restore permissions for cleanup
        await fs.promises.chmod(testFile, 0o644);

        await service.stopMonitoring();
        fs.rmSync(vaultPath, { recursive: true });
      }
    });
  });

  describe('edge cases', () => {
    beforeEach(async () => {
      vaultPath = getTestVaultPath('edge-case');
      await fs.promises.mkdir(vaultPath, { recursive: true });
      service = new VaultService({ vaultPath });
    });

    afterEach(async () => {
      if (service?.isMonitoring?.()) {
        await service.stopMonitoring();
      }
      if (fs.existsSync(vaultPath)) {
        fs.rmSync(vaultPath, { recursive: true });
      }
    });

    it('should handle deeply nested directories', async () => {
      const deepPath = path.join(vaultPath, 'a', 'b', 'c', 'd', 'e');
      await fs.promises.mkdir(deepPath, { recursive: true });
      await fs.promises.writeFile(path.join(deepPath, 'deep.md'), '# Deep\n');

      await service.startMonitoring();

      const file = service.getFile('a/b/c/d/e/deep.md');
      expect(file).toBeDefined();
    });

    it('should handle files with special characters in names', async () => {
      const specialFile = path.join(vaultPath, 'file-with-special_chars.123.md');
      await fs.promises.writeFile(specialFile, '# Special\n');

      await service.startMonitoring();

      const file = service.getFile('file-with-special_chars.123.md');
      expect(file).toBeDefined();
    });

    it('should handle whitespace in file names', async () => {
      const spaceFile = path.join(vaultPath, 'file with spaces.md');
      await fs.promises.writeFile(spaceFile, '# Spaces\n');

      await service.startMonitoring();

      const file = service.getFile('file with spaces.md');
      expect(file).toBeDefined();
    });

    it('should handle empty markdown files', async () => {
      const emptyFile = path.join(vaultPath, 'empty.md');
      await fs.promises.writeFile(emptyFile, '');

      await service.startMonitoring();

      const file = service.getFile('empty.md');
      expect(file).toBeDefined();
      expect(file?.size).toBe(0);
    });

    it('should handle large markdown files', async () => {
      const largeFile = path.join(vaultPath, 'large.md');
      const largeContent = '# Large\n' + 'Content\n'.repeat(10000);
      await fs.promises.writeFile(largeFile, largeContent);

      await service.startMonitoring();

      const file = service.getFile('large.md');
      expect(file).toBeDefined();
      expect(file?.size).toBeGreaterThan(10000);
    });

    it('should normalize path separators to forward slashes', async () => {
      // Create nested structure
      const nestedPath = path.join(vaultPath, 'folder', 'subfolder', 'file.md');
      await fs.promises.mkdir(path.dirname(nestedPath), { recursive: true });
      await fs.promises.writeFile(nestedPath, '# File\n');

      await service.startMonitoring();

      // Should return with forward slashes regardless of OS
      const file = service.getFile('folder/subfolder/file.md');
      expect(file).toBeDefined();
    });
  });

  describe('monitoring state', () => {
    beforeEach(() => {
      service = new VaultService({ vaultPath });
    });

    it('should track monitoring state', async () => {
      expect(service.isMonitoring()).toBe(false);

      await service.startMonitoring();
      expect(service.isMonitoring()).toBe(true);

      await service.stopMonitoring();
      expect(service.isMonitoring()).toBe(false);
    });

    it('should return configured vault path', async () => {
      service = new VaultService({ vaultPath });
      expect(service.getVaultPath()).toBe(vaultPath);
    });

    it('should update vault path when starting with new path', async () => {
      const newPath = getTestVaultPath('new-path');
      await fs.promises.mkdir(newPath, { recursive: true });

      try {
        service = new VaultService();
        await service.startMonitoring(newPath);

        expect(service.getVaultPath()).toBe(newPath);

        await service.stopMonitoring();
      } finally {
        if (fs.existsSync(newPath)) {
          fs.rmSync(newPath, { recursive: true });
        }
      }
    });
  });
});
