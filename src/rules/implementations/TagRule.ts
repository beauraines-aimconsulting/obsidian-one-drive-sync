import { Rule } from '../Rule.js';
import type { Frontmatter, EvaluationResult } from '../Rule.js';

export interface TagRuleConfig {
  allowList?: string[];
  ignoreList?: string[];
  requireAny?: boolean;
}

/**
 * Checks if the file's tags match whitelist or blacklist rules.
 */
export class TagRule extends Rule {
  name = 'TagRule';
  private allowList: Set<string>;
  private ignoreList: Set<string>;
  private requireAny: boolean;

  constructor(config?: TagRuleConfig) {
    super();
    this.allowList = new Set(config?.allowList ?? []);
    this.ignoreList = new Set(config?.ignoreList ?? []);
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

    // Check ignoreList first
    if (this.ignoreList.size > 0) {
      const hasIgnoreListed = tags.some((tag) => this.ignoreList.has(tag));
      if (hasIgnoreListed) {
        return {
          passed: false,
          reason: `Tag is ignoreListed: ${tags.filter((t) => this.ignoreList.has(t)).join(', ')}`,
        };
      }
    }

    // Check allowList if configured
    if (this.allowList.size > 0) {
      if (this.requireAny) {
        // At least one tag must be in allowList
        const hasAllowListed = tags.some((tag) => this.allowList.has(tag));
        if (!hasAllowListed) {
          return {
            passed: false,
            reason: `None of the tags match allowList: ${Array.from(this.allowList).join(', ')}`,
          };
        }
      }
      // If not requireAny, just check that no tags are outside the allowList
      else {
        const allInAllowList = tags.every((tag) => this.allowList.has(tag));
        if (tags.length > 0 && !allInAllowList) {
          const invalidTags = tags.filter((t) => !this.allowList.has(t));
          return {
            passed: false,
            reason: `Tags not in allowList: ${invalidTags.join(', ')}`,
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
