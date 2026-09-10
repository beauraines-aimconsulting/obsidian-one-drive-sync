import { describe, it, expect } from 'vitest';
import { TagRule } from '../../src/rules/implementations/TagRule.js';
import type { TagRuleConfig } from '../../src/rules/implementations/TagRule.js';
import { CategoryRule } from '../../src/rules/implementations/CategoryRule.js';
import { PathRule } from '../../src/rules/implementations/PathRule.js';
import { attachTagSources, readTagSources, selectTags } from '../../src/rules/tagSources.js';
import type { Frontmatter } from '../../src/rules/Rule.js';

describe('tagSources', () => {
  const sources = { frontmatter: ['fm'], inline: ['body'], task: ['waiting'] };

  it('round-trips through frontmatter', () => {
    expect(readTagSources(attachTagSources({}, sources))).toEqual(sources);
  });

  it('falls back to frontmatter.tags when no provenance is attached', () => {
    expect(readTagSources({ tags: ['a', 'b'] })).toEqual({
      frontmatter: ['a', 'b'],
      inline: [],
      task: [],
    });
  });

  it('ignores non-string entries', () => {
    expect(readTagSources({ tags: ['a', 7, null] } as unknown as Frontmatter).frontmatter).toEqual([
      'a',
    ]);
  });

  it.each([
    ['frontmatter', ['fm']],
    ['inline', ['body']],
    ['task', ['waiting']],
    ['both', ['fm', 'body']],
    ['all', ['fm', 'body', 'waiting']],
  ] as const)('selects %s tags', (selector, expected) => {
    expect(selectTags(sources, selector)).toEqual(expected);
  });

  it('de-duplicates across sources', () => {
    expect(selectTags({ frontmatter: ['x'], inline: ['x'], task: [] }, 'both')).toEqual(['x']);
  });
});

describe('TagRule tag sources', () => {
  const note = attachTagSources(
    { tags: ['topic', 'inline-topic', 'waiting'] },
    { frontmatter: ['topic'], inline: ['inline-topic'], task: ['waiting'] }
  );

  const passes = (config: TagRuleConfig): boolean =>
    new TagRule(config).evaluate('note.md', note).passed;

  it('considers frontmatter and inline tags by default', () => {
    expect(passes({ allowList: ['topic'], requireAny: true })).toBe(true);
    expect(passes({ allowList: ['inline-topic'], requireAny: true })).toBe(true);
  });

  it('excludes task tags by default, since they annotate a task not the note', () => {
    expect(passes({ allowList: ['waiting'], requireAny: true })).toBe(false);
  });

  it('opts task tags back in with source: all', () => {
    expect(passes({ allowList: ['waiting'], requireAny: true, source: 'all' })).toBe(true);
  });

  it.each([
    ['frontmatter', 'topic', true],
    ['frontmatter', 'inline-topic', false],
    ['inline', 'inline-topic', true],
    ['inline', 'topic', false],
    ['task', 'waiting', true],
    ['task', 'topic', false],
  ] as const)('source %s matching %s is %s', (source, tag, expected) => {
    expect(passes({ allowList: [tag], requireAny: true, source })).toBe(expected);
  });

  it('names the source in the failure reason', () => {
    const result = new TagRule({ allowList: ['nope'], requireAny: true }).evaluate('note.md', note);

    expect(result.reason).toContain('frontmatter and inline tags');
  });

  it('ignoreLists a task tag only when task tags are selected', () => {
    expect(passes({ ignoreList: ['waiting'] })).toBe(true);
    expect(passes({ ignoreList: ['waiting'], source: 'all' })).toBe(false);
  });
});

