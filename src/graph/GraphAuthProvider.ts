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
import type {
  AuthStatusSnapshot,
  DeviceCodeFlowStartResult,
  DeviceCodeFlowState,
  GraphAuthConfig,
  TokenResult,
} from './types.js';
import { FileCachePlugin } from './FileCachePlugin.js';

const DEFAULT_SCOPES = ['User.Read', 'Files.ReadWrite'];

// Azure CLI well-known client ID — works in most tenants without app registration
const AZURE_CLI_CLIENT_ID = '04b07795-8dde-4d83-8aab-9804e8457b65';

interface PendingDeviceCodeFlow {
  id: number;
  request: DeviceCodeRequest;
  startedAt: string;
  expiresAt: string;
  timer: ReturnType<typeof setTimeout>;
  onSuccess?: () => void;
}

export class DeviceCodeFlowConflictError extends Error {}

export class GraphAuthProvider {
  private msalClient: PublicClientApplication;
  private config: GraphAuthConfig;
  private cachedToken: AuthenticationResult | null = null;
  private cachePlugin: FileCachePlugin | null = null;
  private pendingDeviceCodeFlow: PendingDeviceCodeFlow | null = null;
  private lastFlowState: DeviceCodeFlowState = 'idle';
  private lastFlowStartedAt: string | null = null;
  private lastFlowCompletedAt: string | null = null;
  private flowSequence = 0;
  private cancelledFlowIds = new Set<number>();

  constructor(config: GraphAuthConfig, options?: { enableCache?: boolean; cacheDir?: string }) {
    this.config = config;
    const enableCache = options?.enableCache ?? true;

    const msalConfig: Configuration = {
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
      },
    };

    if (enableCache) {
      this.cachePlugin = new FileCachePlugin(options?.cacheDir);
      msalConfig.cache = { cachePlugin: this.cachePlugin };
    }

    this.msalClient = new PublicClientApplication(msalConfig);
  }

  /**
   * Create a provider using the Azure CLI well-known client ID.
   */
  static withAzureCliCredentials(tenantId: string): GraphAuthProvider {
    return new GraphAuthProvider({
      clientId: AZURE_CLI_CLIENT_ID,
      tenantId,
    });
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

  async startDeviceCodeFlow(options?: {
    scopes?: string[];
    onSuccess?: () => void;
  }): Promise<DeviceCodeFlowStartResult> {
    if (this.pendingDeviceCodeFlow) {
      throw new DeviceCodeFlowConflictError('A device-code sign-in is already pending');
    }

    const flowId = ++this.flowSequence;
    const startedAt = new Date().toISOString();
    const scopes = options?.scopes ?? DEFAULT_SCOPES;
    let started = false;

    this.lastFlowState = 'pending';
    this.lastFlowStartedAt = startedAt;
    this.lastFlowCompletedAt = null;

    return await new Promise<DeviceCodeFlowStartResult>((resolve, reject) => {
      const request: DeviceCodeRequest = {
        scopes,
        cancel: false,
        deviceCodeCallback: (deviceCode) => {
          if (started) {
            return;
          }
          started = true;
          const expiresAt = new Date(Date.now() + deviceCode.expiresIn * 1000).toISOString();
          const timer = globalThis.setTimeout(() => {
            this.timeoutDeviceCodeFlow(flowId);
          }, deviceCode.expiresIn * 1000);

          this.pendingDeviceCodeFlow = {
            id: flowId,
            request,
            startedAt,
            expiresAt,
            timer,
            ...(options?.onSuccess ? { onSuccess: options.onSuccess } : {}),
          };

          resolve({
            userCode: deviceCode.userCode,
            verificationUri: deviceCode.verificationUri,
            expiresAt,
          });
        },
      };

      void this.msalClient
        .acquireTokenByDeviceCode(request)
        .then((result) => {
          if (!result) {
            throw new Error('Authentication failed: no result returned');
          }

          this.cachedToken = result;
          if (this.cancelledFlowIds.delete(flowId)) {
            this.cachedToken = null;
            this.cachePlugin?.clearCache();
            return;
          }

          const pending = this.pendingDeviceCodeFlow;
          if (!pending || pending.id !== flowId) {
            return;
          }

          pending.onSuccess?.();
          this.completeDeviceCodeFlow(flowId, 'succeeded');
        })
        .catch((error: unknown) => {
          if (this.cancelledFlowIds.delete(flowId)) {
            return;
          }
          const pending = this.pendingDeviceCodeFlow;
          if (!pending || pending.id !== flowId) {
            if (!started) {
              this.lastFlowState = 'failed';
              this.lastFlowCompletedAt = new Date().toISOString();
            }
            return;
          }

          this.completeDeviceCodeFlow(flowId, 'failed');
          if (!started) {
            const message = error instanceof Error ? error.message : String(error);
            reject(new Error(`Authentication failed: ${message}`));
          }
        });
    });
  }

  getAuthStatus(): AuthStatusSnapshot {
    const cachedTokenStatus = this.readCachedTokenStatus();
    const pending = this.pendingDeviceCodeFlow;

    return {
      hasCachedToken: cachedTokenStatus.hasCachedToken,
      tokenExpiresAt: cachedTokenStatus.expiresAt,
      flowState: pending ? 'pending' : this.lastFlowState,
      flowPending: pending !== null,
      flowStartedAt: pending?.startedAt ?? this.lastFlowStartedAt,
      flowExpiresAt: pending?.expiresAt ?? null,
      flowCompletedAt: pending ? null : this.lastFlowCompletedAt,
    };
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

  /**
   * Clear cached tokens (logout).
   */
  logout(): void {
    this.cancelPendingDeviceCodeFlow('cancelled');
    this.cachedToken = null;
    if (this.cachePlugin) {
      this.cachePlugin.clearCache();
    }
  }

  /**
   * Check if there are cached tokens available.
   */
  hasCachedTokens(): boolean {
    return this.cachePlugin?.hasCachedTokens() ?? false;
  }

  private timeoutDeviceCodeFlow(flowId: number): void {
    const pending = this.pendingDeviceCodeFlow;
    if (!pending || pending.id !== flowId) {
      return;
    }

    pending.request.cancel = true;
    this.cancelledFlowIds.add(flowId);
    this.completeDeviceCodeFlow(flowId, 'timed_out');
  }

  private cancelPendingDeviceCodeFlow(state: Extract<DeviceCodeFlowState, 'cancelled'>): void {
    const pending = this.pendingDeviceCodeFlow;
    if (!pending) {
      return;
    }

    pending.request.cancel = true;
    this.cancelledFlowIds.add(pending.id);
    this.completeDeviceCodeFlow(pending.id, state);
  }

  private completeDeviceCodeFlow(flowId: number, state: Exclude<DeviceCodeFlowState, 'idle'>): void {
    const pending = this.pendingDeviceCodeFlow;
    if (!pending || pending.id !== flowId) {
      return;
    }

    globalThis.clearTimeout(pending.timer);
    this.pendingDeviceCodeFlow = null;
    this.lastFlowState = state;
    this.lastFlowStartedAt = pending.startedAt;
    this.lastFlowCompletedAt = new Date().toISOString();
  }

  private readCachedTokenStatus(): { hasCachedToken: boolean; expiresAt: string | null } {
    if (this.cachedToken?.expiresOn) {
      return {
        hasCachedToken: true,
        expiresAt: this.cachedToken.expiresOn.toISOString(),
      };
    }

    return this.cachePlugin?.getCachedTokenStatus() ?? { hasCachedToken: false, expiresAt: null };
  }
}
