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
    expect(result.parseErrors).toHaveLength(0);
  });

  it('should report files with malformed frontmatter separately from uploads', async () => {
    createVaultFile('notes/good.md', '---\npublish: true\n---\n# Good');
    createVaultFile(
      'Templates/Daily Note.md',
      '---\ncreated: {{date}} {{time}}:00\nTQ_show: false\n---\n# Daily'
    );

    const messages: string[] = [];
    const service = createSyncService({ dryRun: true });
    const result = await service.sync((msg) => messages.push(msg));

    // The broken file is excluded from the sync rather than uploaded blindly.
    expect(result.totalEligible).toBe(1);
    expect(result.uploaded).toEqual(['notes/good.md']);

    expect(result.parseErrors).toHaveLength(1);
    expect(result.parseErrors[0].filepath).toBe('Templates/Daily Note.md');
    expect(result.parseErrors[0].reason).toContain('Frontmatter parse error');
    expect(messages.some((m) => m.includes('Templates/Daily Note.md'))).toBe(true);
  });

  it('should not delete an already-synced file when its frontmatter breaks', async () => {
    // Publish the file cleanly first so it is tracked in sync state.
    createVaultFile('notes/note.md', '---\npublish: true\n---\n# Note');

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'item-1', size: 10 }),
    });

    const service = createSyncService();
    const first = await service.sync();
    expect(first.uploaded).toEqual(['notes/note.md']);

    // Now break the frontmatter, as an unrendered template placeholder would.
    createVaultFile('notes/note.md', '---\ncreated: {{date}} {{time}}:00\nx: 1\n---\n# Note');

    const deleteCalls: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') deleteCalls.push(String(url));
      return Promise.resolve({ ok: true, json: async () => ({ id: 'item-1', size: 10 }) });
    }) as unknown as typeof globalThis.fetch;

    const second = await service.sync();

    // The last good version must stay published — a YAML typo is not a request
    // to unpublish.
    expect(deleteCalls).toEqual([]);
    expect(second.removed).toEqual([]);
    expect(second.parseErrors).toHaveLength(1);
  });

  it('should ignore, not remove, a watched file whose frontmatter breaks', async () => {
    createVaultFile('notes/note.md', '---\npublish: true\n---\n# Note');

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'item-1', size: 10 }),
    });

    const service = createSyncService();
    await service.sync();

    createVaultFile('notes/note.md', '---\ncreated: {{date}} {{time}}:00\nx: 1\n---\n# Note');

    const result = await service.syncFile('notes/note.md');

    expect(result.action).toBe('ignored');
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
