import { describe, it, expect } from 'vitest';
import { AdminConsentRequest } from '../../src/graph/AdminConsentRequest.js';
import type { GraphAuthConfig } from '../../src/graph/types.js';

describe('AdminConsentRequest', () => {
  const testConfig: GraphAuthConfig = {
    clientId: 'test-client-id-123',
    tenantId: 'test-tenant-id-456',
    redirectUri: 'http://localhost',
  };

  it('should generate a formatted request with all required fields', () => {
    const request = new AdminConsentRequest(testConfig);
    const output = request.generate();

    expect(output).toContain('ADMIN CONSENT REQUEST');
    expect(output).toContain('test-client-id-123');
    expect(output).toContain('test-tenant-id-456');
    expect(output).toContain('User.Read');
    expect(output).toContain('Files.ReadWrite');
    expect(output).toContain('Delegated');
  });

  it('should include admin consent URL with correct parameters', () => {
    const request = new AdminConsentRequest(testConfig);
    const output = request.generate();

    expect(output).toContain(
      'https://login.microsoftonline.com/test-tenant-id-456/adminconsent'
    );
    expect(output).toContain('client_id=test-client-id-123');
  });

  it('should include justifications for each permission', () => {
    const request = new AdminConsentRequest(testConfig);
    const output = request.generate();

    expect(output).toContain('Basic sign-in');
    expect(output).toContain("user's OneDrive files only");
  });

  it('should clarify scope limitations', () => {
    const request = new AdminConsentRequest(testConfig);
    const output = request.generate();

    expect(output).toContain('User-delegated only');
    expect(output).toContain('No application-level');
  });

  it('buildRequestData should return structured data', () => {
    const request = new AdminConsentRequest(testConfig);
    const data = request.buildRequestData();

    expect(data.appName).toBe('Obsidian OneDrive Sync');
    expect(data.clientId).toBe('test-client-id-123');
    expect(data.tenantId).toBe('test-tenant-id-456');
    expect(data.permissions).toHaveLength(2);
    expect(data.permissions[0].scope).toBe('User.Read');
    expect(data.permissions[1].scope).toBe('Files.ReadWrite');
    expect(data.adminConsentUrl).toContain('adminconsent');
  });
});
