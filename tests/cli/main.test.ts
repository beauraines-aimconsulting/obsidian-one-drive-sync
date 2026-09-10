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
      migrateRules: false,
      yes: false,
      explainJson: false,
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
      migrateRules: false,
      yes: false,
      explainJson: false,
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

  it('parses the rules migration flags', () => {
    const options = parseArgs(['--migrate-rules', '--yes']);
    expect(options.migrateRules).toBe(true);
    expect(options.yes).toBe(true);
  });

  it('rejects migrating rules while syncing or watching', () => {
    expect(() => parseArgs(['--migrate-rules', '--sync'])).toThrow('--migrate-rules');
    expect(() => parseArgs(['--migrate-rules', '--watch'])).toThrow('--migrate-rules');
  });

  it('returns usage text', () => {
    expect(usage()).toContain('obsidian-one-drive-sync');
  });
});

describe('CLI --explain', () => {
  it('parses a file path', () => {
    const options = parseArgs(['--explain', 'Notes/a.md']);
    expect(options.explain).toBe('Notes/a.md');
    expect(options.explainJson).toBe(false);
  });

  it('parses --explain-json alongside --explain', () => {
    const options = parseArgs(['--explain', 'Notes/a.md', '--explain-json']);
    expect(options.explainJson).toBe(true);
  });

  it('works with --config', () => {
    const options = parseArgs(['--config', 'custom.json', '--explain', 'a.md']);
    expect(options.configPath).toBe('custom.json');
    expect(options.explain).toBe('a.md');
  });

  it('requires a path', () => {
    expect(() => parseArgs(['--explain'])).toThrow(/requires a vault-relative file path/);
  });

  it('rejects a following flag in place of a path', () => {
    expect(() => parseArgs(['--explain', '--dry-run'])).toThrow(
      /requires a vault-relative file path/
    );
  });

  it.each(['--sync', '--watch', '--probe', '--logout', '--force-sync', '--migrate-rules'])(
    'rejects being combined with %s',
    (flag) => {
      expect(() => parseArgs(['--explain', 'a.md', flag])).toThrow(
        /--explain cannot be combined with/
      );
    }
  );

  it('rejects --explain-json on its own', () => {
    expect(() => parseArgs(['--explain-json'])).toThrow(/requires --explain/);
  });

  it('is documented in the usage text', () => {
    expect(usage()).toContain('--explain <path>');
    expect(usage()).toContain('--explain-json');
  });
});

describe('CLI --schedule', () => {
  it('parses an interval and implies --sync', () => {
    const options = parseArgs(['--schedule', '1h']);
    expect(options.schedule).toBe('1h');
    expect(options.sync).toBe(true);
  });

  it('combines with --watch and --dry-run', () => {
    const options = parseArgs(['--schedule', '15m', '--watch', '--dry-run']);
    expect(options.schedule).toBe('15m');
    expect(options.watch).toBe(true);
    expect(options.dryRun).toBe(true);
    expect(options.sync).toBe(true);
  });

  it('requires a value', () => {
    expect(() => parseArgs(['--schedule'])).toThrow(/requires an interval/);
  });

  it('rejects a value that looks like another flag', () => {
    expect(() => parseArgs(['--schedule', '--watch'])).toThrow(/requires an interval/);
  });

  it('rejects an unparseable interval', () => {
    expect(() => parseArgs(['--schedule', 'hourly'])).toThrow();
  });

  it('rejects a bare number without units', () => {
    expect(() => parseArgs(['--schedule', '60'])).toThrow();
  });

  it.each(['--probe', '--logout', '--migrate-rules'])(
    'rejects --schedule with %s',
    (flag) => {
      expect(() => parseArgs(['--schedule', '1h', flag])).toThrow(
        /--schedule cannot be combined with/
      );
    }
  );

  it('rejects --schedule with --explain', () => {
    expect(() => parseArgs(['--explain', 'a.md', '--schedule', '1h'])).toThrow(
      /--explain cannot be combined with/
    );
  });

  it('documents the flag in the usage text', () => {
    expect(usage()).toContain('--schedule <interval>');
  });
});
