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
    it('should pass with allowList match', () => {
      const rule = new CategoryRule({
        allowList: ['work', 'projects'],
      });
      const result = rule.evaluate('test.md', { category: 'work' }, '');
      expect(result.passed).toBe(true);
    });

    it('should fail with allowList mismatch', () => {
      const rule = new CategoryRule({
        allowList: ['work', 'projects'],
      });
      const result = rule.evaluate('test.md', { category: 'personal' }, '');
      expect(result.passed).toBe(false);
    });

    it('should fail with ignoreList match', () => {
      const rule = new CategoryRule({
        ignoreList: ['personal', 'private'],
      });
      const result = rule.evaluate('test.md', { category: 'personal' }, '');
      expect(result.passed).toBe(false);
    });

    it('should pass with multiple categories and one allowListed', () => {
      const rule = new CategoryRule({
        allowList: ['work'],
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
    it('should pass when tags are in allowList', () => {
      const rule = new TagRule({
        allowList: ['important', 'urgent'],
      });
      const result = rule.evaluate(
        'test.md',
        { tags: ['important', 'work'] },
        ''
      );
      expect(result.passed).toBe(false); // 'work' not in allowList
    });

    it('should fail when any tag is ignoreListed', () => {
      const rule = new TagRule({
        ignoreList: ['draft', 'wip'],
      });
      const result = rule.evaluate('test.md', { tags: ['important', 'draft'] }, '');
      expect(result.passed).toBe(false);
    });

    it('should pass with requireAny when at least one tag matches', () => {
      const rule = new TagRule({
        allowList: ['important', 'urgent'],
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
        allowList: ['important', 'urgent'],
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

    // Path normalization tests
    it('should normalize backslashes to forward slashes', () => {
      const rule = new PathRule({
        include: ['work/**'],
      });
      const result = rule.evaluate('work\\project\\notes.md', {}, '');
      expect(result.passed).toBe(true);
    });

    it('should normalize absolute paths when vaultPath is configured', () => {
      const rule = new PathRule({
        include: ['work/**'],
        vaultPath: '/home/user/vault',
      });
      const result = rule.evaluate('/home/user/vault/work/notes.md', {}, '');
      expect(result.passed).toBe(true);
    });

    it('should handle Windows-style absolute paths when vaultPath is configured', () => {
      const rule = new PathRule({
        include: ['work/**'],
        vaultPath: 'C:\\Users\\user\\vault',
      });
      const result = rule.evaluate('C:\\Users\\user\\vault\\work\\notes.md', {}, '');
      expect(result.passed).toBe(true);
    });

    it('should still accept relative paths when vaultPath is configured', () => {
      const rule = new PathRule({
        include: ['work/**'],
        vaultPath: '/home/user/vault',
      });
      const result = rule.evaluate('work/notes.md', {}, '');
      expect(result.passed).toBe(true);
    });

    it('should fail when absolute path is outside vault and does not match relative pattern', () => {
      const rule = new PathRule({
        include: ['work/**'],
        vaultPath: '/home/user/vault',
      });
      const result = rule.evaluate('/home/user/other/work/notes.md', {}, '');
      expect(result.passed).toBe(false);
    });

    it('should normalize mixed slash paths', () => {
      const rule = new PathRule({
        include: ['work/**'],
      });
      const result = rule.evaluate('work\\project/notes.md', {}, '');
      expect(result.passed).toBe(true);
    });
  });
});
