export type { Frontmatter } from '../parser/types.js';

export interface PublicationServiceConfig {
  enableCache?: boolean;
  cacheSize?: number;
  rulesConfigPath?: string;
  composition?: 'AND' | 'OR';
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  vaultPath?: string;
}

export interface RuleResult {
  name: string;
  passed: boolean;
  reason: string;
}

export interface EligibilityResult {
  eligible: boolean;
  reason: string;
  rules: RuleResult[];
  evaluatedAt: number;
}

export interface PublicationRuleConfig {
  composition?: 'AND' | 'OR';
  rules?: Record<string, unknown>;
}

export interface CacheEntry {
  result: EligibilityResult;
  timestamp: number;
}
