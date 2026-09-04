export type { Frontmatter, FrontmatterParseError } from '../parser/types.js';

import type { FrontmatterParseError } from '../parser/types.js';

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
  /**
   * Set when the file's YAML frontmatter could not be parsed. Such files are
   * always ineligible, but are reported distinctly from files that were
   * correctly evaluated and simply failed a rule.
   */
  parseError?: FrontmatterParseError;
}

export interface PublicationRuleConfig {
  composition?: 'AND' | 'OR';
  rules?: Record<string, unknown>;
}

export interface CacheEntry {
  result: EligibilityResult;
  timestamp: number;
  /** Hash of the evaluated input; a mismatch invalidates the entry. */
  contentHash: string;
}
