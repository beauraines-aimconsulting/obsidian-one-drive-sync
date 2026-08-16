import { describe, it, expect } from 'vitest';
import { parseArgs, usage } from '../../src/main.js';

describe('CLI main', () => {
  it('parses dry-run and config flags', () => {
    expect(parseArgs(['--dry-run', '--config', 'custom.json'])).toEqual({
      dryRun: true,
      help: false,
      configPath: 'custom.json',
    });
  });

  it('parses help flag', () => {
    expect(parseArgs(['-h'])).toEqual({
      dryRun: false,
      help: true,
      configPath: undefined,
    });
  });

  it('returns usage text', () => {
    expect(usage()).toContain('obsidian-one-drive-sync');
  });
});
