import { Rule } from '../Rule.js';
import type { Frontmatter, EvaluationResult } from '../Rule.js';

export interface PrivacyRuleConfig {
  allowPrivate?: boolean;
}

/**
 * Checks if the file is marked as private and should be excluded.
 */
export class PrivacyRule extends Rule {
  name = 'PrivacyRule';
  private allowPrivate: boolean;

  constructor(config?: PrivacyRuleConfig) {
    super();
    this.allowPrivate = config?.allowPrivate ?? false;
  }

  evaluate(_filepath: string, frontmatter: Frontmatter): EvaluationResult {
    const isPrivate = frontmatter.private === true;

    if (isPrivate && !this.allowPrivate) {
      return {
        passed: false,
        reason: 'File marked as private',
      };
    }

    return {
      passed: true,
      reason: isPrivate ? 'Private file allowed by config' : 'Not marked as private',
    };
  }
}
