import { describe, it, expect } from 'vitest';
import { ContentRule } from '../../src/rules/implementations/ContentRule.js';
import type { ContentRuleConfig } from '../../src/rules/implementations/ContentRule.js';
import type { Frontmatter } from '../../src/rules/Rule.js';

const evaluate = (config: ContentRuleConfig, content: string) =>
  new ContentRule(config).evaluate('note.md', {} as Frontmatter, content);

describe('ContentRule', () => {
  it('passes when nothing is configured', () => {
    expect(evaluate({}, 'anything').passed).toBe(true);
  });

  describe('include patterns', () => {
    it('passes when any pattern matches by default', () => {
      const config = { includePatterns: ['publish-me', 'share-me'] };

      expect(evaluate(config, 'This one says publish-me.').passed).toBe(true);
      expect(evaluate(config, 'This one says nothing.').passed).toBe(false);
    });

    it('requires every pattern in all mode', () => {
      const config: ContentRuleConfig = { includePatterns: ['alpha', 'beta'], mode: 'all' };

      expect(evaluate(config, 'alpha and beta').passed).toBe(true);
      expect(evaluate(config, 'alpha only').passed).toBe(false);
      expect(evaluate(config, 'alpha only').reason).toContain('beta');
    });

    it('is case sensitive unless asked otherwise', () => {
      expect(evaluate({ includePatterns: ['Publish'] }, 'publish').passed).toBe(false);
      expect(
        evaluate({ includePatterns: ['Publish'], caseInsensitive: true }, 'publish').passed
      ).toBe(true);
    });

    it('names the matched pattern in the reason', () => {
      expect(evaluate({ includePatterns: ['alpha'] }, 'alpha').reason).toContain('alpha');
    });
  });

  describe('exclude patterns', () => {
    it('fails when an exclude pattern matches', () => {
      expect(evaluate({ excludePatterns: ['DRAFT'] }, 'Marked DRAFT for now').passed).toBe(false);
    });

    it('beats include, so an exclusion cannot be overridden', () => {
      const result = evaluate(
        { includePatterns: ['publish'], excludePatterns: ['DRAFT'] },
        'publish this DRAFT'
      );

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('DRAFT');
    });

    it('passes a note that matches no exclusion', () => {
      expect(evaluate({ excludePatterns: ['DRAFT'] }, 'all done').passed).toBe(true);
    });
  });

  describe('regex mode', () => {
    it('treats patterns as regular expressions', () => {
      const config: ContentRuleConfig = {
        includePatterns: ['Status:\\s*(final|shipped)'],
        regex: true,
      };

      expect(evaluate(config, 'Status:   shipped').passed).toBe(true);
      expect(evaluate(config, 'Status: draft').passed).toBe(false);
    });

    it('anchors against the whole note, not per line', () => {
      // No `m` flag: `^`/`$` bracket the document. Documented so that a
      // line-anchored pattern is written with an explicit newline instead.
      const config: ContentRuleConfig = { includePatterns: ['^Status: final$'], regex: true };

      expect(evaluate(config, 'Status: final').passed).toBe(true);
      expect(evaluate(config, 'Intro\nStatus: final').passed).toBe(false);
      expect(
        evaluate({ includePatterns: ['\\nStatus: final'], regex: true }, 'Intro\nStatus: final')
          .passed
      ).toBe(true);
    });

    it('treats patterns literally when regex is off', () => {
      expect(evaluate({ includePatterns: ['a.c'] }, 'abc').passed).toBe(false);
      expect(evaluate({ includePatterns: ['a.c'] }, 'a.c').passed).toBe(true);
    });

    it('reports an invalid regex at construction rather than per file', () => {
      expect(() => new ContentRule({ includePatterns: ['('], regex: true })).toThrow();
    });
  });

  describe('size cap', () => {
    it('fails oversized content instead of scanning it', () => {
      const result = evaluate({ includePatterns: ['x'], maxBytes: 10 }, 'x'.repeat(11));

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('scan limit');
    });

    it('allows content exactly at the limit', () => {
      expect(evaluate({ includePatterns: ['x'], maxBytes: 10 }, 'x'.repeat(10)).passed).toBe(true);
    });

    it('measures bytes rather than characters', () => {
      // Four-byte emoji: two characters, eight bytes.
      expect(evaluate({ includePatterns: ['x'], maxBytes: 4 }, '🙂🙂').passed).toBe(false);
    });

    it('defaults to 1 MiB', () => {
      const justUnder = 'a'.repeat(1024 * 1024 - 1);
      expect(evaluate({ includePatterns: ['a'] }, justUnder).passed).toBe(true);
      expect(evaluate({ includePatterns: ['a'] }, `${justUnder}aa`).passed).toBe(false);
    });

    it('does not apply the cap when no patterns are configured', () => {
      expect(evaluate({ maxBytes: 1 }, 'much longer than one byte').passed).toBe(true);
    });
  });

  it('tolerates empty content', () => {
    expect(evaluate({ includePatterns: ['x'] }, '').passed).toBe(false);
    expect(evaluate({ excludePatterns: ['x'] }, '').passed).toBe(true);
  });
});
