import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SyncStateStore } from '../../src/graph/SyncStateStore.js';

describe('SyncStateStore', () => {
  let testDir: string;
  let store: SyncStateStore;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `sync-state-test-${Date.now()}`);
    store = new SyncStateStore(testDir);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  it('should create state directory', () => {
    expect(fs.existsSync(testDir)).toBe(true);
  });

  it('should start with empty state', () => {
    expect(store.getCount()).toBe(0);
    expect(store.getAllTrackedFiles()).toEqual([]);
    expect(store.getLastSyncAt()).toBe(null);
  });

  it('should detect new files as changed', () => {
    expect(store.hasChanged('notes/new.md', '# Hello')).toBe(true);
  });

  it('should mark files as synced', () => {
    store.markSynced('notes/test.md', '# Content', 'item-123', 'Published/notes/test.md');

    const entry = store.getEntry('notes/test.md');
    expect(entry).toBeDefined();
    expect(entry!.oneDriveItemId).toBe('item-123');
    expect(entry!.oneDrivePath).toBe('Published/notes/test.md');
    expect(entry!.lastSyncedAt).toBeDefined();
    expect(entry!.size).toBe(Buffer.byteLength('# Content', 'utf-8'));
  });

  it('should detect unchanged files', () => {
    store.markSynced('file.md', 'content', 'id', 'path');
    expect(store.hasChanged('file.md', 'content')).toBe(false);
  });

  it('should detect changed files', () => {
    store.markSynced('file.md', 'old content', 'id', 'path');
    expect(store.hasChanged('file.md', 'new content')).toBe(true);
  });

  it('should remove entries', () => {
    store.markSynced('file.md', 'content', 'item-1', 'path');
    expect(store.getCount()).toBe(1);

    const removed = store.removeEntry('file.md');
    expect(removed).toBeDefined();
    expect(removed!.oneDriveItemId).toBe('item-1');
    expect(store.getCount()).toBe(0);
  });

  it('should return undefined for non-existent entries', () => {
    expect(store.getEntry('missing.md')).toBeUndefined();
    expect(store.removeEntry('missing.md')).toBeUndefined();
  });

  it('should persist state across instances', () => {
    store.markSynced('file.md', 'content', 'item-1', 'path');

    // Create new instance reading same file
    const store2 = new SyncStateStore(testDir);
    expect(store2.getCount()).toBe(1);
    expect(store2.getEntry('file.md')!.oneDriveItemId).toBe('item-1');
  });

  it('should track multiple files', () => {
    store.markSynced('a.md', 'aaa', 'id-a', 'path-a');
    store.markSynced('b.md', 'bbb', 'id-b', 'path-b');
    store.markSynced('c.md', 'ccc', 'id-c', 'path-c');

    expect(store.getCount()).toBe(3);
    expect(store.getAllTrackedFiles()).toContain('a.md');
    expect(store.getAllTrackedFiles()).toContain('b.md');
    expect(store.getAllTrackedFiles()).toContain('c.md');
  });

  it('should reset all state', () => {
    store.markSynced('a.md', 'aaa', 'id-a', 'path-a');
    store.markSynced('b.md', 'bbb', 'id-b', 'path-b');

    store.reset();
    expect(store.getCount()).toBe(0);
    expect(store.getLastSyncAt()).toBe(null);
  });

  it('should update lastSyncAt on markSynced', () => {
    expect(store.getLastSyncAt()).toBe(null);
    store.markSynced('file.md', 'content', 'id', 'path');
    expect(store.getLastSyncAt()).not.toBe(null);
  });

  it('should produce consistent hashes', () => {
    const hash1 = store.hashContent('hello world');
    const hash2 = store.hashContent('hello world');
    const hash3 = store.hashContent('different');

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  it('should set restrictive file permissions on state file', () => {
    store.markSynced('file.md', 'content', 'id', 'path');

    const stats = fs.statSync(store.getStatePath());
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('should handle corrupted state file gracefully', () => {
    fs.writeFileSync(path.join(testDir, 'sync-state.json'), 'not valid json');

    const store2 = new SyncStateStore(testDir);
    expect(store2.getCount()).toBe(0);
  });
});
