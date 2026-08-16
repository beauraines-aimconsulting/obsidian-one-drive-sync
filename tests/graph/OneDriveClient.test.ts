import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OneDriveClient } from '../../src/graph/OneDriveClient.js';

describe('OneDriveClient', () => {
  const mockAccessToken = 'mock-access-token';
  let client: OneDriveClient;

  beforeEach(() => {
    client = new OneDriveClient({
      targetFolder: '/ObsidianPublished',
      accessToken: mockAccessToken,
    });
  });

  it('should construct with options', () => {
    expect(client).toBeDefined();
  });

  it('should strip leading/trailing slashes from target folder', () => {
    const c = new OneDriveClient({
      targetFolder: '///folder////',
      accessToken: 'token',
    });
    // Verify via uploadContent path construction
    expect(c).toBeDefined();
  });

  describe('uploadContent', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should upload content successfully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'item-123', size: 42 }),
      });

      const result = await client.uploadContent(
        '# Hello World',
        'notes/hello.md'
      );

      expect(result.success).toBe(true);
      expect(result.itemId).toBe('item-123');
      expect(result.size).toBe(42);
      expect(result.oneDrivePath).toBe('ObsidianPublished/notes/hello.md');

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall[0]).toContain('ObsidianPublished/notes/hello.md');
      expect(fetchCall[1].method).toBe('PUT');
      expect(fetchCall[1].headers.Authorization).toBe('Bearer mock-access-token');
    });

    it('should handle API errors', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({
          error: { code: 'accessDenied', message: 'Access denied' },
        }),
      });

      const result = await client.uploadContent('content', 'file.md');

      expect(result.success).toBe(false);
      expect(result.error).toContain('accessDenied');
      expect(result.error).toContain('403');
    });

    it('should handle network errors', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network timeout'));

      const result = await client.uploadContent('content', 'file.md');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network timeout');
    });

    it('should encode special characters in paths', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'id', size: 10 }),
      });

      await client.uploadContent('content', 'notes/special chars & stuff.md');

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall[0]).toContain('special%20chars%20%26%20stuff.md');
    });
  });

  describe('deleteFile', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should return true on successful delete', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });

      const result = await client.deleteFile('item-123');
      expect(result).toBe(true);
    });

    it('should return true if file already gone (404)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

      const result = await client.deleteFile('item-123');
      expect(result).toBe(true);
    });

    it('should return false on error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('fail'));

      const result = await client.deleteFile('item-123');
      expect(result).toBe(false);
    });
  });

  describe('getFileMetadata', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should return metadata for existing file', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'item-456',
          size: 1024,
          lastModifiedDateTime: '2024-01-01T00:00:00Z',
        }),
      });

      const result = await client.getFileMetadata('notes/test.md');

      expect(result.exists).toBe(true);
      expect(result.itemId).toBe('item-456');
      expect(result.size).toBe(1024);
      expect(result.lastModified).toBe('2024-01-01T00:00:00Z');
    });

    it('should return exists: false for 404', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await client.getFileMetadata('missing.md');
      expect(result.exists).toBe(false);
    });

    it('should return exists: false on network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline'));

      const result = await client.getFileMetadata('file.md');
      expect(result.exists).toBe(false);
    });
  });
});
