import { Rule } from '../Rule.js';
import type { Frontmatter, EvaluationResult } from '../Rule.js';
import { compileGlobs, normalizeGlobPath } from '../../utils/glob.js';

export interface CategoryRuleConfig {
  allowList?: string[];
  ignoreList?: string[];
  /**
   * When frontmatter declares no category, derive one from the first path
   * segment, so a vault organised by top-level folder needs no per-note field.
   */
  fromPath?: boolean;
  /** Treat a parent category as matching its children (`Work` matches `Work/Clients`). */
  matchNested?: boolean;
  caseInsensitive?: boolean;
}

/**
 * Checks if the file's category matches allowList or ignoreList rules.
 */
export class CategoryRule extends Rule {
  name = 'CategoryRule';
  private readonly allowList: string[];
  private readonly ignoreList: string[];
  private readonly matchesAllowList: (value: string) => boolean;
  private readonly matchesIgnoreList: (value: string) => boolean;
  private readonly fromPath: boolean;
  private readonly matchNested: boolean;

  constructor(config?: CategoryRuleConfig) {
    super();
    this.allowList = config?.allowList ?? [];
    this.ignoreList = config?.ignoreList ?? [];
    this.fromPath = config?.fromPath ?? false;
    this.matchNested = config?.matchNested ?? false;

    const options = { caseInsensitive: config?.caseInsensitive ?? false, dot: true };
    this.matchesAllowList = compileGlobs(this.expand(this.allowList), options);
    this.matchesIgnoreList = compileGlobs(this.expand(this.ignoreList), options);
  }

  /** Nested matching is an extra glob, so both forms go through one matcher. */
  private expand(patterns: string[]): string[] {
    if (!this.matchNested) return patterns;
    return patterns.flatMap((pattern) => [pattern, `${pattern}/**`]);
  }

  private getCategories(frontmatter: Frontmatter, filepath: string): string[] {
    const category = frontmatter.category;
    if (Array.isArray(category)) {
      const declared = category.filter((c) => typeof c === 'string');
      if (declared.length > 0) return declared;
    }
    if (typeof category === 'string' && category.length > 0) {
      return [category];
    }

    if (this.fromPath) {
      const segments = normalizeGlobPath(filepath).split('/');
      // A note at the vault root has no folder to take a category from.
      if (segments.length > 1 && segments[0].length > 0) return [segments[0]];
    }

    return [];
  }

  evaluate(filepath: string, frontmatter: Frontmatter): EvaluationResult {
    const categories = this.getCategories(frontmatter, filepath);

    // If allowList is configured, check if any category is in the allowList
    if (this.allowList.length > 0) {
      const hasAllowListed = categories.some((cat) => this.matchesAllowList(cat));
      if (!hasAllowListed) {
        return {
          passed: false,
          reason: `Category not in allowList: ${this.allowList.join(', ')}`,
        };
      }
    }

    // Check if any category is ignoreListed
    if (this.ignoreList.length > 0) {
      const ignoreListed = categories.filter((cat) => this.matchesIgnoreList(cat));
      if (ignoreListed.length > 0) {
        return {
          passed: false,
          reason: `Category is ignoreListed: ${ignoreListed.join(', ')}`,
        };
      }
    }

    return {
      passed: true,
      reason:
        categories.length > 0 ? `Categories: ${categories.join(', ')}` : 'No category restriction',
    };
  }
}
