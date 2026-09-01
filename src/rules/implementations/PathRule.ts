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
  vaultPath?: string;
}

/**
 * Checks if the file path matches include/exclude patterns.
 * Normalizes paths internally so callers can pass either absolute or relative paths.
 */
export class PathRule extends Rule {
  name = 'PathRule';
  private includePatterns: RegExp[];
  private excludePatterns: RegExp[];
  private vaultPath?: string;

  constructor(config?: PathRuleConfig) {
    super();
    this.includePatterns = (config?.include ?? []).map((p) => globToRegex(p));
    this.excludePatterns = (config?.exclude ?? []).map((p) => globToRegex(p));
    this.vaultPath = config?.vaultPath;
  }

  /**
   * Normalize a filepath to a vault-relative path.
   * - If vaultPath is configured and filepath is absolute and within the vault, strips the vault path
   * - Converts backslashes to forward slashes for consistency
   * - Handles both Windows and Unix paths
   */
  private normalizePath(filepath: string): string {
    // Convert backslashes to forward slashes for consistency
    let normalized = filepath.replace(/\\/g, '/');

    // If vaultPath is configured and filepath is absolute, make it relative
    if (this.vaultPath) {
      const normalizedVaultPath = this.vaultPath.replace(/\\/g, '/');
      // Check if the normalized path starts with the vault path (with trailing slash)
      if (normalized.startsWith(normalizedVaultPath + '/')) {
        // Strip the vault path prefix
        normalized = normalized.slice(normalizedVaultPath.length + 1);
      } else if (normalized === normalizedVaultPath) {
        // Handle root file (shouldn't happen, but be safe)
        normalized = '';
      }
      // If it doesn't start with vault path, assume it's already relative
    }

    // Remove leading slashes (shouldn't happen with properly relative paths)
    while (normalized.startsWith('/')) {
      normalized = normalized.slice(1);
    }

    return normalized;
  }

  evaluate(filepath: string, _frontmatter: Frontmatter): EvaluationResult {
    const normalizedPath = this.normalizePath(filepath);

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
