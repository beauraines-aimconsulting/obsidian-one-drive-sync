import { describe, it, expect } from 'vitest';
import { parseArgs, usage } from '../../src/main.js';

describe('CLI main', () => {
  it('parses dry-run and config flags', () => {
    expect(parseArgs(['--dry-run', '--config', 'custom.json'])).toEqual({
      dryRun: true,
      help: false,
      probe: false,
      logout: false,
      sync: false,
      forceSync: false,
      watch: false,
      configPath: 'custom.json',
    });
  });

  it('parses help flag', () => {
    expect(parseArgs(['-h'])).toEqual({
      dryRun: false,
      help: true,
      probe: false,
      logout: false,
      sync: false,
      forceSync: false,
      watch: false,
      configPath: undefined,
    });
  });

  it('parses watch and sync flags together', () => {
    const options = parseArgs(['--sync', '--watch']);
    expect(options.sync).toBe(true);
    expect(options.watch).toBe(true);
  });

  it('rejects unknown options instead of ignoring them', () => {
    expect(() => parseArgs(['--nope'])).toThrow('Unknown option: --nope');
  });

  it('returns usage text', () => {
    expect(usage()).toContain('obsidian-one-drive-sync');
  });
});
