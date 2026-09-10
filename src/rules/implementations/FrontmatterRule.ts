import { Rule } from '../Rule.js';
import type { Frontmatter, EvaluationResult } from '../Rule.js';
import { FrontmatterFieldRule } from './FrontmatterFieldRule.js';

/**
 * Checks if the file has publish: true in frontmatter.
 *
 * Implemented on top of {@link FrontmatterFieldRule} so there is one field
 * comparison code path, while keeping its own name and reasons — those appear
 * in user-facing output and in existing configs.
 */
export class FrontmatterRule extends Rule {
  name = 'FrontmatterRule';
  private readonly inner = new FrontmatterFieldRule({
    conditions: [{ field: 'publish', op: 'equals', value: true }],
  });

  evaluate(filepath: string, frontmatter: Frontmatter): EvaluationResult {
    const result = this.inner.evaluate(filepath, frontmatter);

    return result.passed
      ? { passed: true, reason: 'publish: true in frontmatter' }
      : { passed: false, reason: 'publish field not set to true in frontmatter' };
  }
}
