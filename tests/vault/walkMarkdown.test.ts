import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { walkMarkdown } from '../../src/vault/walkMarkdown.js';

describe('walkMarkdown', () => {
  let vault: string;

  const write = (relative: string, content = '# note'): void => {
    const full = path.join(vault, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };

  const relativeResults = (patterns?: string[]): string[] =>
    walkMarkdown(vault, { ignorePatterns: patterns })
      .map((f) => path.relative(vault, f))
      .sort();

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-walk-'));
  });

  afterEach(() => {
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it('finds markdown files recursively', () => {
    write('note.md');
    write('nested/deep/other.md');

    expect(relativeResults()).toEqual(['nested/deep/other.md', 'note.md']);
  });

  it('ignores non-markdown files', () => {
    write('note.md');
    write('image.png', 'binary');
    write('data.json', '{}');

    expect(relativeResults()).toEqual(['note.md']);
  });

  it('skips directories matching an ignore pattern', () => {
    write('keep.md');
    write('Templates/Daily Note.md');
    write('Templates/nested/Other.md');

    expect(relativeResults(['Templates/**'])).toEqual(['keep.md']);
  });

  it('skips dotted directories such as .git and .obsidian', () => {
    write('keep.md');
    write('.git/hooks/notes.md');
    write('.obsidian/plugin/readme.md');

    expect(relativeResults(['.git/**', '.obsidian/**'])).toEqual(['keep.md']);
  });

  it('returns everything when no patterns are supplied', () => {
    write('keep.md');
    write('Templates/Daily Note.md');

    expect(relativeResults()).toEqual(['Templates/Daily Note.md', 'keep.md']);
  });

  it('returns absolute paths', () => {
    write('note.md');

    const results = walkMarkdown(vault);
    expect(results).toHaveLength(1);
    expect(path.isAbsolute(results[0])).toBe(true);
  });
});
