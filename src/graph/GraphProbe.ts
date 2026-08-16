/**
 * Microsoft Graph API connectivity probe.
 * Tests authentication and OneDrive read/write permissions.
 */

import type { ProbeResult, ProbeReport } from './types.js';
import { GraphAuthProvider } from './GraphAuthProvider.js';
import { AdminConsentRequest } from './AdminConsentRequest.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export class GraphProbe {
  private authProvider: GraphAuthProvider;

  constructor(authProvider: GraphAuthProvider) {
    this.authProvider = authProvider;
  }

  /**
   * Run all probe checks and return a full report.
   */
  async runAll(
    onDeviceCode?: (message: string) => void
  ): Promise<ProbeReport> {
    const report: ProbeReport = {
      timestamp: new Date().toISOString(),
      authentication: {
        success: false,
        method: 'device-code',
        scopes: [],
      },
      permissions: [],
      summary: {
        allPassed: false,
        passed: [],
        failed: [],
        adminConsentRequired: false,
      },
    };

    // Step 1: Authenticate
    try {
      const token = await this.authProvider.authenticate(
        this.authProvider.getRequiredScopes(),
        onDeviceCode
      );
      report.authentication.success = true;
      report.authentication.scopes = token.scopes;
    } catch (error) {
      report.authentication.success = false;
      report.authentication.error =
        error instanceof Error ? error.message : String(error);
      report.summary.adminConsentRequired =
        report.authentication.error.includes('AADSTS65001') ||
        report.authentication.error.includes('consent');
      return report;
    }

    // Step 2: Test endpoints
    const accessToken = await this.authProvider.getToken();

    const probeChecks = [
      { name: 'User Profile', fn: () => this.probeUserProfile(accessToken) },
      { name: 'OneDrive Root', fn: () => this.probeOneDriveRoot(accessToken) },
      {
        name: 'OneDrive Write',
        fn: () => this.probeOneDriveWrite(accessToken),
      },
    ];

    for (const check of probeChecks) {
      const result = await check.fn();
      report.permissions.push(result);

      if (result.success) {
        report.summary.passed.push(check.name);
      } else {
        report.summary.failed.push(check.name);
        if (
          result.statusCode === 403 ||
          result.error?.includes('Authorization_RequestDenied')
        ) {
          report.summary.adminConsentRequired = true;
        }
      }
    }

    report.summary.allPassed = report.summary.failed.length === 0;
    return report;
  }

  /**
   * Test GET /me — basic user profile access (User.Read).
   */
  async probeUserProfile(accessToken: string): Promise<ProbeResult> {
    return this.fetchEndpoint(accessToken, '/me', 'User Profile (User.Read)');
  }

  /**
   * Test GET /me/drive/root — OneDrive root access (Files.ReadWrite).
   */
  async probeOneDriveRoot(accessToken: string): Promise<ProbeResult> {
    return this.fetchEndpoint(
      accessToken,
      '/me/drive/root',
      'OneDrive Root (Files.ReadWrite)'
    );
  }

  /**
   * Test PUT a small file to OneDrive to confirm write access.
   * Creates and immediately deletes a probe file.
   */
  async probeOneDriveWrite(accessToken: string): Promise<ProbeResult> {
    const probePath =
      '/me/drive/root:/obsidian-sync-probe-test.txt:/content';
    const endpoint = `${GRAPH_BASE}${probePath}`;

    try {
      // Write a small test file
      const writeResponse = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'text/plain',
        },
        body: 'obsidian-sync probe test - safe to delete',
      });

      if (!writeResponse.ok) {
        const errorBody = await writeResponse.text();
        return {
          success: false,
          endpoint: 'OneDrive Write (Files.ReadWrite)',
          statusCode: writeResponse.status,
          error: this.parseGraphError(errorBody),
        };
      }

      const writeData = (await writeResponse.json()) as Record<
        string,
        unknown
      >;

      // Clean up: delete the probe file
      const itemId = writeData.id as string;
      if (itemId) {
        await fetch(`${GRAPH_BASE}/me/drive/items/${itemId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      }

      return {
        success: true,
        endpoint: 'OneDrive Write (Files.ReadWrite)',
        statusCode: writeResponse.status,
        data: { itemId, deleted: true },
      };
    } catch (error) {
      return {
        success: false,
        endpoint: 'OneDrive Write (Files.ReadWrite)',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate an admin consent request if permissions are blocked.
   */
  generateAdminConsentRequest(): string {
    const config = this.authProvider.getConfig();
    const request = new AdminConsentRequest(config);
    return request.generate();
  }

  private async fetchEndpoint(
    accessToken: string,
    path: string,
    label: string
  ): Promise<ProbeResult> {
    const url = `${GRAPH_BASE}${path}`;

    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          endpoint: label,
          statusCode: response.status,
          error: this.parseGraphError(errorBody),
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      return {
        success: true,
        endpoint: label,
        statusCode: response.status,
        data: { id: data.id, displayName: data.displayName },
      };
    } catch (error) {
      return {
        success: false,
        endpoint: label,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private parseGraphError(body: string): string {
    try {
      const parsed = JSON.parse(body) as {
        error?: { code?: string; message?: string };
      };
      if (parsed.error) {
        return `${parsed.error.code}: ${parsed.error.message}`;
      }
    } catch {
      // Not JSON
    }
    return body.slice(0, 200);
  }
}
