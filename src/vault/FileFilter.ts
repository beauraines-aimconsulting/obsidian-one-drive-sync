import * as path from 'path';
import type { FilterOptions, FileFilterResult } from './types.js';

/**
 * Converts a glob pattern to a regex pattern for matching file paths.
 * Supports: *, **, ?, [abc], etc.
 */
function globToRegex(glob: string): RegExp {
  // Escape special regex characters except glob patterns
  let regex = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
    .replace(/\\\*/g, '.*') // * -> .*
    .replace(/\\\?/g, '.'); // ? -> .

  // Handle ** separately - it should match everything
  regex = regex.replace(/\.\.\.\*/g, '.*');

  return new RegExp(`^${regex}$`);
}

export class FileFilter {
  private ignorePatterns: RegExp[] = [];
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
   * Patterns are converted to regex for efficient matching.
   */
  setIgnorePatterns(patterns: string[]): void {
    this.ignorePatterns = patterns.map((pattern) => globToRegex(pattern));
  }

  /**
   * Add a single ignore pattern.
   */
  addIgnorePattern(pattern: string): void {
    this.ignorePatterns.push(globToRegex(pattern));
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
    return this.ignorePatterns.some((regex) => regex.test(filepath));
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
    const normalizedPath = filepath.replace(/\\/g, '/');

    // Check extension
    if (!this.hasAllowedExtension(normalizedPath)) {
      return {
        allowed: false,
        reason: `File extension not in allowed list: ${this.allowedExtensions.join(', ')}`,
      };
    }

    // Check ignore patterns
    if (this.matchesIgnorePattern(normalizedPath)) {
      return {
        allowed: false,
        reason: 'File matches ignore pattern',
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
    return this.ignorePatterns.map((regex) => regex.source);
  }

  /**
   * Get the allowed extensions.
   */
  getAllowedExtensions(): string[] {
    return [...this.allowedExtensions];
  }
}
