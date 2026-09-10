import { Rule } from '../Rule.js';
import type { Frontmatter, EvaluationResult, RuleTrace } from '../Rule.js';
import type { RuleNode } from '../configTypes.js';

/** Resolves a definition name to the rule it refers to. */
export type RuleResolver = (name: string) => Rule;

/**
 * Evaluates an `all` / `any` / `not` tree of rule references.
 *
 * A group is just another `Rule`, so `RuleEngine` needs no structural change to
 * support nesting. Every child's outcome is recorded in `children`, which is
 * what makes `--explain` and the web UI's rule tester able to show *why* a
 * decision came out the way it did rather than only what it was.
 */
export class CompositeRule extends Rule {
  name: string;
  private readonly node: RuleNode;
  private readonly resolve: RuleResolver;

  constructor(name: string, node: RuleNode, resolve: RuleResolver) {
    super();
    this.name = name;
    this.node = node;
    this.resolve = resolve;
  }

  evaluate(filepath: string, frontmatter: Frontmatter, content: string): EvaluationResult {
    return this.evaluateNode(this.node, filepath, frontmatter, content);
  }

  private evaluateNode(
    node: RuleNode,
    filepath: string,
    frontmatter: Frontmatter,
    content: string
  ): EvaluationResult {
    if ('rule' in node) {
      const rule = this.resolve(node.rule);
      const result = rule.evaluate(filepath, frontmatter, content);
      return { passed: result.passed, reason: result.reason, children: result.children };
    }

    if ('not' in node) {
      const inner = this.evaluateNode(node.not, filepath, frontmatter, content);
      return {
        passed: !inner.passed,
        reason: `NOT(${inner.reason})`,
        children: this.traceOf(node.not, inner),
      };
    }

    const isAll = 'all' in node;
    const children = isAll ? node.all : node.any;
    const traces: RuleTrace[] = [];

    // Every child is evaluated rather than short-circuiting: a partial trace
    // would make the explain output misleading, and rules are cheap and pure.
    for (const child of children) {
      const result = this.evaluateNode(child, filepath, frontmatter, content);
      traces.push({
        name: this.describe(child),
        passed: result.passed,
        reason: result.reason,
        children: result.children,
      });
    }

    const passed = isAll ? traces.every((t) => t.passed) : traces.some((t) => t.passed);
    const relevant = isAll ? traces.filter((t) => !t.passed) : traces.filter((t) => t.passed);
    const summarised = (relevant.length > 0 ? relevant : traces)
      .map((t) => `${t.name}: ${t.reason}`)
      .join('; ');

    const reason = isAll
      ? passed
        ? `All of [${traces.map((t) => t.name).join(', ')}] passed`
        : `Failed (all): ${summarised}`
      : passed
        ? `Passed (any): ${relevant.map((t) => t.name).join(', ')}`
        : `Failed (any): ${summarised}`;

    return { passed, reason, children: traces };
  }

  private traceOf(node: RuleNode, result: EvaluationResult): RuleTrace[] {
    return [
      {
        name: this.describe(node),
        passed: result.passed,
        reason: result.reason,
        children: result.children,
      },
    ];
  }

  /** A short label for a node, used in trace output. */
  private describe(node: RuleNode): string {
    if ('rule' in node) return node.rule;
    if ('not' in node) return `not(${this.describe(node.not)})`;
    return 'all' in node ? 'all' : 'any';
  }
}
