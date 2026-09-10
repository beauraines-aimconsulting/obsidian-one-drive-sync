import { Rule } from '../Rule.js';
import type { Frontmatter, EvaluationResult } from '../Rule.js';
import { compileGlobs, normalizeGlobPath } from '../../utils/glob.js';

export interface CategoryRuleConfig {
  whitelist?: string[];
  blacklist?: string[];
  /** @deprecated Use whitelist. */
  allowList?: string[];
  /** @deprecated Use blacklist. */
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
 * Checks if the file's category matches whitelist or blacklist rules.
 */
export class CategoryRule extends Rule {
  name = 'CategoryRule';
  private readonly whitelist: string[];
  private readonly blacklist: string[];
  private readonly matchesWhitelist: (value: string) => boolean;
  private readonly matchesBlacklist: (value: string) => boolean;
  private readonly fromPath: boolean;
  private readonly matchNested: boolean;

  constructor(config?: CategoryRuleConfig) {
    super();
    this.whitelist = config?.whitelist ?? config?.allowList ?? [];
    this.blacklist = config?.blacklist ?? config?.ignoreList ?? [];
    this.fromPath = config?.fromPath ?? false;
    this.matchNested = config?.matchNested ?? false;

    const options = { caseInsensitive: config?.caseInsensitive ?? false, dot: true };
    this.matchesWhitelist = compileGlobs(this.expand(this.whitelist), options);
    this.matchesBlacklist = compileGlobs(this.expand(this.blacklist), options);
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

    // If whitelist is configured, check if any category is in the whitelist
    if (this.whitelist.length > 0) {
      const hasWhitelisted = categories.some((cat) => this.matchesWhitelist(cat));
      if (!hasWhitelisted) {
        return {
          passed: false,
          reason: `Category not in whitelist: ${this.whitelist.join(', ')}`,
        };
      }
    }

    // Check if any category is blacklisted
    if (this.blacklist.length > 0) {
      const blacklisted = categories.filter((cat) => this.matchesBlacklist(cat));
      if (blacklisted.length > 0) {
        return {
          passed: false,
          reason: `Category is blacklisted: ${blacklisted.join(', ')}`,
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
