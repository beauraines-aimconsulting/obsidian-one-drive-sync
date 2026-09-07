import * as yaml from 'js-yaml';
import { Logger } from '../utils/Logger.js';
import type { LogLevel } from '../utils/types.js';
import type { Frontmatter, FrontmatterParseError, ParseResult } from './types.js';

/**
 * Frontmatter is parsed with the YAML *core* schema rather than js-yaml's
 * default schema. The default schema implements YAML 1.1 timestamps, which
 * silently resolves fields like `created: 2026-08-16` into JS `Date` objects
 * and makes string comparisons in rules fail in surprising ways. The core
 * schema keeps those values as the strings the note author actually wrote.
 */
const FRONTMATTER_SCHEMA = yaml.CORE_SCHEMA;

export class FrontmatterParser {
  private cache: Map<string, Frontmatter> = new Map();
  private errorCache: Map<string, FrontmatterParseError> = new Map();
  private logger: Logger;

  constructor(logLevel: LogLevel = 'info') {
    this.logger = new Logger(logLevel, 'FrontmatterParser');
  }

  /**
   * Parse YAML frontmatter from markdown content.
   * Frontmatter must be enclosed in --- delimiters at the start of the file.
   *
   * @param content Full markdown source.
   * @param filepath Optional vault-relative path, used to identify the file in warnings.
   */
  parse(content: string, filepath?: string): ParseResult {
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

    // Content with the frontmatter block removed. Used by both the success and
    // the failure path so a malformed block is never uploaded verbatim.
    const bodyContent = lines
      .slice(closeIndex + 1)
      .join('\n')
      .trim();

    try {
      const parsed = yaml.load(frontmatterStr, {
        schema: FRONTMATTER_SCHEMA,
      }) as Frontmatter | null;

      return {
        frontmatter: parsed || {},
        content: bodyContent,
      };
    } catch (error) {
      const parseError = this.toParseError(error, content, trimmed, filepath);

      this.logger.warn('Failed to parse YAML frontmatter', {
        filepath: filepath ?? '<unknown>',
        line: parseError.line,
        column: parseError.column,
        reason: parseError.reason,
      });

      return {
        frontmatter: {},
        content: bodyContent,
        error: parseError,
      };
    }
  }

  /**
   * Convert a js-yaml exception into a concise, file-relative error descriptor.
   * Deliberately drops the stack trace and js-yaml's `mark.buffer`, which
   * echoes raw note content into the logs.
   */
  private toParseError(
    error: unknown,
    content: string,
    trimmed: string,
    filepath?: string
  ): FrontmatterParseError {
    const yamlError = error as {
      reason?: unknown;
      message?: unknown;
      mark?: { line?: number; column?: number };
    };

    const reason =
      typeof yamlError?.reason === 'string' && yamlError.reason.length > 0
        ? yamlError.reason
        : typeof yamlError?.message === 'string'
          ? yamlError.message.split('\n')[0]
          : String(error);

    // js-yaml marks are 0-based and relative to the frontmatter body, which
    // starts one line after the opening `---` of the trimmed content.
    const strippedPrefix = content.slice(0, content.length - trimmed.length);
    const leadingLines = strippedPrefix.split('\n').length - 1;

    const mark = yamlError?.mark;
    const line = typeof mark?.line === 'number' ? leadingLines + mark.line + 2 : undefined;
    const column = typeof mark?.column === 'number' ? mark.column + 1 : undefined;

    return { filepath, line, column, reason };
  }

  /**
   * Parse and cache the frontmatter from content.
   */
  parseAndCache(filepath: string, content: string): Frontmatter {
    if (this.cache.has(filepath)) {
      return this.cache.get(filepath)!;
    }

    const result = this.parse(content, filepath);
    this.cache.set(filepath, result.frontmatter);

    if (result.error) {
      this.errorCache.set(filepath, result.error);
    } else {
      this.errorCache.delete(filepath);
    }

    return result.frontmatter;
  }

  /**
   * Get cached frontmatter for a file.
   */
  getCached(filepath: string): Frontmatter | undefined {
    return this.cache.get(filepath);
  }

  /**
   * Get the cached parse error for a file, if its frontmatter failed to parse.
   */
  getCachedError(filepath: string): FrontmatterParseError | undefined {
    return this.errorCache.get(filepath);
  }

  /**
   * Clear cache for a specific file or entire cache.
   */
  clearCache(filepath?: string): void {
    if (filepath) {
      this.cache.delete(filepath);
      this.errorCache.delete(filepath);
    } else {
      this.cache.clear();
      this.errorCache.clear();
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
