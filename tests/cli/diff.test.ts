import { describe, it, expect } from 'vitest';
import { diffLines } from '../../src/cli/diff.js';

describe('diffLines', () => {
  it('marks unchanged lines with a leading space', () => {
    expect(diffLines('a\nb', 'a\nb')).toEqual(['  a', '  b']);
  });

  it('marks removals and additions', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc')).toEqual(['  a', '- b', '+ x', '  c']);
  });

  it('handles pure insertion', () => {
    expect(diffLines('a\nc', 'a\nb\nc')).toEqual(['  a', '+ b', '  c']);
  });

  it('handles pure deletion', () => {
    expect(diffLines('a\nb\nc', 'a\nc')).toEqual(['  a', '- b', '  c']);
  });

  it('handles an empty original', () => {
    expect(diffLines('', 'a')).toEqual(['- ', '+ a']);
  });

  it('keeps the longest common subsequence rather than rewriting everything', () => {
    const output = diffLines('1\n2\n3\n4\n5', '1\n3\n5');
    expect(output.filter((line) => line.startsWith('  '))).toEqual(['  1', '  3', '  5']);
    expect(output.filter((line) => line.startsWith('-'))).toEqual(['- 2', '- 4']);
    expect(output.filter((line) => line.startsWith('+'))).toEqual([]);
  });
});
