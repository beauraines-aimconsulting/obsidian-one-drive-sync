export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

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
}

export abstract class Rule {
  abstract name: string;

  abstract evaluate(
    filepath: string,
    frontmatter: Frontmatter,
    content: string
  ): EvaluationResult;
}
