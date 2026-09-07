import { describe, it, expect } from 'vitest';
import { validateRulesConfig, formatConfigErrors } from '../../src/rules/validateRulesConfig.js';

describe('validateRulesConfig', () => {
  const pathsOf = (input: unknown): string[] => {
    const outcome = validateRulesConfig(input);
    if (outcome.valid) throw new Error('expected validation to fail');
    return outcome.errors.map((error) => error.path);
  };

  describe('v1 documents', () => {
    it('accepts the legacy flat shape and returns it as v2', () => {
      const outcome = validateRulesConfig({
        rules: {
          composition: 'OR',
          pathRule: { include: ['MSFT/**'] },
          tagRule: { whitelist: ['ms-rte'], requireAny: true },
        },
      });

      expect(outcome.valid).toBe(true);
      if (!outcome.valid) return;
      expect(outcome.version).toBe(1);
      expect(outcome.config.rulesVersion).toBe(2);
      expect(outcome.config.rules?.match).toEqual({
        any: [{ rule: 'PathRule' }, { rule: 'TagRule' }],
      });
    });

    it('accepts a document with no rules at all', () => {
      expect(validateRulesConfig({}).valid).toBe(true);
      expect(validateRulesConfig({ rules: {} }).valid).toBe(true);
    });

    it('preserves unrelated top-level sections such as config', () => {
      const outcome = validateRulesConfig({
        config: { vaultPath: '~/vault' },
        rules: { frontmatterRule: true },
      });

      expect(outcome.valid).toBe(true);
      if (!outcome.valid) return;
      expect((outcome.config as Record<string, unknown>).config).toEqual({ vaultPath: '~/vault' });
    });

    it('rejects an invalid composition', () => {
      expect(pathsOf({ rules: { composition: 'MAYBE' } })).toEqual(['rules.composition']);
    });

    it('rejects unknown keys rather than ignoring them', () => {
      expect(pathsOf({ rules: { tagRule: { whitlist: ['x'] } } })).toEqual([
        'rules.tagRule.whitlist',
      ]);
    });
  });

  describe('v2 documents', () => {
    const valid = {
      rulesVersion: 2,
      rules: {
        definitions: {
          workPaths: { type: 'path', include: ['MSFT/**', 'AIM/**'] },
          publicTags: { type: 'tag', whitelist: ['ms-rte'], requireAny: true },
        },
        match: {
          all: [
            { any: [{ rule: 'workPaths' }, { rule: 'publicTags' }] },
            { not: { rule: 'publicTags' } },
          ],
        },
      },
    };

    it('accepts a nested match tree', () => {
      const outcome = validateRulesConfig(valid);
      expect(outcome.valid).toBe(true);
      if (!outcome.valid) return;
      expect(outcome.version).toBe(2);
      expect(outcome.warnings).toEqual([]);
    });

    it('accepts group definitions referenced by name', () => {
      const outcome = validateRulesConfig({
        rulesVersion: 2,
        rules: {
          definitions: {
            a: { type: 'frontmatter' },
            b: { type: 'privacy', allowPrivate: false },
            eitherOne: { any: [{ rule: 'a' }, { rule: 'b' }] },
          },
          match: { rule: 'eitherOne' },
        },
      });

      expect(outcome.valid).toBe(true);
    });

    it('rejects an unsupported rules version', () => {
      expect(pathsOf({ rulesVersion: 3, rules: {} })).toEqual(['rulesVersion']);
    });

    it('rejects a dangling rule reference and names the known rules', () => {
      const outcome = validateRulesConfig({
        rulesVersion: 2,
        rules: {
          definitions: { a: { type: 'frontmatter' } },
          match: { all: [{ rule: 'nope' }] },
        },
      });

      expect(outcome.valid).toBe(false);
      if (outcome.valid) return;
      expect(outcome.errors[0].path).toBe('rules.match.all[0].rule');
      expect(outcome.errors[0].message).toContain('Unknown rule "nope"');
      expect(outcome.errors[0].message).toContain('a');
    });

    it('rejects circular group definitions', () => {
      const outcome = validateRulesConfig({
        rulesVersion: 2,
        rules: {
          definitions: {
            a: { any: [{ rule: 'b' }] },
            b: { any: [{ rule: 'a' }] },
          },
          match: { rule: 'a' },
        },
      });

      expect(outcome.valid).toBe(false);
      if (outcome.valid) return;
      expect(
        outcome.errors.some((error) => error.message.includes('Circular rule reference'))
      ).toBe(true);
    });

    it('rejects an empty group', () => {
      expect(
        pathsOf({ rulesVersion: 2, rules: { definitions: {}, match: { all: [] } } })
      ).toContain('rules.match.all');
    });

    it('rejects a node that is neither a group nor a reference', () => {
      const outcome = validateRulesConfig({
        rulesVersion: 2,
        rules: { definitions: { a: { type: 'frontmatter' } }, match: { maybe: [] } },
      });

      expect(outcome.valid).toBe(false);
      if (outcome.valid) return;
      expect(outcome.errors[0].message).toContain('Expected a rule reference');
    });

    it('rejects definitions with no match to use them', () => {
      expect(
        pathsOf({ rulesVersion: 2, rules: { definitions: { a: { type: 'frontmatter' } } } })
      ).toEqual(['rules.match']);
    });

    it('rejects an invalid glob and points at the offending array element', () => {
      expect(
        pathsOf({
          rulesVersion: 2,
          rules: {
            definitions: { a: { type: 'path', include: ['ok/**', ''] } },
            match: { rule: 'a' },
          },
        })
      ).toEqual(['rules.definitions.a.include[1]']);
    });

    it('rejects unknown rule types', () => {
      expect(
        pathsOf({
          rulesVersion: 2,
          rules: { definitions: { a: { type: 'nonsense' } }, match: { rule: 'a' } },
        })
      ).toEqual(['rules.definitions.a.type']);
    });

    it('warns about definitions nothing references', () => {
      const outcome = validateRulesConfig({
        rulesVersion: 2,
        rules: {
          definitions: { used: { type: 'frontmatter' }, unused: { type: 'privacy' } },
          match: { rule: 'used' },
        },
      });

      expect(outcome.valid).toBe(true);
      if (!outcome.valid) return;
      expect(outcome.warnings).toEqual([
        'Rule "unused" is defined but never referenced by rules.match',
      ]);
    });
  });

  describe('input handling', () => {
    it.each([[null], [42], ['nope'], [[]]])('rejects non-object input: %s', (input) => {
      const outcome = validateRulesConfig(input);
      expect(outcome.valid).toBe(false);
    });

    it('reports every problem at once', () => {
      const outcome = validateRulesConfig({
        rulesVersion: 2,
        rules: {
          definitions: {
            a: { type: 'path', include: [''] },
            b: { type: 'tag', bogus: true },
          },
          match: { all: [{ rule: 'a' }, { rule: 'b' }] },
        },
      });

      expect(outcome.valid).toBe(false);
      if (outcome.valid) return;
      expect(outcome.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('formatConfigErrors', () => {
    it('renders one indented line per error', () => {
      expect(
        formatConfigErrors([
          { path: 'rules.match', message: 'Required' },
          { path: '', message: 'Bad document' },
        ])
      ).toBe('  rules.match: Required\n  Bad document');
    });
  });
});
