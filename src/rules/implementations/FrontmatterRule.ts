import { Rule } from '../Rule.js';
import type { Frontmatter, EvaluationResult } from '../Rule.js';

/**
 * Checks if the file has publish: true in frontmatter.
 */
export class FrontmatterRule extends Rule {
  name = 'FrontmatterRule';

  evaluate(_filepath: string, frontmatter: Frontmatter): EvaluationResult {
    const publish = frontmatter.publish;

    if (publish === true) {
      return {
        passed: true,
        reason: 'publish: true in frontmatter',
      };
    }

    return {
      passed: false,
      reason: 'publish field not set to true in frontmatter',
    };
  }
}
