/**
 * Generates a formatted admin consent request for IT administrators.
 */

import type { AdminConsentRequestData, GraphAuthConfig } from './types.js';

const REQUIRED_PERMISSIONS: AdminConsentRequestData['permissions'] = [
  {
    scope: 'User.Read',
    type: 'Delegated',
    justification:
      'Basic sign-in and user profile reading. Required for authentication.',
    required: true,
  },
  {
    scope: 'Files.ReadWrite',
    type: 'Delegated',
    justification:
      "Read and write access to the authenticated user's OneDrive files only. Used to publish selected Obsidian vault notes to a designated OneDrive folder. Does NOT access other users' files.",
    required: true,
  },
];

export class AdminConsentRequest {
  private config: GraphAuthConfig;

  constructor(config: GraphAuthConfig) {
    this.config = config;
  }

  /**
   * Generate a formatted admin consent request document.
   */
  generate(): string {
    const data = this.buildRequestData();
    return this.formatRequest(data);
  }

  /**
   * Get the structured request data.
   */
  buildRequestData(): AdminConsentRequestData {
    const adminConsentUrl =
      `https://login.microsoftonline.com/${this.config.tenantId}/adminconsent` +
      `?client_id=${this.config.clientId}` +
      `&redirect_uri=${encodeURIComponent(this.config.redirectUri ?? 'http://localhost')}` +
      `&scope=${REQUIRED_PERMISSIONS.map((p) => p.scope).join(' ')}`;

    return {
      appName: 'Obsidian OneDrive Sync',
      clientId: this.config.clientId,
      tenantId: this.config.tenantId,
      permissions: REQUIRED_PERMISSIONS,
      adminConsentUrl,
    };
  }

  private formatRequest(data: AdminConsentRequestData): string {
    const lines: string[] = [
      '═══════════════════════════════════════════════════════════════',
      '  ADMIN CONSENT REQUEST — Obsidian OneDrive Sync',
      '═══════════════════════════════════════════════════════════════',
      '',
      'Application Details:',
      `  Name:      ${data.appName}`,
      `  Client ID: ${data.clientId}`,
      `  Tenant ID: ${data.tenantId}`,
      '',
      'Requested Permissions:',
      '',
    ];

    for (const perm of data.permissions) {
      lines.push(`  ● ${perm.scope} (${perm.type})`);
      lines.push(`    Justification: ${perm.justification}`);
      lines.push('');
    }

    lines.push('Scope of Access:');
    lines.push(
      '  • User-delegated only — accesses ONLY the signed-in user\'s OneDrive'
    );
    lines.push('  • No application-level (daemon) permissions requested');
    lines.push(
      '  • No access to other users\' files, email, calendar, or Teams'
    );
    lines.push('');
    lines.push('Admin Consent URL:');
    lines.push(`  ${data.adminConsentUrl}`);
    lines.push('');
    lines.push('───────────────────────────────────────────────────────────────');
    lines.push(
      'To grant consent, an Azure AD admin can visit the URL above,'
    );
    lines.push('or navigate to:');
    lines.push(
      '  Azure Portal → Azure Active Directory → Enterprise Applications'
    );
    lines.push(`  → Search for Client ID: ${data.clientId}`);
    lines.push('  → Permissions → Grant admin consent');
    lines.push('───────────────────────────────────────────────────────────────');

    return lines.join('\n');
  }
}
