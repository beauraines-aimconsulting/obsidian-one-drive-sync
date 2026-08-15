import { Rule } from '../Rule.js';
import type { Frontmatter, EvaluationResult } from '../Rule.js';

export interface TagRuleConfig {
  whitelist?: string[];
  blacklist?: string[];
  requireAny?: boolean;
}

/**
 * Checks if the file's tags match whitelist or blacklist rules.
 */
export class TagRule extends Rule {
  name = 'TagRule';
  private whitelist: Set<string>;
  private blacklist: Set<string>;
  private requireAny: boolean;

  constructor(config?: TagRuleConfig) {
    super();
    this.whitelist = new Set(config?.whitelist ?? []);
    this.blacklist = new Set(config?.blacklist ?? []);
    this.requireAny = config?.requireAny ?? false;
  }

  private getTags(frontmatter: Frontmatter): string[] {
    const tags = frontmatter.tags;
    if (Array.isArray(tags)) {
      return tags.filter((t) => typeof t === 'string');
    }
    return [];
  }

  evaluate(_filepath: string, frontmatter: Frontmatter): EvaluationResult {
    const tags = this.getTags(frontmatter);

    // Check blacklist first
    if (this.blacklist.size > 0) {
      const hasBlacklisted = tags.some((tag) => this.blacklist.has(tag));
      if (hasBlacklisted) {
        return {
          passed: false,
          reason: `Tag is blacklisted: ${tags.filter((t) => this.blacklist.has(t)).join(', ')}`,
        };
      }
    }

    // Check whitelist if configured
    if (this.whitelist.size > 0) {
      if (this.requireAny) {
        // At least one tag must be in whitelist
        const hasWhitelisted = tags.some((tag) => this.whitelist.has(tag));
        if (!hasWhitelisted) {
          return {
            passed: false,
            reason: `None of the tags match whitelist: ${Array.from(this.whitelist).join(', ')}`,
          };
        }
      }
      // If not requireAny, just check that no tags are outside the whitelist
      else {
        const allInWhitelist = tags.every((tag) => this.whitelist.has(tag));
        if (tags.length > 0 && !allInWhitelist) {
          const invalidTags = tags.filter((t) => !this.whitelist.has(t));
          return {
            passed: false,
            reason: `Tags not in whitelist: ${invalidTags.join(', ')}`,
          };
        }
      }
    }

    return {
      passed: true,
      reason: tags.length > 0 ? `Tags: ${tags.join(', ')}` : 'No tags specified',
    };
  }
}
