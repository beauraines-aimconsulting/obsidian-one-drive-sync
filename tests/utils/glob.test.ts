import { describe, it, expect, beforeEach } from 'vitest';
import {
  compileGlob,
  compileGlobs,
  isValidGlob,
  normalizeGlobPath,
  clearGlobCache,
} from '../../src/utils/glob.js';

describe('glob', () => {
  beforeEach(() => {
    clearGlobCache();
  });

  describe('single-star matching', () => {
    const cases: Array<[string, string, boolean]> = [
      ['*.md', 'note.md', true],
      ['*.md', 'folder/note.md', false],
      ['work/*.md', 'work/note.md', true],
      ['work/*.md', 'work/nested/note.md', false],
      ['*.md', 'note.txt', false],
    ];

    it.each(cases)('%s vs %s -> %s', (pattern, value, expected) => {
      expect(compileGlob(pattern)(value)).toBe(expected);
    });
  });

  describe('globstar matching', () => {
    const cases: Array<[string, string, boolean]> = [
      ['work/**', 'work/note.md', true],
      ['work/**', 'work/deeply/nested/note.md', true],
      ['work/**', 'work', true],
      ['work/**', 'personal/note.md', false],
      ['archive/**/old.md', 'archive/2024/old.md', true],
      ['archive/**/old.md', 'archive/2024/q1/old.md', true],
      ['archive/**/old.md', 'archive/2024/new.md', false],
    ];

    it.each(cases)('%s vs %s -> %s', (pattern, value, expected) => {
      expect(compileGlob(pattern)(value)).toBe(expected);
    });

    it('treats a leading globstar as optional so root files still match', () => {
      const matches = compileGlob('**/*.bookmark.md');

      expect(matches('Some Page.bookmark.md')).toBe(true);
      expect(matches('AIM/Some Page.bookmark.md')).toBe(true);
      expect(matches('MSFT/nested/deep/Page.bookmark.md')).toBe(true);
      expect(matches('AIM/bookmark.md')).toBe(false);
    });

    it('still scopes a leading globstar to the rest of the pattern', () => {
      const matches = compileGlob('**/drafts/*.md');

      expect(matches('drafts/note.md')).toBe(true);
      expect(matches('AIM/drafts/note.md')).toBe(true);
      expect(matches('AIM/notes/note.md')).toBe(false);
    });
  });

  describe('single-character wildcards', () => {
    it('matches exactly one character, never a separator', () => {
      expect(compileGlob('note?.md')('note1.md')).toBe(true);
      expect(compileGlob('note?.md')('note12.md')).toBe(false);
      expect(compileGlob('a?c.md')('a/c.md')).toBe(false);
    });
  });

  describe('character classes', () => {
    const cases: Array<[string, string, boolean]> = [
      ['note[12].md', 'note1.md', true],
      ['note[12].md', 'note3.md', false],
      ['note[a-z].md', 'notex.md', true],
      ['note[a-z].md', 'note1.md', false],
      ['note[!0-9].md', 'notex.md', true],
      ['note[!0-9].md', 'note1.md', false],
    ];

    it.each(cases)('%s vs %s -> %s', (pattern, value, expected) => {
      expect(compileGlob(pattern)(value)).toBe(expected);
    });
  });

  describe('brace alternation', () => {
    const cases: Array<[string, string, boolean]> = [
      ['{MSFT,AIM}/**', 'MSFT/note.md', true],
      ['{MSFT,AIM}/**', 'AIM/note.md', true],
      ['{MSFT,AIM}/**', 'Personal/note.md', false],
      ['note.{md,markdown}', 'note.markdown', true],
      ['note.{md,markdown}', 'note.txt', false],
    ];

    it.each(cases)('%s vs %s -> %s', (pattern, value, expected) => {
      expect(compileGlob(pattern)(value)).toBe(expected);
    });
  });

  describe('case sensitivity', () => {
    it('is case-sensitive by default', () => {
      expect(compileGlob('Work/**')('work/note.md')).toBe(false);
    });

    it('ignores case when asked', () => {
      const matches = compileGlob('Work/**', { caseInsensitive: true });
      expect(matches('work/note.md')).toBe(true);
      expect(matches('WORK/note.md')).toBe(true);
    });

    it('keeps case-sensitive and case-insensitive matchers separate in the cache', () => {
      const pattern = 'Work/**';
      expect(compileGlob(pattern)('work/note.md')).toBe(false);
      expect(compileGlob(pattern, { caseInsensitive: true })('work/note.md')).toBe(true);
      expect(compileGlob(pattern)('work/note.md')).toBe(false);
    });
  });

  describe('dotfiles', () => {
    it('matches dotted vault paths by default', () => {
      expect(compileGlob('.obsidian/**')('.obsidian/app.json')).toBe(true);
      expect(compileGlob('**/*.md')('.trash/note.md')).toBe(true);
    });

    it('can be told to skip dotfiles', () => {
      expect(compileGlob('**/*.md', { dot: false })('.trash/note.md')).toBe(false);
    });
  });

  describe('path normalization', () => {
    it('converts Windows separators before matching', () => {
      expect(compileGlob('work/**')('work\\project\\notes.md')).toBe(true);
      expect(normalizeGlobPath('a\\b\\c')).toBe('a/b/c');
    });
  });

  describe('compileGlobs', () => {
    it('passes when any pattern matches', () => {
      const matches = compileGlobs(['MSFT/**', 'AIM/**']);
      expect(matches('MSFT/note.md')).toBe(true);
      expect(matches('AIM/note.md')).toBe(true);
      expect(matches('Personal/note.md')).toBe(false);
    });

    it('never matches when given no patterns', () => {
      const matches = compileGlobs([]);
      expect(matches('anything.md')).toBe(false);
      expect(matches('')).toBe(false);
    });
  });

  describe('caching', () => {
    it('returns a working matcher on repeated compilation', () => {
      const first = compileGlob('work/**');
      const second = compileGlob('work/**');

      expect(first('work/a.md')).toBe(true);
      expect(second('work/a.md')).toBe(true);
      expect(second('other/a.md')).toBe(false);
    });

    it('keeps working after the cache is cleared', () => {
      const matches = compileGlob('work/**');
      clearGlobCache();
      expect(matches('work/a.md')).toBe(true);
      expect(compileGlob('work/**')('work/a.md')).toBe(true);
    });
  });

  describe('isValidGlob', () => {
    it('accepts well-formed patterns', () => {
      for (const pattern of ['*.md', '**/*.md', 'work/**', '{a,b}/*.md', 'note[0-9].md']) {
        expect(isValidGlob(pattern)).toBe(true);
      }
    });

    it('rejects empty or blank patterns', () => {
      expect(isValidGlob('')).toBe(false);
      expect(isValidGlob('   ')).toBe(false);
    });
  });
});
