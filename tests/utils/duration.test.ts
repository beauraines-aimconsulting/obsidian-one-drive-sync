import { describe, it, expect } from 'vitest';
import { parseDuration, isValidDuration, formatDuration } from '../../src/utils/duration.js';

describe('parseDuration', () => {
  it.each([
    ['500ms', 500],
    ['45s', 45_000],
    ['90m', 5_400_000],
    ['12h', 43_200_000],
    ['30d', 2_592_000_000],
    ['2w', 1_209_600_000],
  ])('parses %s', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each([['1.5h'], ['0.5d'], ['1h30m']])('rejects %s so the syntax stays extensible', (input) => {
    expect(() => parseDuration(input)).toThrow('Invalid duration');
  });

  it('accepts whitespace and mixed case', () => {
    expect(parseDuration('  30 D ')).toBe(2_592_000_000);
  });

  it.each([['30'], ['d'], [''], ['30 days'], ['-5m'], ['1y'], ['30dd']])('rejects %s', (input) => {
    expect(() => parseDuration(input)).toThrow('Invalid duration');
  });

  it('rejects zero because a zero-length window is never what was meant', () => {
    expect(() => parseDuration('0d')).toThrow('greater than zero');
  });

  it('names the accepted units in the error', () => {
    expect(() => parseDuration('nope')).toThrow(/ms, s, m, h, d, w/);
  });
});

describe('isValidDuration', () => {
  it('reports validity without throwing', () => {
    expect(isValidDuration('30d')).toBe(true);
    expect(isValidDuration('nope')).toBe(false);
  });
});

describe('formatDuration', () => {
  it.each([
    [1_209_600_000, '2w'],
    [2_592_000_000, '4w 2d'],
    [43_200_000, '12h'],
    [5_400_000, '1h 30m'],
    [4_500_000, '1h 15m'],
    [45_000, '45s'],
    [1500, '1s 500ms'],
    [500, '500ms'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
});
