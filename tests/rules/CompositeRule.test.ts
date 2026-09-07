import { describe, it, expect } from 'vitest';
import { CompositeRule } from '../../src/rules/implementations/CompositeRule.js';
import { Rule } from '../../src/rules/Rule.js';
import type { EvaluationResult, Frontmatter } from '../../src/rules/Rule.js';
import type { RuleNode } from '../../src/rules/configTypes.js';

class StubRule extends Rule {
  evaluations = 0;

  constructor(
    public name: string,
    private readonly result: boolean
  ) {
    super();
  }

  evaluate(): EvaluationResult {
    this.evaluations++;
    return { passed: this.result, reason: `${this.name} says ${this.result}` };
  }
}

function build(node: RuleNode, rules: Record<string, Rule>): CompositeRule {
  return new CompositeRule('root', node, (name) => {
    const rule = rules[name];
    if (!rule) throw new Error(`Unexpected rule lookup: ${name}`);
    return rule;
  });
}

const run = (rule: CompositeRule): EvaluationResult =>
  rule.evaluate('note.md', {} as Frontmatter, '');

describe('CompositeRule', () => {
  const yes = () => new StubRule('yes', true);
  const no = () => new StubRule('no', false);

  describe('all', () => {
    it('passes only when every child passes', () => {
      const rules = { a: yes(), b: yes() };
      expect(run(build({ all: [{ rule: 'a' }, { rule: 'b' }] }, rules)).passed).toBe(true);
    });

    it('fails when any child fails', () => {
      const rules = { a: yes(), b: no() };
      const result = run(build({ all: [{ rule: 'a' }, { rule: 'b' }] }, rules));

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('b: no says false');
    });

    it('names only the failing children in the reason', () => {
      const rules = { a: yes(), b: no(), c: no() };
      const result = run(build({ all: [{ rule: 'a' }, { rule: 'b' }, { rule: 'c' }] }, rules));

      expect(result.reason).not.toContain('a: yes');
      expect(result.reason).toContain('b:');
      expect(result.reason).toContain('c:');
    });
  });

  describe('any', () => {
    it('passes when at least one child passes', () => {
      const rules = { a: no(), b: yes() };
      const result = run(build({ any: [{ rule: 'a' }, { rule: 'b' }] }, rules));

      expect(result.passed).toBe(true);
      expect(result.reason).toContain('b');
    });

    it('fails when every child fails', () => {
      const rules = { a: no(), b: no() };
      expect(run(build({ any: [{ rule: 'a' }, { rule: 'b' }] }, rules)).passed).toBe(false);
    });
  });

  describe('not', () => {
    it('inverts the child result', () => {
      const rules = { a: no() };
      const result = run(build({ not: { rule: 'a' } }, rules));

      expect(result.passed).toBe(true);
      expect(result.reason).toBe('NOT(no says false)');
    });

    it('inverts a group', () => {
      const rules = { a: yes(), b: yes() };
      expect(run(build({ not: { all: [{ rule: 'a' }, { rule: 'b' }] } }, rules)).passed).toBe(
        false
      );
    });

    it('records the negated child in the trace', () => {
      const rules = { a: no() };
      const result = run(build({ not: { rule: 'a' } }, rules));

      expect(result.children).toEqual([
        { name: 'a', passed: false, reason: 'no says false', children: undefined },
      ]);
    });
  });

  describe('nesting', () => {
    const node: RuleNode = {
      all: [
        { any: [{ rule: 'a' }, { rule: 'b' }] },
        { not: { any: [{ all: [{ rule: 'c' }, { rule: 'd' }] }] } },
      ],
    };

    it('evaluates three levels deep', () => {
      const rules = { a: no(), b: yes(), c: yes(), d: no() };
      expect(run(build(node, rules)).passed).toBe(true);
    });

    it('fails when the negated branch matches', () => {
      const rules = { a: yes(), b: yes(), c: yes(), d: yes() };
      expect(run(build(node, rules)).passed).toBe(false);
    });

    it('produces a trace mirroring the node tree', () => {
      const rules = { a: no(), b: yes(), c: yes(), d: no() };
      const result = run(build(node, rules));

      expect(result.children).toHaveLength(2);
      expect(result.children?.[0].name).toBe('any');
      expect(result.children?.[0].children?.map((child) => child.name)).toEqual(['a', 'b']);
      expect(result.children?.[1].name).toBe('not(any)');
      expect(result.children?.[1].children?.[0].children?.[0].name).toBe('all');
    });
  });

  it('evaluates every child so the trace is complete', () => {
    const a = no();
    const b = yes();
    // `all` already fails at `a`; short-circuiting would leave `b` unexplained.
    run(build({ all: [{ rule: 'a' }, { rule: 'b' }] }, { a, b }));

    expect(a.evaluations).toBe(1);
    expect(b.evaluations).toBe(1);
  });

  it('propagates the trace of a nested composite referenced by name', () => {
    const inner = build({ any: [{ rule: 'a' }] }, { a: yes() });
    const outer = build({ all: [{ rule: 'inner' }] }, { inner });

    const result = run(outer);

    expect(result.passed).toBe(true);
    expect(result.children?.[0].children?.[0].name).toBe('a');
  });

  it('surfaces an unresolvable reference as an error', () => {
    const rule = new CompositeRule('root', { rule: 'missing' }, () => {
      throw new Error('Unknown rule "missing"');
    });

    expect(() => run(rule)).toThrow('Unknown rule "missing"');
  });
});
