import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileMetaRule } from '../../src/rules/implementations/FileMetaRule.js';
import type { FileMetaRuleConfig } from '../../src/rules/implementations/FileMetaRule.js';
import type { Frontmatter } from '../../src/rules/Rule.js';

describe('FileMetaRule', () => {
  let vaultPath: string;

  const writeNote = (relativePath: string, contents: string, ageMs = 0): void => {
    const absolute = path.join(vaultPath, relativePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents);

    if (ageMs > 0) {
      const when = new Date(Date.now() - ageMs);
      fs.utimesSync(absolute, when, when);
    }
  };

  const evaluate = (config: FileMetaRuleConfig, filepath = 'note.md') =>
    new FileMetaRule({ vaultPath, ...config }).evaluate(filepath, {} as Frontmatter, '');

  beforeEach(() => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'file-meta-'));
  });

  afterEach(() => {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  describe('size', () => {
    beforeEach(() => writeNote('note.md', 'x'.repeat(100)));

    it('accepts a file within bounds', () => {
      expect(evaluate({ minSize: 50, maxSize: 200 }).passed).toBe(true);
    });

    it('rejects a file under the minimum', () => {
      const result = evaluate({ minSize: 500 });

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('under the 500 byte minimum');
    });

    it('rejects a file over the maximum', () => {
      expect(evaluate({ maxSize: 50 }).passed).toBe(false);
    });

    it('treats the bounds as inclusive', () => {
      expect(evaluate({ minSize: 100, maxSize: 100 }).passed).toBe(true);
    });
  });

  describe('modification time', () => {
    beforeEach(() => {
      writeNote('fresh.md', 'recent');
      writeNote('stale.md', 'old', 40 * 24 * 60 * 60 * 1000);
    });

    it('accepts a file modified within the window', () => {
      expect(evaluate({ modifiedWithin: '30d' }, 'fresh.md').passed).toBe(true);
    });

    it('rejects a file older than the window', () => {
      const result = evaluate({ modifiedWithin: '30d' }, 'stale.md');

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('outside the required window');
    });

    it('accepts a file older than modifiedBefore', () => {
      expect(evaluate({ modifiedBefore: '30d' }, 'stale.md').passed).toBe(true);
      expect(evaluate({ modifiedBefore: '30d' }, 'fresh.md').passed).toBe(false);
    });

    it('rejects a malformed duration at construction', () => {
      expect(() => new FileMetaRule({ modifiedWithin: 'soon' })).toThrow('Invalid duration');
    });
  });

  describe('extensions', () => {
    beforeEach(() => {
      writeNote('note.md', 'markdown');
      writeNote('sheet.csv', 'a,b');
    });

    it('accepts a listed extension with or without the dot', () => {
      expect(evaluate({ extensions: ['md'] }, 'note.md').passed).toBe(true);
      expect(evaluate({ extensions: ['.md'] }, 'note.md').passed).toBe(true);
    });

    it('rejects an unlisted extension', () => {
      const result = evaluate({ extensions: ['md'] }, 'sheet.csv');

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('csv');
    });

    it('ignores case', () => {
      expect(evaluate({ extensions: ['MD'] }, 'note.md').passed).toBe(true);
    });

    it('does not stat the file when only the extension is checked', () => {
      expect(evaluate({ extensions: ['md'] }, 'never/created.md').passed).toBe(true);
    });
  });

  describe('unreadable files', () => {
    it('fails rather than throwing when the file is missing', () => {
      const result = evaluate({ maxSize: 100 }, 'gone.md');

      expect(result.passed).toBe(false);
      expect(result.reason).toBe('File not accessible');
    });
  });

  it('passes when nothing is configured', () => {
    writeNote('note.md', 'x');
    expect(evaluate({}).passed).toBe(true);
  });

  it('accepts an absolute path without a vault root', () => {
    writeNote('note.md', 'x'.repeat(10));
    const rule = new FileMetaRule({ maxSize: 100 });

    expect(rule.evaluate(path.join(vaultPath, 'note.md'), {} as Frontmatter, '').passed).toBe(true);
  });
});
