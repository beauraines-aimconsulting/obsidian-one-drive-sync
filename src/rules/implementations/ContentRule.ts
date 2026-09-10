import { Rule } from '../Rule.js';
import type { Frontmatter, EvaluationResult } from '../Rule.js';

export interface ContentRuleConfig {
  includePatterns?: string[];
  excludePatterns?: string[];
  /** Whether any include pattern suffices (default) or all must match. */
  mode?: 'any' | 'all';
  caseInsensitive?: boolean;
  /** Treat patterns as regular expressions rather than literal substrings. */
  regex?: boolean;
  /** Skip notes larger than this, in bytes. Defaults to 1 MiB. */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 1024 * 1024;

/**
 * Matches the note body — frontmatter has already been stripped by
 * `FrontmatterParser`, so patterns cannot accidentally match YAML fields.
 *
 * Scanning is bounded by `maxBytes`: an oversized note fails with an explicit
 * reason instead of being scanned, so one pathological file cannot stall a
 * sync. `PublicationService` caches results by content hash, so a note is only
 * re-scanned when it actually changes.
 */
export class ContentRule extends Rule {
  name = 'ContentRule';
  private readonly includePatterns: string[];
  private readonly excludePatterns: string[];
  private readonly includeMatchers: Array<(content: string) => boolean>;
  private readonly excludeMatchers: Array<(content: string) => boolean>;
  private readonly mode: 'any' | 'all';
  private readonly maxBytes: number;

  constructor(config?: ContentRuleConfig) {
    super();
    this.includePatterns = config?.includePatterns ?? [];
    this.excludePatterns = config?.excludePatterns ?? [];
    this.mode = config?.mode ?? 'any';
    this.maxBytes = config?.maxBytes ?? DEFAULT_MAX_BYTES;

    const compile = (pattern: string): ((content: string) => boolean) => {
      if (config?.regex) {
        // Compiled once here so an invalid pattern fails at load rather than
        // once per file, and so the cost is not paid per note.
        const expression = new RegExp(pattern, config?.caseInsensitive ? 'i' : '');
        return (content: string) => expression.test(content);
      }

      if (config?.caseInsensitive) {
        const needle = pattern.toLowerCase();
        return (content: string) => content.toLowerCase().includes(needle);
      }

      return (content: string) => content.includes(pattern);
    };

    this.includeMatchers = this.includePatterns.map(compile);
    this.excludeMatchers = this.excludePatterns.map(compile);
  }

  evaluate(_filepath: string, _frontmatter: Frontmatter, content: string): EvaluationResult {
    const body = content ?? '';

    if (this.includeMatchers.length === 0 && this.excludeMatchers.length === 0) {
      return { passed: true, reason: 'No content patterns configured' };
    }

    const size = Buffer.byteLength(body, 'utf-8');
    if (size > this.maxBytes) {
      return {
        passed: false,
        reason: `Content is ${size} bytes, over the ${this.maxBytes} byte scan limit`,
      };
    }

    // Exclude wins, for the same reason it does in PathRule: an exclusion is
    // how a note is kept unpublished and must not be overridable.
    const excludedIndex = this.excludeMatchers.findIndex((matches) => matches(body));
    if (excludedIndex !== -1) {
      return {
        passed: false,
        reason: `Content matches exclude pattern: ${this.excludePatterns[excludedIndex]}`,
      };
    }

    if (this.includeMatchers.length > 0) {
      const hits = this.includeMatchers
        .map((matches, index) => (matches(body) ? this.includePatterns[index] : undefined))
        .filter((pattern): pattern is string => pattern !== undefined);

      if (this.mode === 'all') {
        const missing = this.includePatterns.filter((pattern) => !hits.includes(pattern));
        if (missing.length > 0) {
          return {
            passed: false,
            reason: `Content missing required patterns: ${missing.join(', ')}`,
          };
        }
      } else if (hits.length === 0) {
        return {
          passed: false,
          reason: `Content matches no include pattern: ${this.includePatterns.join(', ')}`,
        };
      }

      return { passed: true, reason: `Content matches: ${hits.join(', ')}` };
    }

    return { passed: true, reason: 'Content matches no exclude pattern' };
  }
}
