import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphProbe } from '../../src/graph/GraphProbe.js';
import { GraphAuthProvider } from '../../src/graph/GraphAuthProvider.js';
import type { GraphAuthConfig } from '../../src/graph/types.js';

describe('GraphProbe', () => {
  const testConfig: GraphAuthConfig = {
    clientId: 'test-client-id',
    tenantId: 'test-tenant-id',
  };

  let authProvider: GraphAuthProvider;
  let probe: GraphProbe;

  beforeEach(() => {
    authProvider = new GraphAuthProvider(testConfig);
    probe = new GraphProbe(authProvider);
  });

  it('should construct with auth provider', () => {
    expect(probe).toBeDefined();
  });

  it('should generate admin consent request', () => {
    const request = probe.generateAdminConsentRequest();
    expect(request).toContain('ADMIN CONSENT REQUEST');
    expect(request).toContain('test-client-id');
  });

  it('should report auth failure when authentication fails', async () => {
    // Auth will fail since there's no real tenant
    const report = await probe.runAll(vi.fn());

    expect(report.timestamp).toBeDefined();
    expect(report.authentication.success).toBe(false);
    expect(report.authentication.method).toBe('device-code');
    expect(report.authentication.error).toBeDefined();
  });

  it('probeUserProfile should fail without valid token', async () => {
    const result = await probe.probeUserProfile('invalid-token');
    expect(result.success).toBe(false);
    expect(result.endpoint).toContain('User Profile');
  });

  it('probeOneDriveRoot should fail without valid token', async () => {
    const result = await probe.probeOneDriveRoot('invalid-token');
    expect(result.success).toBe(false);
    expect(result.endpoint).toContain('OneDrive Root');
  });

  it('probeOneDriveWrite should fail without valid token', async () => {
    const result = await probe.probeOneDriveWrite('invalid-token');
    expect(result.success).toBe(false);
    expect(result.endpoint).toContain('OneDrive Write');
  });
});
