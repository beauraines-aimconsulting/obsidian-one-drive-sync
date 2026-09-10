import { Rule } from '../Rule.js';
import type { Frontmatter, EvaluationResult } from '../Rule.js';

/**
 * Inverts a rule's outcome.
 *
 * Implemented once as a decorator rather than as a `negate` branch inside every
 * rule class, so adding a rule type never means re-implementing negation.
 */
export class NegatedRule extends Rule {
  name: string;
  private readonly inner: Rule;

  constructor(inner: Rule) {
    super();
    this.inner = inner;
    this.name = inner.name;
  }

  evaluate(filepath: string, frontmatter: Frontmatter, content: string): EvaluationResult {
    const result = this.inner.evaluate(filepath, frontmatter, content);
    return {
      passed: !result.passed,
      reason: `NOT(${result.reason})`,
      children: result.children,
    };
  }
}
