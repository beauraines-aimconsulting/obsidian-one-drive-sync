import { Rule } from '../Rule.js';
import type { Frontmatter, EvaluationResult } from '../Rule.js';

function globToRegex(glob: string): RegExp {
  // Handle ** first - it should match everything including /
  let regex = glob.replace(/\*\*/g, '___DOUBLE_STAR___');

  // Escape special regex characters except glob patterns
  regex = regex
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
    .replace(/\\\*/g, '[^/]*') // * -> [^/]* (match anything except /)
    .replace(/\\\?/g, '[^/]'); // ? -> [^/] (match any char except /)

  // Handle ** - it should match everything including /
  regex = regex.replace(/___DOUBLE_STAR___/g, '.*');

  return new RegExp(`^${regex}$`);
}

export interface PathRuleConfig {
  include?: string[];
  exclude?: string[];
}

/**
 * Checks if the file path matches include/exclude patterns.
 */
export class PathRule extends Rule {
  name = 'PathRule';
  private includePatterns: RegExp[];
  private excludePatterns: RegExp[];

  constructor(config?: PathRuleConfig) {
    super();
    this.includePatterns = (config?.include ?? []).map((p) => globToRegex(p));
    this.excludePatterns = (config?.exclude ?? []).map((p) => globToRegex(p));
  }

  evaluate(filepath: string, _frontmatter: Frontmatter): EvaluationResult {
    const normalizedPath = filepath.replace(/\\/g, '/');

    // Check exclude patterns first
    if (this.excludePatterns.length > 0) {
      const isExcluded = this.excludePatterns.some((regex) => regex.test(normalizedPath));
      if (isExcluded) {
        return {
          passed: false,
          reason: `Path matches exclude pattern`,
        };
      }
    }

    // Check include patterns if configured
    if (this.includePatterns.length > 0) {
      const isIncluded = this.includePatterns.some((regex) => regex.test(normalizedPath));
      if (!isIncluded) {
        return {
          passed: false,
          reason: `Path does not match any include pattern`,
        };
      }
    }

    return {
      passed: true,
      reason: 'Path passed include/exclude checks',
    };
  }
}
