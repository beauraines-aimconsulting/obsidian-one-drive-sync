/**
 * Microsoft Graph authentication provider using MSAL device-code flow.
 * Device-code flow is ideal for CLI tools — user authenticates in a browser.
 */

import {
  PublicClientApplication,
  DeviceCodeRequest,
  AuthenticationResult,
  Configuration,
} from '@azure/msal-node';
import type { GraphAuthConfig, TokenResult } from './types.js';

const DEFAULT_SCOPES = ['User.Read', 'Files.ReadWrite'];

export class GraphAuthProvider {
  private msalClient: PublicClientApplication;
  private config: GraphAuthConfig;
  private cachedToken: AuthenticationResult | null = null;

  constructor(config: GraphAuthConfig) {
    this.config = config;

    const msalConfig: Configuration = {
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
      },
    };

    this.msalClient = new PublicClientApplication(msalConfig);
  }

  /**
   * Authenticate using device-code flow.
   * Prints a URL and code for the user to enter in their browser.
   */
  async authenticate(
    scopes: string[] = DEFAULT_SCOPES,
    onDeviceCode?: (message: string) => void
  ): Promise<TokenResult> {
    const deviceCodeRequest: DeviceCodeRequest = {
      scopes,
      deviceCodeCallback: (response) => {
        const message = response.message;
        if (onDeviceCode) {
          onDeviceCode(message);
        } else {
          console.log('\n' + message + '\n');
        }
      },
    };

    try {
      const result = await this.msalClient.acquireTokenByDeviceCode(
        deviceCodeRequest
      );

      if (!result) {
        throw new Error('Authentication failed: no result returned');
      }

      this.cachedToken = result;

      return {
        accessToken: result.accessToken,
        expiresOn: result.expiresOn ?? new Date(Date.now() + 3600_000),
        scopes: result.scopes,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Authentication failed: ${message}`);
    }
  }

  /**
   * Get a valid access token, using cache if available and not expired.
   */
  async getToken(scopes: string[] = DEFAULT_SCOPES): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresOn) {
      const now = new Date();
      if (this.cachedToken.expiresOn > now) {
        return this.cachedToken.accessToken;
      }
    }

    // Try silent acquisition first
    const accounts = await this.msalClient.getTokenCache().getAllAccounts();
    if (accounts.length > 0) {
      try {
        const silentResult = await this.msalClient.acquireTokenSilent({
          account: accounts[0],
          scopes,
        });
        if (silentResult) {
          this.cachedToken = silentResult;
          return silentResult.accessToken;
        }
      } catch {
        // Silent acquisition failed, need interactive
      }
    }

    const result = await this.authenticate(scopes);
    return result.accessToken;
  }

  /**
   * Get the configured scopes needed for OneDrive operations.
   */
  getRequiredScopes(): string[] {
    return [...DEFAULT_SCOPES];
  }

  /**
   * Get the auth config for admin consent URL generation.
   */
  getConfig(): GraphAuthConfig {
    return { ...this.config };
  }
}
