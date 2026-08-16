/**
 * Graph API probe types
 */

export interface GraphAuthConfig {
  clientId: string;
  tenantId: string;
  redirectUri?: string;
}

export interface TokenResult {
  accessToken: string;
  expiresOn: Date;
  scopes: string[];
}

export interface ProbeResult {
  success: boolean;
  endpoint: string;
  statusCode?: number;
  error?: string;
  data?: Record<string, unknown>;
}

export interface ProbeReport {
  timestamp: string;
  authentication: {
    success: boolean;
    method: string;
    scopes: string[];
    error?: string;
  };
  permissions: ProbeResult[];
  summary: {
    allPassed: boolean;
    passed: string[];
    failed: string[];
    adminConsentRequired: boolean;
  };
}

export interface AdminConsentRequestData {
  appName: string;
  clientId: string;
  tenantId: string;
  permissions: Array<{
    scope: string;
    type: 'Delegated' | 'Application';
    justification: string;
    required: boolean;
  }>;
  adminConsentUrl: string;
}
