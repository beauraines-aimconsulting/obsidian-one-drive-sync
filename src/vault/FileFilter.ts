import * as path from 'path';
import { compileGlob, normalizeGlobPath, type GlobMatcher } from '../utils/glob.js';
import type { FilterOptions, FileFilterResult } from './types.js';

export class FileFilter {
  /** Original pattern strings kept alongside their matchers so callers can read them back. */
  private ignorePatterns: Array<{ pattern: string; matches: GlobMatcher }> = [];
  private allowedExtensions: string[] = ['.md'];

  constructor(options?: Partial<FilterOptions>) {
    if (options?.patterns) {
      this.setIgnorePatterns(options.patterns);
    }
    if (options?.extensions) {
      this.allowedExtensions = options.extensions;
    }
  }

  /**
   * Set ignore patterns as glob strings.
   * Patterns are compiled once and reused for every subsequent match.
   */
  setIgnorePatterns(patterns: string[]): void {
    this.ignorePatterns = patterns.map((pattern) => ({
      pattern,
      matches: compileGlob(pattern),
    }));
  }

  /**
   * Add a single ignore pattern.
   */
  addIgnorePattern(pattern: string): void {
    this.ignorePatterns.push({ pattern, matches: compileGlob(pattern) });
  }

  /**
   * Clear all ignore patterns.
   */
  clearIgnorePatterns(): void {
    this.ignorePatterns = [];
  }

  /**
   * Check if a file path matches any ignore pattern.
   */
  private matchesIgnorePattern(filepath: string): boolean {
    return this.ignorePatterns.some((entry) => entry.matches(filepath));
  }

  /**
   * Check if a path matches any ignore pattern, without applying the
   * extension check. Used to prune directories while walking a vault.
   */
  isIgnored(filepath: string): boolean {
    const normalizedPath = normalizeGlobPath(filepath);
    if (this.matchesIgnorePattern(normalizedPath)) return true;
    // A directory is ignored when a pattern targets its contents (e.g. `.git/**`).
    return this.matchesIgnorePattern(`${normalizedPath}/`);
  }

  /**
   * Check if a file path has an allowed extension.
   */
  private hasAllowedExtension(filepath: string): boolean {
    const ext = path.extname(filepath).toLowerCase();
    return this.allowedExtensions.includes(ext);
  }

  /**
   * Filter a file - check if it should be processed.
   */
  filter(filepath: string): FileFilterResult {
    // Normalize path separators
    const normalizedPath = normalizeGlobPath(filepath);

    // Check ignore patterns first
    if (this.matchesIgnorePattern(normalizedPath)) {
      return {
        allowed: false,
        reason: 'File matches ignore pattern',
      };
    }

    // Check extension
    if (!this.hasAllowedExtension(normalizedPath)) {
      return {
        allowed: false,
        reason: `File extension not in allowed list: ${this.allowedExtensions.join(', ')}`,
      };
    }

    return {
      allowed: true,
    };
  }

  /**
   * Filter an array of files.
   */
  filterMany(filepaths: string[]): string[] {
    return filepaths.filter((fp) => this.filter(fp).allowed);
  }

  /**
   * Get the current ignore patterns.
   */
  getIgnorePatterns(): string[] {
    return this.ignorePatterns.map((entry) => entry.pattern);
  }

  /**
   * Get the allowed extensions.
   */
  getAllowedExtensions(): string[] {
    return [...this.allowedExtensions];
  }
}
