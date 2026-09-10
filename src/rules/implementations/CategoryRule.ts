import { Rule } from '../Rule.js';
import type { Frontmatter, EvaluationResult } from '../Rule.js';

export interface CategoryRuleConfig {
  allowList?: string[];
  ignoreList?: string[];
}

/**
 * Checks if the file's category matches whitelist or blacklist rules.
 */
export class CategoryRule extends Rule {
  name = 'CategoryRule';
  private allowList: Set<string>;
  private ignoreList: Set<string>;

  constructor(config?: CategoryRuleConfig) {
    super();
    this.allowList = new Set(config?.allowList ?? []);
    this.ignoreList = new Set(config?.ignoreList ?? []);
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

    // If allowList is configured, check if any category is in the allowList
    if (this.allowList.size > 0) {
      const hasAllowListed = categories.some((cat) => this.allowList.has(cat));
      if (!hasAllowListed) {
        return {
          passed: false,
          reason: `Category not in allowList: ${Array.from(this.allowList).join(', ')}`,
        };
      }
    }

    // Check if any category is ignoreListed
    if (this.ignoreList.size > 0) {
      const hasIgnoreListed = categories.some((cat) => this.ignoreList.has(cat));
      if (hasIgnoreListed) {
        return {
          passed: false,
          reason: `Category is ignoreListed: ${categories.filter((c) => this.ignoreList.has(c)).join(', ')}`,
        };
      }
    }

    return {
      passed: true,
      reason: categories.length > 0 ? `Categories: ${categories.join(', ')}` : 'No category restriction',
    };
  }
}
