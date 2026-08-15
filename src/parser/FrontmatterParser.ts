import * as yaml from 'js-yaml';
import type { Frontmatter, ParseResult } from './types.js';

export class FrontmatterParser {
  private cache: Map<string, Frontmatter> = new Map();

  /**
   * Parse YAML frontmatter from markdown content.
   * Frontmatter must be enclosed in --- delimiters at the start of the file.
   */
  parse(content: string): ParseResult {
    const trimmed = content.trimStart();

    // Check if content starts with ---
    if (!trimmed.startsWith('---')) {
      return {
        frontmatter: {},
        content,
      };
    }

    // Find the closing --- delimiter
    const lines = trimmed.split('\n');
    let closeIndex = -1;

    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        closeIndex = i;
        break;
      }
    }

    // No closing delimiter found
    if (closeIndex === -1) {
      return {
        frontmatter: {},
        content,
      };
    }

    // Extract frontmatter content
    const frontmatterStr = lines.slice(1, closeIndex).join('\n');

    try {
      const parsed = yaml.load(frontmatterStr) as Frontmatter | null;
      const frontmatter = parsed || {};

      // Reconstruct content without frontmatter
      const contentLines = lines.slice(closeIndex + 1).join('\n').trim();

      return {
        frontmatter,
        content: contentLines,
      };
    } catch (error) {
      console.warn('Failed to parse YAML frontmatter:', error);
      return {
        frontmatter: {},
        content,
      };
    }
  }

  /**
   * Parse and cache the frontmatter from content.
   */
  parseAndCache(filepath: string, content: string): Frontmatter {
    if (this.cache.has(filepath)) {
      return this.cache.get(filepath)!;
    }

    const result = this.parse(content);
    this.cache.set(filepath, result.frontmatter);
    return result.frontmatter;
  }

  /**
   * Get cached frontmatter for a file.
   */
  getCached(filepath: string): Frontmatter | undefined {
    return this.cache.get(filepath);
  }

  /**
   * Clear cache for a specific file or entire cache.
   */
  clearCache(filepath?: string): void {
    if (filepath) {
      this.cache.delete(filepath);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Extract a specific field from frontmatter.
   */
  getField<T>(frontmatter: Frontmatter, field: string): T | undefined {
    return frontmatter[field] as T | undefined;
  }

  /**
   * Check if publish field is set to true.
   */
  isPublished(frontmatter: Frontmatter): boolean {
    return frontmatter.publish === true;
  }

  /**
   * Check if private field is set to true.
   */
  isPrivate(frontmatter: Frontmatter): boolean {
    return frontmatter.private === true;
  }

  /**
   * Get tags from frontmatter as an array.
   */
  getTags(frontmatter: Frontmatter): string[] {
    const tags = frontmatter.tags;
    if (Array.isArray(tags)) {
      return tags.filter((t) => typeof t === 'string');
    }
    return [];
  }

  /**
   * Get categories from frontmatter as an array.
   */
  getCategories(frontmatter: Frontmatter): string[] {
    const category = frontmatter.category;
    if (Array.isArray(category)) {
      return category.filter((c) => typeof c === 'string');
    }
    if (typeof category === 'string') {
      return [category];
    }
    return [];
  }
}
