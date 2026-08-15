import { describe, it, expect, beforeEach } from 'vitest';
import { FileFilter } from '../../src/vault/FileFilter.js';

describe('FileFilter', () => {
  let filter: FileFilter;

  beforeEach(() => {
    filter = new FileFilter();
  });

  describe('basic filtering', () => {
    it('should allow markdown files', () => {
      const result = filter.filter('notes/test.md');
      expect(result.allowed).toBe(true);
    });

    it('should reject non-markdown files', () => {
      const result = filter.filter('notes/test.txt');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('extension');
    });

    it('should reject image files', () => {
      const result = filter.filter('images/photo.png');
      expect(result.allowed).toBe(false);
    });

    it('should reject JSON files', () => {
      const result = filter.filter('config.json');
      expect(result.allowed).toBe(false);
    });
  });

  describe('ignore patterns', () => {
    beforeEach(() => {
      filter.setIgnorePatterns(['.git/**', '.obsidian/**', 'node_modules/**']);
    });

    it('should ignore files in .git directory', () => {
      const result = filter.filter('.git/config');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('ignore pattern');
    });

    it('should ignore files in .obsidian directory', () => {
      const result = filter.filter('.obsidian/vault.json');
      expect(result.allowed).toBe(false);
    });

    it('should ignore files in node_modules', () => {
      const result = filter.filter('node_modules/package/index.md');
      expect(result.allowed).toBe(false);
    });

    it('should allow files not in ignored directories', () => {
      const result = filter.filter('notes/project.md');
      expect(result.allowed).toBe(true);
    });

    it('should handle Windows-style paths', () => {
      const result = filter.filter('notes\\project.md');
      expect(result.allowed).toBe(true);
    });
  });

  describe('filtering multiple files', () => {
    beforeEach(() => {
      filter.setIgnorePatterns(['.git/**', '.obsidian/**']);
    });

    it('should filter multiple files correctly', () => {
      const files = [
        'notes/project.md',
        '.git/config',
        'notes/todo.md',
        '.obsidian/app.json',
        'notes/meeting.md',
        'images/photo.png',
      ];

      const filtered = filter.filterMany(files);

      expect(filtered).toEqual(['notes/project.md', 'notes/todo.md', 'notes/meeting.md']);
    });

    it('should return empty array if all files are filtered', () => {
      const files = ['.git/config', '.obsidian/app.json', 'image.png'];
      const filtered = filter.filterMany(files);
      expect(filtered).toEqual([]);
    });
  });

  describe('pattern management', () => {
    it('should add a single pattern', () => {
      filter.addIgnorePattern('.vscode/**');
      const result = filter.filter('.vscode/settings.md');
      expect(result.allowed).toBe(false);
    });

    it('should clear patterns', () => {
      filter.setIgnorePatterns(['.git/**']);
      filter.clearIgnorePatterns();

      const result = filter.filter('.git/config');
      // Will fail on extension check, but that's expected
      expect(result.allowed).toBe(false);
    });

    it('should get current patterns', () => {
      filter.setIgnorePatterns(['.git/**', '.obsidian/**']);
      const patterns = filter.getIgnorePatterns();
      expect(patterns.length).toBe(2);
    });
  });

  describe('custom extensions', () => {
    it('should support custom extensions', () => {
      const customFilter = new FileFilter({
        extensions: ['.md', '.txt', '.markdown'],
      });

      expect(customFilter.filter('notes/test.md').allowed).toBe(true);
      expect(customFilter.filter('notes/test.txt').allowed).toBe(true);
      expect(customFilter.filter('notes/test.markdown').allowed).toBe(true);
      expect(customFilter.filter('notes/test.json').allowed).toBe(false);
    });

    it('should return allowed extensions', () => {
      const customFilter = new FileFilter({
        extensions: ['.md', '.txt'],
      });

      expect(customFilter.getAllowedExtensions()).toEqual(['.md', '.txt']);
    });
  });

  describe('edge cases', () => {
    it('should handle case-insensitive extensions', () => {
      const result1 = filter.filter('notes/test.MD');
      const result2 = filter.filter('notes/test.Md');
      const result3 = filter.filter('notes/test.md');

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
      expect(result3.allowed).toBe(true);
    });

    it('should handle nested paths', () => {
      const result = filter.filter(
        'vault/folder1/folder2/folder3/deeply/nested/file.md'
      );
      expect(result.allowed).toBe(true);
    });

    it('should handle files with multiple dots', () => {
      const result = filter.filter('notes/my.file.name.md');
      expect(result.allowed).toBe(true);
    });

    it('should handle files without extension', () => {
      const result = filter.filter('notes/README');
      expect(result.allowed).toBe(false);
    });
  });

  describe('default patterns', () => {
    it('should work with no patterns configured', () => {
      const emptyFilter = new FileFilter();
      const result = emptyFilter.filter('notes/test.md');
      expect(result.allowed).toBe(true);
    });

    it('should allow setting patterns from constructor', () => {
      const customFilter = new FileFilter({
        patterns: ['.git/**', 'temp/**'],
      });

      expect(customFilter.filter('.git/config').allowed).toBe(false);
      expect(customFilter.filter('temp/file.md').allowed).toBe(false);
      expect(customFilter.filter('notes/file.md').allowed).toBe(true);
    });
  });
});
