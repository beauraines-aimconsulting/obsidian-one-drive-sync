import { Rule } from '../Rule.js';
import type { Frontmatter, EvaluationResult } from '../Rule.js';
import { compileGlobs, normalizeGlobPath, type GlobMatcher } from '../../utils/glob.js';

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
  private readonly hasInclude: boolean;
  private readonly hasExclude: boolean;
  private readonly matchesInclude: GlobMatcher;
  private readonly matchesExclude: GlobMatcher;
  private vaultPath?: string;

  constructor(config?: PathRuleConfig) {
    super();
    const include = config?.include ?? [];
    const exclude = config?.exclude ?? [];
    this.hasInclude = include.length > 0;
    this.hasExclude = exclude.length > 0;
    this.matchesInclude = compileGlobs(include);
    this.matchesExclude = compileGlobs(exclude);
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
    let normalized = normalizeGlobPath(filepath);

    // If vaultPath is configured and filepath is absolute, make it relative
    if (this.vaultPath) {
      const normalizedVaultPath = normalizeGlobPath(this.vaultPath);
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

    // Check exclude patterns first: exclude always beats include.
    if (this.hasExclude) {
      if (this.matchesExclude(normalizedPath)) {
        return {
          passed: false,
          reason: `Path matches exclude pattern`,
        };
      }
    }

    // Check include patterns if configured
    if (this.hasInclude) {
      if (!this.matchesInclude(normalizedPath)) {
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
