import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SyncService } from '../../src/graph/SyncService.js';
import { PublicationService } from '../../src/publications/PublicationService.js';
import { GraphAuthProvider } from '../../src/graph/GraphAuthProvider.js';
import { SyncStateStore } from '../../src/graph/SyncStateStore.js';

describe('SyncService', () => {
  let tempVault: string;
  let tempStateDir: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    tempVault = path.join(os.tmpdir(), `sync-vault-${Date.now()}`);
    tempStateDir = path.join(os.tmpdir(), `sync-state-${Date.now()}`);
    fs.mkdirSync(tempVault, { recursive: true });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (fs.existsSync(tempVault)) fs.rmSync(tempVault, { recursive: true });
    if (fs.existsSync(tempStateDir)) fs.rmSync(tempStateDir, { recursive: true });
  });

  function createVaultFile(relativePath: string, content: string): void {
    const fullPath = path.join(tempVault, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  function createSyncService(opts?: { forceSync?: boolean; dryRun?: boolean }) {
    const pubService = new PublicationService({
      enableCache: false,
      composition: 'OR',
      logLevel: 'error',
    });

    const authProvider = new GraphAuthProvider(
      { clientId: 'test', tenantId: 'test' },
      { enableCache: false }
    );

    // Mock getToken to return a fake token
    vi.spyOn(authProvider, 'getToken').mockResolvedValue('mock-token');

    const syncState = new SyncStateStore(tempStateDir);

    return new SyncService(pubService, authProvider, syncState, {
      vaultPath: tempVault,
      targetFolder: 'TestPublished',
      forceSync: opts?.forceSync ?? false,
      dryRun: opts?.dryRun ?? false,
    });
  }

  it('should sync eligible files with dry-run', async () => {
    createVaultFile('notes/test.md', '---\npublish: true\n---\n# Test');

    const service = createSyncService({ dryRun: true });
    const result = await service.sync();

    // With no rules configured, all files pass in OR mode
    expect(result.totalEligible).toBe(1);
    expect(result.uploaded).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
  });

  it('should upload files to OneDrive', async () => {
    createVaultFile('hello.md', '# Hello');

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'item-new', size: 7 }),
    });

    const service = createSyncService();
    const result = await service.sync();

    expect(result.uploaded).toContain('hello.md');
    expect(result.totalEligible).toBe(1);
  });

  it('should skip unchanged files', async () => {
    createVaultFile('cached.md', '# Cached');

    // Pre-populate sync state
    const syncState = new SyncStateStore(tempStateDir);
    syncState.markSynced('cached.md', '# Cached', 'existing-id', 'TestPublished/cached.md');

    globalThis.fetch = vi.fn();

    const pubService = new PublicationService({
      enableCache: false,
      composition: 'OR',
      logLevel: 'error',
    });
    const authProvider = new GraphAuthProvider(
      { clientId: 'test', tenantId: 'test' },
      { enableCache: false }
    );
    vi.spyOn(authProvider, 'getToken').mockResolvedValue('mock-token');

    const service = new SyncService(pubService, authProvider, syncState, {
      vaultPath: tempVault,
      targetFolder: 'TestPublished',
    });

    const result = await service.sync();

    expect(result.skipped).toContain('cached.md');
    expect(result.uploaded).toHaveLength(0);
    // fetch should not have been called for upload
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('should force re-upload with forceSync', async () => {
    createVaultFile('cached.md', '# Cached');

    const syncState = new SyncStateStore(tempStateDir);
    syncState.markSynced('cached.md', '# Cached', 'existing-id', 'TestPublished/cached.md');

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'item-updated', size: 8 }),
    });

    const pubService = new PublicationService({
      enableCache: false,
      composition: 'OR',
      logLevel: 'error',
    });
    const authProvider = new GraphAuthProvider(
      { clientId: 'test', tenantId: 'test' },
      { enableCache: false }
    );
    vi.spyOn(authProvider, 'getToken').mockResolvedValue('mock-token');

    const service = new SyncService(pubService, authProvider, syncState, {
      vaultPath: tempVault,
      targetFolder: 'TestPublished',
      forceSync: true,
    });

    const result = await service.sync();

    expect(result.uploaded).toContain('cached.md');
    expect(result.skipped).toHaveLength(0);
  });

  it('should handle upload failures gracefully', async () => {
    createVaultFile('fail.md', '# Fail');

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: { code: 'serverError', message: 'Internal' } }),
    });

    const service = createSyncService();
    const result = await service.sync();

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].filepath).toBe('fail.md');
    expect(result.failed[0].error).toContain('serverError');
  });

  it('should handle empty vault', async () => {
    const service = createSyncService({ dryRun: true });
    const result = await service.sync();

    expect(result.totalEligible).toBe(0);
    expect(result.uploaded).toHaveLength(0);
  });

  describe('syncFile', () => {
    it('uploads a single eligible file', async () => {
      createVaultFile('AIM/note.md', '# Note');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'item-1', size: 6 }),
      });

      const service = createSyncService();
      const result = await service.syncFile('AIM/note.md');

      expect(result.action).toBe('uploaded');
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    it('skips a file whose content is unchanged', async () => {
      createVaultFile('AIM/note.md', '# Note');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'item-1', size: 6 }),
      });

      const service = createSyncService();
      await service.syncFile('AIM/note.md');
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();

      const second = await service.syncFile('AIM/note.md');

      expect(second.action).toBe('skipped');
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('removes a previously synced file that was deleted from the vault', async () => {
      createVaultFile('AIM/gone.md', '# Gone');

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'item-gone', size: 6 }),
      });

      const service = createSyncService();
      await service.syncFile('AIM/gone.md');

      fs.rmSync(path.join(tempVault, 'AIM/gone.md'));
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });

      const result = await service.syncFile('AIM/gone.md');

      expect(result.action).toBe('removed');
    });

    it('ignores a deleted file that was never synced', async () => {
      globalThis.fetch = vi.fn();

      const service = createSyncService();
      const result = await service.syncFile('AIM/never-existed.md');

      expect(result.action).toBe('ignored');
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('reports failure instead of throwing when upload fails', async () => {
      createVaultFile('AIM/bad.md', '# Bad');

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));

      const service = createSyncService();
      const result = await service.syncFile('AIM/bad.md');

      expect(result.action).toBe('failed');
      expect(result.error).toContain('network down');
    });

    it('does not upload in dry-run mode', async () => {
      createVaultFile('AIM/note.md', '# Note');
      globalThis.fetch = vi.fn();

      const service = createSyncService({ dryRun: true });
      const result = await service.syncFile('AIM/note.md');

      expect(result.action).toBe('uploaded');
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });
});
