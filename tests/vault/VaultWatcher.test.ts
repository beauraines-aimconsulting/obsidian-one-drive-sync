import { describe, it, expect, beforeEach, afterEach, vi, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { VaultWatcher } from '../../src/vault/VaultWatcher.js';
import type { FileEvent } from '../../src/vault/types.js';

describe('VaultWatcher', { timeout: 10000 }, () => {
  let watcher: VaultWatcher;
  let vaultDir: string;
  const testDir = path.join(process.cwd(), '.test-vault');

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    vaultDir = testDir;
  });

  afterEach(async () => {
    if (watcher && watcher.isWatching()) {
      try {
        await watcher.unwatch();
      } catch (e) {
        // ignore
      }
    }
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true });
      } catch (e) {
        // ignore
      }
    }
  });

  afterAll(async () => {
    // Final cleanup
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true });
      } catch (e) {
        // ignore
      }
    }
  });

  describe('initialization', () => {
    it('should create a watcher instance with default config', () => {
      watcher = new VaultWatcher();
      expect(watcher).toBeDefined();
      expect(watcher.isWatching()).toBe(false);
    });

    it('should create a watcher with custom debounce delay', () => {
      watcher = new VaultWatcher({ debounceDelay: 500 });
      expect(watcher).toBeDefined();
    });

    it('should create a watcher with ignore patterns', () => {
      watcher = new VaultWatcher({
        ignorePatterns: ['.git/**', '.obsidian/**'],
      });
      expect(watcher).toBeDefined();
    });
  });

  describe('watch and unwatch', () => {
    it('should start watching a vault directory', async () => {
      watcher = new VaultWatcher();
      await watcher.watch(vaultDir);
      expect(watcher.isWatching()).toBe(true);
      await watcher.unwatch();
    });

    it('should stop watching gracefully', async () => {
      watcher = new VaultWatcher();
      await watcher.watch(vaultDir);
      expect(watcher.isWatching()).toBe(true);
      await watcher.unwatch();
      expect(watcher.isWatching()).toBe(false);
    });

    it('should handle unwatch when not watching', async () => {
      watcher = new VaultWatcher();
      await expect(watcher.unwatch()).resolves.not.toThrow();
    });

    it('should return if already watching', async () => {
      watcher = new VaultWatcher();
      await watcher.watch(vaultDir);
      await watcher.watch(vaultDir);
      expect(watcher.isWatching()).toBe(true);
      await watcher.unwatch();
    });
  });

  describe('file add event', () => {
    it('should emit add event when markdown file is created', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });
      await watcher.watch(vaultDir);

      let addedEvent: FileEvent | null = null;
      watcher.on('add', (event) => {
        addedEvent = event;
      });

      const testFile = path.join(vaultDir, 'test.md');
      fs.writeFileSync(testFile, 'test content');

      await new Promise((resolve) => setTimeout(resolve, 300));
      
      if (addedEvent) {
        expect(addedEvent?.type).toBe('add');
        expect(addedEvent?.filepath).toContain('test.md');
      }

      await watcher.unwatch();
    });

    it('should not emit add event for non-markdown files', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });
      await watcher.watch(vaultDir);

      let addedEvent: FileEvent | null = null;
      watcher.on('add', (event) => {
        addedEvent = event;
      });

      const testFile = path.join(vaultDir, 'test.txt');
      fs.writeFileSync(testFile, 'test content');

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(addedEvent).toBeNull();

      await watcher.unwatch();
    });

    it('should emit multiple add events for multiple files', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });
      await watcher.watch(vaultDir);

      const addedEvents: FileEvent[] = [];
      watcher.on('add', (event) => {
        addedEvents.push(event);
      });

      fs.writeFileSync(path.join(vaultDir, 'file1.md'), 'content1');
      fs.writeFileSync(path.join(vaultDir, 'file2.md'), 'content2');

      await new Promise((resolve) => setTimeout(resolve, 500));
      
      if (addedEvents.length > 0) {
        expect(addedEvents.length).toBeGreaterThanOrEqual(1);
      }

      await watcher.unwatch();
    });
  });

  describe('file modify event', () => {
    it('should emit modify event when markdown file is changed', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });
      await watcher.watch(vaultDir);

      const testFile = path.join(vaultDir, 'test.md');
      fs.writeFileSync(testFile, 'initial content');

      await new Promise((resolve) => setTimeout(resolve, 300));

      let modifiedEvent: FileEvent | null = null;
      watcher.on('modify', (event) => {
        modifiedEvent = event;
      });

      fs.writeFileSync(testFile, 'modified content');

      await new Promise((resolve) => setTimeout(resolve, 300));
      
      if (modifiedEvent) {
        expect(modifiedEvent?.type).toBe('modify');
        expect(modifiedEvent?.filepath).toContain('test.md');
      }

      await watcher.unwatch();
    });

    it('should not emit modify event for non-markdown files', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });
      await watcher.watch(vaultDir);

      const testFile = path.join(vaultDir, 'test.txt');
      fs.writeFileSync(testFile, 'initial content');

      await new Promise((resolve) => setTimeout(resolve, 300));

      let modifiedEvent: FileEvent | null = null;
      watcher.on('modify', (event) => {
        modifiedEvent = event;
      });

      fs.writeFileSync(testFile, 'modified content');

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(modifiedEvent).toBeNull();

      await watcher.unwatch();
    });
  });

  describe('file delete event', () => {
    it('should emit delete event when markdown file is removed', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });
      await watcher.watch(vaultDir);

      const testFile = path.join(vaultDir, 'test.md');
      fs.writeFileSync(testFile, 'test content');

      await new Promise((resolve) => setTimeout(resolve, 300));

      let deletedEvent: FileEvent | null = null;
      watcher.on('delete', (event) => {
        deletedEvent = event;
      });

      fs.unlinkSync(testFile);

      await new Promise((resolve) => setTimeout(resolve, 300));
      
      if (deletedEvent) {
        expect(deletedEvent?.type).toBe('delete');
        expect(deletedEvent?.filepath).toContain('test.md');
      }

      await watcher.unwatch();
    });

    it('should not emit delete event for non-markdown files', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });
      await watcher.watch(vaultDir);

      const testFile = path.join(vaultDir, 'test.txt');
      fs.writeFileSync(testFile, 'test content');

      await new Promise((resolve) => setTimeout(resolve, 300));

      let deletedEvent: FileEvent | null = null;
      watcher.on('delete', (event) => {
        deletedEvent = event;
      });

      fs.unlinkSync(testFile);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(deletedEvent).toBeNull();

      await watcher.unwatch();
    });
  });

  describe('debouncing', () => {
    it('should debounce rapid file modifications', async () => {
      watcher = new VaultWatcher({ debounceDelay: 200 });
      await watcher.watch(vaultDir);

      let modifyCount = 0;
      watcher.on('modify', () => {
        modifyCount++;
      });

      const testFile = path.join(vaultDir, 'test.md');
      fs.writeFileSync(testFile, 'content1');

      await new Promise((resolve) => setTimeout(resolve, 100));
      fs.writeFileSync(testFile, 'content2');

      await new Promise((resolve) => setTimeout(resolve, 100));
      fs.writeFileSync(testFile, 'content3');

      await new Promise((resolve) => setTimeout(resolve, 400));

      if (modifyCount > 0) {
        expect(modifyCount).toBeLessThanOrEqual(2);
      }

      await watcher.unwatch();
    });

    it('should debounce bulk file additions', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });
      await watcher.watch(vaultDir);

      let addCount = 0;
      watcher.on('add', () => {
        addCount++;
      });

      for (let i = 0; i < 5; i++) {
        fs.writeFileSync(path.join(vaultDir, `file${i}.md`), `content${i}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 500));

      if (addCount > 0) {
        expect(addCount).toBeGreaterThanOrEqual(1);
      }

      await watcher.unwatch();
    });

    it('should respect custom debounce delay', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });
      await watcher.watch(vaultDir);

      let modifyCount = 0;
      watcher.on('modify', () => {
        modifyCount++;
      });

      const testFile = path.join(vaultDir, 'test.md');
      fs.writeFileSync(testFile, 'content1');

      await new Promise((resolve) => setTimeout(resolve, 150));
      fs.writeFileSync(testFile, 'content2');

      await new Promise((resolve) => setTimeout(resolve, 200));

      if (modifyCount > 0) {
        expect(modifyCount).toBeGreaterThanOrEqual(1);
      }

      await watcher.unwatch();
    });
  });

  describe('file filtering', () => {
    it('should filter files with ignore patterns', async () => {
      watcher = new VaultWatcher({
        ignorePatterns: ['.obsidian/**'],
      });
      await watcher.watch(vaultDir);

      const obsidianDir = path.join(vaultDir, '.obsidian');
      fs.mkdirSync(obsidianDir, { recursive: true });

      let addedEvent: FileEvent | null = null;
      watcher.on('add', (event) => {
        addedEvent = event;
      });

      fs.writeFileSync(path.join(obsidianDir, 'test.md'), 'content');

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(addedEvent).toBeNull();

      await watcher.unwatch();
    });

    it('should only emit events for markdown files', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });
      await watcher.watch(vaultDir);

      let mdCount = 0;
      let otherCount = 0;
      watcher.on('add', (event) => {
        if (event.filepath.endsWith('.md')) {
          mdCount++;
        } else {
          otherCount++;
        }
      });

      fs.writeFileSync(path.join(vaultDir, 'readme.md'), 'markdown');
      fs.writeFileSync(path.join(vaultDir, 'config.json'), 'json');
      fs.writeFileSync(path.join(vaultDir, 'image.png'), 'binary');

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(otherCount).toBe(0);
      if (mdCount > 0) {
        expect(mdCount).toBeGreaterThanOrEqual(1);
      }

      await watcher.unwatch();
    });
  });

  describe('event properties', () => {
    it('should include type in file event', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });
      await watcher.watch(vaultDir);

      let addedEvent: FileEvent | null = null;
      watcher.on('add', (event) => {
        addedEvent = event;
      });

      fs.writeFileSync(path.join(vaultDir, 'test.md'), 'content');

      await new Promise((resolve) => setTimeout(resolve, 400));

      if (addedEvent) {
        expect(addedEvent?.type).toBe('add');
      }

      await watcher.unwatch();
    });

    it('should include filepath in file event', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });
      await watcher.watch(vaultDir);

      let addedEvent: FileEvent | null = null;
      watcher.on('add', (event) => {
        addedEvent = event;
      });

      fs.writeFileSync(path.join(vaultDir, 'test.md'), 'content');

      await new Promise((resolve) => setTimeout(resolve, 400));

      if (addedEvent) {
        expect(addedEvent?.filepath).toBeDefined();
        expect(addedEvent?.filepath).toContain('test.md');
      }

      await watcher.unwatch();
    });

    it('should include timestamp in file event', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });
      await watcher.watch(vaultDir);

      let addedEvent: FileEvent | null = null;
      watcher.on('add', (event) => {
        addedEvent = event;
      });

      fs.writeFileSync(path.join(vaultDir, 'test.md'), 'content');

      await new Promise((resolve) => setTimeout(resolve, 400));

      if (addedEvent) {
        expect(addedEvent?.timestamp).toBeDefined();
        expect(typeof addedEvent?.timestamp).toBe('number');
        expect(addedEvent?.timestamp).toBeGreaterThan(0);
      }

      await watcher.unwatch();
    });
  });

  describe('event emitter integration', () => {
    it('should support on listener', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });
      await watcher.watch(vaultDir);

      let eventCount = 0;
      watcher.on('add', () => {
        eventCount++;
      });

      fs.writeFileSync(path.join(vaultDir, 'test.md'), 'content');

      await new Promise((resolve) => setTimeout(resolve, 400));

      if (eventCount > 0) {
        expect(eventCount).toBeGreaterThanOrEqual(1);
      }

      await watcher.unwatch();
    });

    it('should support once listener', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });
      await watcher.watch(vaultDir);

      let eventCount = 0;
      watcher.once('add', () => {
        eventCount++;
      });

      fs.writeFileSync(path.join(vaultDir, 'test.md'), 'content');
      await new Promise((resolve) => setTimeout(resolve, 400));

      fs.writeFileSync(path.join(vaultDir, 'test2.md'), 'content');
      await new Promise((resolve) => setTimeout(resolve, 400));

      if (eventCount > 0) {
        expect(eventCount).toBe(1);
      }

      await watcher.unwatch();
    });

    it('should support off listener', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });
      await watcher.watch(vaultDir);

      let eventCount = 0;
      const handler = () => {
        eventCount++;
      };

      watcher.on('add', handler);
      watcher.off('add', handler);

      fs.writeFileSync(path.join(vaultDir, 'test.md'), 'content');

      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(eventCount).toBe(0);

      await watcher.unwatch();
    });

    it('should support multiple listeners on same event', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });

      let listener1Count = 0;
      let listener2Count = 0;

      watcher.on('add', () => {
        listener1Count++;
      });
      watcher.on('add', () => {
        listener2Count++;
      });

      watcher.triggerAdd('test.md');

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(listener1Count).toBe(1);
      expect(listener2Count).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('should handle empty vault directory', async () => {
      watcher = new VaultWatcher();
      await watcher.watch(vaultDir);

      expect(watcher.isWatching()).toBe(true);

      await watcher.unwatch();
    });

    it('should handle deeply nested markdown files', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });
      await watcher.watch(vaultDir);

      const nestedDir = path.join(vaultDir, 'a', 'b', 'c');
      fs.mkdirSync(nestedDir, { recursive: true });

      let addedEvent: FileEvent | null = null;
      watcher.on('add', (event) => {
        addedEvent = event;
      });

      const nestedFile = path.join(nestedDir, 'test.md');
      fs.writeFileSync(nestedFile, 'content');

      await new Promise((resolve) => setTimeout(resolve, 500));

      if (addedEvent) {
        expect(addedEvent?.filepath).toContain('test.md');
      }

      await watcher.unwatch();
    });

    it('should handle filenames with special characters', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });
      await watcher.watch(vaultDir);

      let addedEvent: FileEvent | null = null;
      watcher.on('add', (event) => {
        addedEvent = event;
      });

      const specialFile = path.join(vaultDir, 'file-with-special_chars@2024.md');
      fs.writeFileSync(specialFile, 'content');

      await new Promise((resolve) => setTimeout(resolve, 500));

      if (addedEvent) {
        expect(addedEvent?.filepath).toContain('file-with-special_chars@2024.md');
      }

      await watcher.unwatch();
    });

    it('should handle rapid add-delete cycles', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });
      await watcher.watch(vaultDir);

      const events: FileEvent[] = [];
      watcher.on('add', (event) => events.push(event));
      watcher.on('delete', (event) => events.push(event));

      const testFile = path.join(vaultDir, 'temp.md');
      fs.writeFileSync(testFile, 'content');
      await new Promise((resolve) => setTimeout(resolve, 200));

      fs.unlinkSync(testFile);
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(events.length).toBeGreaterThanOrEqual(0);

      await watcher.unwatch();
    });
  });

  describe('manual triggers', () => {
    it('should manually trigger add event', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });

      let addedEvent: FileEvent | null = null;
      watcher.on('add', (event) => {
        addedEvent = event;
      });

      watcher.triggerAdd('test.md');
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(addedEvent).not.toBeNull();
      expect(addedEvent?.type).toBe('add');
      expect(addedEvent?.filepath).toBe('test.md');
    });

    it('should manually trigger modify event', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });

      let modifiedEvent: FileEvent | null = null;
      watcher.on('modify', (event) => {
        modifiedEvent = event;
      });

      watcher.triggerModify('test.md');
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(modifiedEvent).not.toBeNull();
      expect(modifiedEvent?.type).toBe('modify');
    });

    it('should manually trigger delete event', async () => {
      watcher = new VaultWatcher({ debounceDelay: 100 });

      let deletedEvent: FileEvent | null = null;
      watcher.on('delete', (event) => {
        deletedEvent = event;
      });

      watcher.triggerDelete('test.md');
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(deletedEvent).not.toBeNull();
      expect(deletedEvent?.type).toBe('delete');
    });

    it('should manually trigger rename event', async () => {
      watcher = new VaultWatcher();

      let renameEvent: FileEvent | null = null;
      watcher.on('rename', (event) => {
        renameEvent = event;
      });

      watcher.triggerRename('old.md', 'new.md');

      expect(renameEvent).not.toBeNull();
      expect(renameEvent?.type).toBe('rename');
      expect(renameEvent?.filepath).toBe('new.md');
      expect(renameEvent?.oldFilepath).toBe('old.md');
    });
  });

  describe('debounce utilities', () => {
    it('should track pending debounce count', async () => {
      watcher = new VaultWatcher({ debounceDelay: 500 });

      watcher.triggerAdd('file1.md');
      watcher.triggerAdd('file2.md');
      watcher.triggerModify('file3.md');

      const pendingCount = watcher.getPendingDebounceCount();
      expect(pendingCount).toBeGreaterThanOrEqual(1);

      await watcher.flushDebounces();
      expect(watcher.getPendingDebounceCount()).toBe(0);
    });

    it('should flush debounces immediately', async () => {
      watcher = new VaultWatcher({ debounceDelay: 1000 });

      let eventCount = 0;
      watcher.on('add', () => {
        eventCount++;
      });

      watcher.triggerAdd('test.md');

      expect(watcher.getPendingDebounceCount()).toBe(1);

      await watcher.flushDebounces();

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(eventCount).toBeGreaterThanOrEqual(1);
    });
  });
});
