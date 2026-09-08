import * as fs from 'fs';
import * as path from 'path';
import { Rule } from '../Rule.js';
import type { Frontmatter, EvaluationResult } from '../Rule.js';
import { parseDuration } from '../../utils/duration.js';
import { normalizeGlobPath } from '../../utils/glob.js';

export interface FileMetaRuleConfig {
  /** Minimum file size in bytes, inclusive. */
  minSize?: number;
  /** Maximum file size in bytes, inclusive. */
  maxSize?: number;
  /** Only files modified within this window, e.g. `30d`. */
  modifiedWithin?: string;
  /** Only files last modified before this window elapsed, e.g. `1y` worth of `365d`. */
  modifiedBefore?: string;
  /** Permitted extensions, with or without the leading dot. */
  extensions?: string[];
  /** Vault root, needed to stat a file from the vault-relative path rules receive. */
  vaultPath?: string;
}

/**
 * Filters on filesystem metadata: size, modification time, and extension.
 *
 * Rules are handed a vault-relative path and no stat handle, so this rule takes
 * a `vaultPath` (mirroring `PathRule`) and stats the file itself. A file that
 * cannot be stat'd fails rather than throwing: it may have been deleted between
 * the vault walk and evaluation, which is not an error worth aborting a sync.
 */
export class FileMetaRule extends Rule {
  name = 'FileMetaRule';
  private readonly minSize?: number;
  private readonly maxSize?: number;
  private readonly modifiedWithinMs?: number;
  private readonly modifiedBeforeMs?: number;
  private readonly extensions?: Set<string>;
  private readonly vaultPath?: string;

  constructor(config?: FileMetaRuleConfig) {
    super();
    this.minSize = config?.minSize;
    this.maxSize = config?.maxSize;
    // Parsed once so a malformed duration is a startup error, not a per-file one.
    this.modifiedWithinMs = config?.modifiedWithin
      ? parseDuration(config.modifiedWithin)
      : undefined;
    this.modifiedBeforeMs = config?.modifiedBefore
      ? parseDuration(config.modifiedBefore)
      : undefined;
    this.extensions = config?.extensions
      ? new Set(config.extensions.map((extension) => normalizeExtension(extension)))
      : undefined;
    this.vaultPath = config?.vaultPath;
  }

  evaluate(filepath: string, _frontmatter: Frontmatter): EvaluationResult {
    if (this.extensions) {
      const extension = normalizeExtension(path.extname(filepath));
      if (!this.extensions.has(extension)) {
        return {
          passed: false,
          reason: `Extension "${extension}" is not in: ${Array.from(this.extensions).join(', ')}`,
        };
      }
    }

    const needsStat =
      this.minSize !== undefined ||
      this.maxSize !== undefined ||
      this.modifiedWithinMs !== undefined ||
      this.modifiedBeforeMs !== undefined;

    if (!needsStat) {
      return { passed: true, reason: 'File metadata passed all checks' };
    }

    const stats = this.stat(filepath);
    if (!stats) {
      return { passed: false, reason: 'File not accessible' };
    }

    if (this.minSize !== undefined && stats.size < this.minSize) {
      return {
        passed: false,
        reason: `File is ${stats.size} bytes, under the ${this.minSize} byte minimum`,
      };
    }

    if (this.maxSize !== undefined && stats.size > this.maxSize) {
      return {
        passed: false,
        reason: `File is ${stats.size} bytes, over the ${this.maxSize} byte maximum`,
      };
    }

    const age = Date.now() - stats.mtimeMs;

    if (this.modifiedWithinMs !== undefined && age > this.modifiedWithinMs) {
      return {
        passed: false,
        reason: `Last modified ${formatAge(age)} ago, outside the required window`,
      };
    }

    if (this.modifiedBeforeMs !== undefined && age < this.modifiedBeforeMs) {
      return {
        passed: false,
        reason: `Last modified ${formatAge(age)} ago, more recently than required`,
      };
    }

    return { passed: true, reason: `File is ${stats.size} bytes, modified ${formatAge(age)} ago` };
  }

  private stat(filepath: string): fs.Stats | undefined {
    const normalized = normalizeGlobPath(filepath);
    const absolute =
      path.isAbsolute(normalized) || !this.vaultPath
        ? normalized
        : path.join(this.vaultPath, normalized);

    try {
      return fs.statSync(absolute);
    } catch {
      return undefined;
    }
  }
}

function normalizeExtension(extension: string): string {
  const trimmed = extension.trim().toLowerCase();
  return trimmed.startsWith('.') ? trimmed.slice(1) : trimmed;
}

function formatAge(milliseconds: number): string {
  const days = Math.floor(milliseconds / 86_400_000);
  if (days > 0) return `${days}d`;

  const hours = Math.floor(milliseconds / 3_600_000);
  if (hours > 0) return `${hours}h`;

  const minutes = Math.floor(milliseconds / 60_000);
  return `${minutes}m`;
}
