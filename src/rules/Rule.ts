import type { RuleTrace } from './types.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type { RuleTrace };

export interface Frontmatter {
  [key: string]: unknown;
  publish?: boolean;
  category?: string | string[];
  tags?: string[];
  private?: boolean;
}

export interface EvaluationResult {
  passed: boolean;
  reason: string;
  /** Populated by composite rules so nested decisions can be explained. */
  children?: RuleTrace[];
}

export abstract class Rule {
  abstract name: string;

  abstract evaluate(filepath: string, frontmatter: Frontmatter, content: string): EvaluationResult;
}
