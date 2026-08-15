import { describe, it, expect } from 'vitest';
import { FrontmatterRule } from '../../src/rules/implementations/FrontmatterRule.js';
import { PrivacyRule } from '../../src/rules/implementations/PrivacyRule.js';
import { CategoryRule } from '../../src/rules/implementations/CategoryRule.js';
import { TagRule } from '../../src/rules/implementations/TagRule.js';
import { PathRule } from '../../src/rules/implementations/PathRule.js';

describe('Publication Rules', () => {
  describe('FrontmatterRule', () => {
    const rule = new FrontmatterRule();

    it('should pass when publish is true', () => {
      const result = rule.evaluate('test.md', { publish: true }, '');
      expect(result.passed).toBe(true);
    });

    it('should fail when publish is false', () => {
      const result = rule.evaluate('test.md', { publish: false }, '');
      expect(result.passed).toBe(false);
    });

    it('should fail when publish is missing', () => {
      const result = rule.evaluate('test.md', {}, '');
      expect(result.passed).toBe(false);
    });
  });

  describe('PrivacyRule', () => {
    it('should fail when file is private', () => {
      const rule = new PrivacyRule();
      const result = rule.evaluate('test.md', { private: true }, '');
      expect(result.passed).toBe(false);
    });

    it('should pass when file is not private', () => {
      const rule = new PrivacyRule();
      const result = rule.evaluate('test.md', { private: false }, '');
      expect(result.passed).toBe(true);
    });

    it('should allow private files when configured', () => {
      const rule = new PrivacyRule({ allowPrivate: true });
      const result = rule.evaluate('test.md', { private: true }, '');
      expect(result.passed).toBe(true);
    });
  });

  describe('CategoryRule', () => {
    it('should pass with whitelist match', () => {
      const rule = new CategoryRule({
        whitelist: ['work', 'projects'],
      });
      const result = rule.evaluate('test.md', { category: 'work' }, '');
      expect(result.passed).toBe(true);
    });

    it('should fail with whitelist mismatch', () => {
      const rule = new CategoryRule({
        whitelist: ['work', 'projects'],
      });
      const result = rule.evaluate('test.md', { category: 'personal' }, '');
      expect(result.passed).toBe(false);
    });

    it('should fail with blacklist match', () => {
      const rule = new CategoryRule({
        blacklist: ['personal', 'private'],
      });
      const result = rule.evaluate('test.md', { category: 'personal' }, '');
      expect(result.passed).toBe(false);
    });

    it('should pass with multiple categories and one whitelisted', () => {
      const rule = new CategoryRule({
        whitelist: ['work'],
      });
      const result = rule.evaluate(
        'test.md',
        { category: ['work', 'projects'] },
        ''
      );
      expect(result.passed).toBe(true);
    });
  });

  describe('TagRule', () => {
    it('should pass when tags are in whitelist', () => {
      const rule = new TagRule({
        whitelist: ['important', 'urgent'],
      });
      const result = rule.evaluate(
        'test.md',
        { tags: ['important', 'work'] },
        ''
      );
      expect(result.passed).toBe(false); // 'work' not in whitelist
    });

    it('should fail when any tag is blacklisted', () => {
      const rule = new TagRule({
        blacklist: ['draft', 'wip'],
      });
      const result = rule.evaluate('test.md', { tags: ['important', 'draft'] }, '');
      expect(result.passed).toBe(false);
    });

    it('should pass with requireAny when at least one tag matches', () => {
      const rule = new TagRule({
        whitelist: ['important', 'urgent'],
        requireAny: true,
      });
      const result = rule.evaluate(
        'test.md',
        { tags: ['work', 'important'] },
        ''
      );
      expect(result.passed).toBe(true);
    });

    it('should fail with requireAny when no tags match', () => {
      const rule = new TagRule({
        whitelist: ['important', 'urgent'],
        requireAny: true,
      });
      const result = rule.evaluate('test.md', { tags: ['work', 'routine'] }, '');
      expect(result.passed).toBe(false);
    });
  });

  describe('PathRule', () => {
    it('should pass when path matches include pattern', () => {
      const rule = new PathRule({
        include: ['work/**', 'projects/**'],
      });
      const result = rule.evaluate('work/project1/notes.md', {}, '');
      expect(result.passed).toBe(true);
    });

    it('should fail when path does not match include pattern', () => {
      const rule = new PathRule({
        include: ['work/**'],
      });
      const result = rule.evaluate('personal/diary.md', {}, '');
      expect(result.passed).toBe(false);
    });

    it('should fail when path matches exclude pattern', () => {
      const rule = new PathRule({
        exclude: ['draft/**', '.archived/**'],
      });
      const result = rule.evaluate('draft/incomplete.md', {}, '');
      expect(result.passed).toBe(false);
    });

    it('should pass when exclude patterns do not match', () => {
      const rule = new PathRule({
        exclude: ['draft/**'],
      });
      const result = rule.evaluate('work/complete.md', {}, '');
      expect(result.passed).toBe(true);
    });
  });
});
