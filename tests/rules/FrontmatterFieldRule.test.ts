import { describe, it, expect } from 'vitest';
import { FrontmatterFieldRule } from '../../src/rules/implementations/FrontmatterFieldRule.js';
import type {
  FieldCondition,
  FieldOperator,
} from '../../src/rules/implementations/FrontmatterFieldRule.js';
import type { Frontmatter } from '../../src/rules/Rule.js';

const evaluate = (conditions: FieldCondition[], frontmatter: Frontmatter, mode?: 'all' | 'any') =>
  new FrontmatterFieldRule({ conditions, mode }).evaluate('note.md', frontmatter, '');

const passes = (
  op: FieldOperator,
  field: string,
  value: unknown,
  frontmatter: Frontmatter,
  caseInsensitive?: boolean
): boolean => evaluate([{ field, op, value, caseInsensitive }], frontmatter).passed;

describe('FrontmatterFieldRule', () => {
  describe('exists / notExists / truthy', () => {
    it.each([
      ['exists', { status: 'draft' }, true],
      ['exists', { status: null }, true],
      ['exists', {}, false],
      ['notExists', {}, true],
      ['notExists', { status: 'draft' }, false],
    ] as const)('%s on %o is %s', (op, frontmatter, expected) => {
      expect(passes(op, 'status', undefined, frontmatter)).toBe(expected);
    });

    it.each([
      [{ flag: true }, true],
      [{ flag: 'text' }, true],
      [{ flag: 1 }, true],
      [{ flag: ['a'] }, true],
      [{ flag: [] }, false],
      [{ flag: false }, false],
      [{ flag: 0 }, false],
      [{ flag: '' }, false],
      [{ flag: null }, false],
      [{}, false],
    ])('truthy on %o is %s', (frontmatter, expected) => {
      expect(passes('truthy', 'flag', undefined, frontmatter)).toBe(expected);
    });
  });

  describe('equals / notEquals', () => {
    it('compares strictly by default', () => {
      expect(passes('equals', 'status', 'draft', { status: 'draft' })).toBe(true);
      expect(passes('equals', 'status', 'draft', { status: 'Draft' })).toBe(false);
      expect(passes('equals', 'count', 3, { count: 3 })).toBe(true);
      expect(passes('equals', 'count', 3, { count: '3' })).toBe(false);
    });

    it('honours caseInsensitive for strings', () => {
      expect(passes('equals', 'status', 'draft', { status: 'DRAFT' }, true)).toBe(true);
    });

    it('inverts for notEquals', () => {
      expect(passes('notEquals', 'status', 'draft', { status: 'final' })).toBe(true);
      expect(passes('notEquals', 'status', 'draft', { status: 'draft' })).toBe(false);
    });

    it('treats a missing field as not equal', () => {
      expect(passes('equals', 'status', 'draft', {})).toBe(false);
      expect(passes('notEquals', 'status', 'draft', {})).toBe(true);
    });
  });

  describe('in / notIn', () => {
    it('checks membership of the configured list', () => {
      expect(passes('in', 'status', ['draft', 'review'], { status: 'review' })).toBe(true);
      expect(passes('in', 'status', ['draft', 'review'], { status: 'final' })).toBe(false);
      expect(passes('notIn', 'status', ['draft'], { status: 'final' })).toBe(true);
    });

    it('fails with an explanation when the config value is not an array', () => {
      const result = evaluate([{ field: 'status', op: 'in', value: 'draft' }], { status: 'draft' });

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('requires an array');
    });
  });

  describe('contains', () => {
    it('searches arrays by member equality', () => {
      expect(passes('contains', 'authors', 'sam', { authors: ['ali', 'sam'] })).toBe(true);
      expect(passes('contains', 'authors', 'jo', { authors: ['ali', 'sam'] })).toBe(false);
    });

    it('searches strings by substring', () => {
      expect(passes('contains', 'title', 'quarter', { title: 'The quarterly review' })).toBe(true);
      expect(passes('contains', 'title', 'Quarter', { title: 'The quarterly review' })).toBe(false);
      expect(passes('contains', 'title', 'Quarter', { title: 'quarterly' }, true)).toBe(true);
    });

    it('fails rather than throwing on a non-searchable value', () => {
      const result = evaluate([{ field: 'count', op: 'contains', value: 'x' }], { count: 3 });

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('cannot search');
    });
  });

  describe('matches', () => {
    it('applies the regex to strings and array members', () => {
      expect(passes('matches', 'title', '^Q[1-4] ', { title: 'Q3 planning' })).toBe(true);
      expect(passes('matches', 'tags', '^client/', { tags: ['internal', 'client/acme'] })).toBe(
        true
      );
      expect(passes('matches', 'tags', '^client/', { tags: ['internal'] })).toBe(false);
    });

    it('honours caseInsensitive', () => {
      expect(passes('matches', 'title', '^q3', { title: 'Q3 planning' }, true)).toBe(true);
    });

    it('rejects a non-string pattern at construction', () => {
      expect(
        () => new FrontmatterFieldRule({ conditions: [{ field: 'a', op: 'matches', value: 7 }] })
      ).toThrow('requires a string pattern');
    });

    it('fails rather than throwing on a non-matchable value', () => {
      expect(passes('matches', 'count', '^3$', { count: 3 })).toBe(false);
    });
  });

  describe('comparisons', () => {
    it('compares numbers', () => {
      expect(passes('gt', 'priority', 2, { priority: 3 })).toBe(true);
      expect(passes('gte', 'priority', 3, { priority: 3 })).toBe(true);
      expect(passes('lt', 'priority', 3, { priority: 3 })).toBe(false);
      expect(passes('lte', 'priority', 3, { priority: 3 })).toBe(true);
    });

    it('compares ISO-8601 dates as timestamps, not strings', () => {
      expect(passes('gte', 'created', '2026-01-01', { created: '2026-08-16' })).toBe(true);
      expect(passes('lt', 'created', '2026-01-01', { created: '2025-12-31' })).toBe(true);
      expect(passes('gt', 'created', '2026-08-16', { created: '2026-08-16 10:30:00' })).toBe(true);
    });

    it('compares numeric strings numerically', () => {
      // "10" < "9" lexically, which is the trap this avoids.
      expect(passes('gt', 'version', '9', { version: '10' })).toBe(true);
    });

    it('fails with a type-mismatch reason instead of throwing', () => {
      const result = evaluate([{ field: 'status', op: 'gt', value: 3 }], { status: 'draft' });

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('cannot compare');
      expect(result.reason).toContain('ISO-8601');
    });

    it('fails when the field is missing', () => {
      expect(passes('gt', 'priority', 2, {})).toBe(false);
    });
  });

  describe('dot paths', () => {
    const frontmatter = { meta: { review: { status: 'done' } }, authors: ['ali', 'sam'] };

    it('resolves nested objects', () => {
      expect(passes('equals', 'meta.review.status', 'done', frontmatter)).toBe(true);
    });

    it('resolves array indices', () => {
      expect(passes('equals', 'authors.1', 'sam', frontmatter)).toBe(true);
    });

    it('stops at a non-object rather than throwing', () => {
      expect(passes('exists', 'meta.review.status.deeper', undefined, frontmatter)).toBe(false);
      expect(passes('exists', 'authors.nope', undefined, frontmatter)).toBe(false);
    });
  });

  describe('modes', () => {
    const conditions: FieldCondition[] = [
      { field: 'status', op: 'equals', value: 'final' },
      { field: 'reviewed', op: 'truthy' },
    ];

    it('requires every condition by default', () => {
      expect(evaluate(conditions, { status: 'final', reviewed: true }).passed).toBe(true);
      expect(evaluate(conditions, { status: 'final', reviewed: false }).passed).toBe(false);
    });

    it('requires only one in any mode', () => {
      expect(evaluate(conditions, { status: 'final', reviewed: false }, 'any').passed).toBe(true);
      expect(evaluate(conditions, { status: 'draft', reviewed: false }, 'any').passed).toBe(false);
    });

    it('passes with no conditions configured', () => {
      expect(evaluate([], {}).passed).toBe(true);
    });
  });

  describe('reasons', () => {
    it('names the failing condition in all mode', () => {
      const result = evaluate(
        [
          { field: 'status', op: 'equals', value: 'final' },
          { field: 'reviewed', op: 'truthy' },
        ],
        { status: 'final', reviewed: false }
      );

      expect(result.reason).toContain('reviewed truthy');
      expect(result.reason).not.toContain('status equals');
    });

    it('names the passing condition in any mode', () => {
      const result = evaluate(
        [
          { field: 'status', op: 'equals', value: 'final' },
          { field: 'reviewed', op: 'truthy' },
        ],
        { status: 'final', reviewed: false },
        'any'
      );

      expect(result.reason).toContain('status equals');
      expect(result.reason).not.toContain('reviewed truthy');
    });
  });
});
