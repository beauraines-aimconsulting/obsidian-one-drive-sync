import { describe, it, expect, vi } from 'vitest';
import { GraphAuthProvider } from '../../src/graph/GraphAuthProvider.js';
import type { GraphAuthConfig } from '../../src/graph/types.js';

describe('GraphAuthProvider', () => {
  const testConfig: GraphAuthConfig = {
    clientId: 'test-client-id',
    tenantId: 'test-tenant-id',
  };

  it('should construct with valid config', () => {
    const provider = new GraphAuthProvider(testConfig);
    expect(provider).toBeDefined();
  });

  it('should return required scopes', () => {
    const provider = new GraphAuthProvider(testConfig);
    const scopes = provider.getRequiredScopes();

    expect(scopes).toContain('User.Read');
    expect(scopes).toContain('Files.ReadWrite');
  });

  it('should return config copy', () => {
    const provider = new GraphAuthProvider(testConfig);
    const config = provider.getConfig();

    expect(config.clientId).toBe('test-client-id');
    expect(config.tenantId).toBe('test-tenant-id');
    // Should be a copy, not same reference
    expect(config).not.toBe(testConfig);
  });

  it('should throw on authentication failure', async () => {
    const provider = new GraphAuthProvider(testConfig);

    // Device code flow requires network — will fail in test env
    await expect(
      provider.authenticate(['User.Read'], vi.fn())
    ).rejects.toThrow();
  });
});
