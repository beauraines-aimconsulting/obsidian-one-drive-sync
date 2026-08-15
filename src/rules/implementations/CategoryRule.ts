import { Rule } from '../Rule.js';
import type { Frontmatter, EvaluationResult } from '../Rule.js';

export interface CategoryRuleConfig {
  whitelist?: string[];
  blacklist?: string[];
}

/**
 * Checks if the file's category matches whitelist or blacklist rules.
 */
export class CategoryRule extends Rule {
  name = 'CategoryRule';
  private whitelist: Set<string>;
  private blacklist: Set<string>;

  constructor(config?: CategoryRuleConfig) {
    super();
    this.whitelist = new Set(config?.whitelist ?? []);
    this.blacklist = new Set(config?.blacklist ?? []);
  }

  private getCategories(frontmatter: Frontmatter): string[] {
    const category = frontmatter.category;
    if (Array.isArray(category)) {
      return category.filter((c) => typeof c === 'string');
    }
    if (typeof category === 'string') {
      return [category];
    }
    return [];
  }

  evaluate(_filepath: string, frontmatter: Frontmatter): EvaluationResult {
    const categories = this.getCategories(frontmatter);

    // If whitelist is configured, check if any category is in the whitelist
    if (this.whitelist.size > 0) {
      const hasWhitelisted = categories.some((cat) => this.whitelist.has(cat));
      if (!hasWhitelisted) {
        return {
          passed: false,
          reason: `Category not in whitelist: ${Array.from(this.whitelist).join(', ')}`,
        };
      }
    }

    // Check if any category is blacklisted
    if (this.blacklist.size > 0) {
      const hasBlacklisted = categories.some((cat) => this.blacklist.has(cat));
      if (hasBlacklisted) {
        return {
          passed: false,
          reason: `Category is blacklisted: ${categories.filter((c) => this.blacklist.has(c)).join(', ')}`,
        };
      }
    }

    return {
      passed: true,
      reason: categories.length > 0 ? `Categories: ${categories.join(', ')}` : 'No category restriction',
    };
  }
}
