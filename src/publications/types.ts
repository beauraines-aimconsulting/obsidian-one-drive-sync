export type { Frontmatter, FrontmatterParseError } from '../parser/types.js';

import type { FrontmatterParseError } from '../parser/types.js';
import type { TagSources } from '../rules/tagSources.js';

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
  /**
   * Nested outcomes, populated by group (`all`/`any`/`not`) rules. Present so
   * that a decision made several levels deep can be explained rather than
   * reported as one opaque pass/fail.
   */
  children?: RuleResult[];
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
  /**
   * Which tags were found in which position. Absent when the file could not be
   * evaluated (e.g. a frontmatter parse error).
   */
  tagSources?: TagSources;
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