describe('TagRule matching options', () => {
  const noteWith = (tags: string[]): Frontmatter => ({ tags });
  const passes = (config: TagRuleConfig, tags: string[]): boolean =>
    new TagRule(config).evaluate('note.md', noteWith(tags)).passed;

  describe('requireAll', () => {
    it('requires every allowList entry to be present', () => {
      const config = { allowList: ['alpha', 'beta'], requireAll: true };

      expect(passes(config, ['alpha', 'beta', 'gamma'])).toBe(true);
      expect(passes(config, ['alpha'])).toBe(false);
    });

    it('names the missing tags', () => {
      const result = new TagRule({ allowList: ['alpha', 'beta'], requireAll: true }).evaluate(
        'note.md',
        noteWith(['alpha'])
      );

      expect(result.reason).toContain('beta');
      expect(result.reason).not.toContain('alpha,');
    });

    it('takes precedence over requireAny when both are set', () => {
      expect(passes({ allowList: ['a', 'b'], requireAll: true, requireAny: true }, ['a'])).toBe(
        false
      );
    });
  });

  describe('globs', () => {
    it('matches tag patterns', () => {
      expect(passes({ allowList: ['project/*'], requireAny: true }, ['project/alpha'])).toBe(true);
      expect(passes({ allowList: ['project/*'], requireAny: true }, ['other/alpha'])).toBe(false);
    });

    it('matches deep patterns with a globstar', () => {
      expect(passes({ allowList: ['area/**'], requireAny: true }, ['area/work/admin'])).toBe(true);
    });

    it('accepts a leading # in config, as tags are written in notes', () => {
      expect(passes({ allowList: ['#alpha'], requireAny: true }, ['alpha'])).toBe(true);
      expect(passes({ allowList: ['alpha'], requireAny: true }, ['#alpha'])).toBe(true);
    });
  });

  describe('matchNested', () => {
    it('does not match children by default', () => {
      expect(passes({ allowList: ['project'], requireAny: true }, ['project/alpha'])).toBe(false);
    });

    it('matches children when enabled', () => {
      expect(
        passes({ allowList: ['project'], requireAny: true, matchNested: true }, ['project/alpha'])
      ).toBe(true);
    });

    it('still matches the parent tag itself', () => {
      expect(
        passes({ allowList: ['project'], requireAny: true, matchNested: true }, ['project'])
      ).toBe(true);
    });

    it('does not match an unrelated tag with the same prefix', () => {
      expect(
        passes({ allowList: ['project'], requireAny: true, matchNested: true }, ['projects'])
      ).toBe(false);
    });
  });

  describe('caseInsensitive', () => {
    it('is case sensitive by default', () => {
      expect(passes({ allowList: ['Alpha'], requireAny: true }, ['alpha'])).toBe(false);
    });

    it('ignores case when enabled', () => {
      expect(
        passes({ allowList: ['Alpha'], requireAny: true, caseInsensitive: true }, ['alpha'])
      ).toBe(true);
    });
  });
});

describe('CategoryRule extensions', () => {
  describe('fromPath', () => {
    it('derives a category from the first path segment when frontmatter has none', () => {
      const rule = new CategoryRule({ allowList: ['Work'], fromPath: true });

      expect(rule.evaluate('Work/notes/plan.md', {}).passed).toBe(true);
      expect(rule.evaluate('Personal/journal.md', {}).passed).toBe(false);
    });

    it('prefers a declared category over the path', () => {
      const rule = new CategoryRule({ allowList: ['Work'], fromPath: true });

      expect(rule.evaluate('Personal/journal.md', { category: 'Work' }).passed).toBe(true);
      expect(rule.evaluate('Work/plan.md', { category: 'Personal' }).passed).toBe(false);
    });

    it('has no category for a root-level note', () => {
      expect(
        new CategoryRule({ allowList: ['Work'], fromPath: true }).evaluate('inbox.md', {}).passed
      ).toBe(false);
    });

    it('is off by default', () => {
      expect(new CategoryRule({ allowList: ['Work'] }).evaluate('Work/plan.md', {}).passed).toBe(
        false
      );
    });
  });

  describe('matchNested', () => {
    it('does not match a child category by default', () => {
      expect(
        new CategoryRule({ allowList: ['Work'] }).evaluate('a.md', { category: 'Work/Clients' })
          .passed
      ).toBe(false);
    });

    it('matches a child category when enabled', () => {
      expect(
        new CategoryRule({ allowList: ['Work'], matchNested: true }).evaluate('a.md', {
          category: 'Work/Clients',
        }).passed
      ).toBe(true);
    });
  });

  it('supports caseInsensitive matching', () => {
    expect(
      new CategoryRule({ allowList: ['work'], caseInsensitive: true }).evaluate('a.md', {
        category: 'Work',
      }).passed
    ).toBe(true);
  });

  it('reports the ignoreListed category that matched', () => {
    const result = new CategoryRule({ ignoreList: ['Private*'] }).evaluate('a.md', {
      category: ['Work', 'PrivateNotes'],
    });

    expect(result.passed).toBe(false);
    expect(result.reason).toContain('PrivateNotes');
  });
});

describe('PathRule extensions', () => {
  it('treats a ! prefix in include as an exclusion', () => {
    const rule = new PathRule({ include: ['Work/**', '!Work/drafts/**'] });

    expect(rule.evaluate('Work/plan.md', {}).passed).toBe(true);
    expect(rule.evaluate('Work/drafts/idea.md', {}).passed).toBe(false);
  });

  it('keeps exclude winning over include', () => {
    const rule = new PathRule({ include: ['Work/**'], exclude: ['Work/private/**'] });

    expect(rule.evaluate('Work/private/salary.md', {}).passed).toBe(false);
  });

  it('supports case-insensitive matching', () => {
    expect(new PathRule({ include: ['work/**'] }).evaluate('Work/plan.md', {}).passed).toBe(false);
    expect(
      new PathRule({ include: ['work/**'], caseInsensitive: true }).evaluate('Work/plan.md', {})
        .passed
    ).toBe(true);
  });

  it('still passes a path with only negations configured', () => {
    const rule = new PathRule({ include: ['!Work/drafts/**'] });

    expect(rule.evaluate('Personal/note.md', {}).passed).toBe(true);
    expect(rule.evaluate('Work/drafts/idea.md', {}).passed).toBe(false);
  });
});
