import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { migrateRulesFile } from '../../src/cli/migrateRules.js';

describe('migrateRulesFile', () => {
  let directory: string;
  let configPath: string;
  let output: string[];

  const log = (message: string): void => {
    output.push(message);
  };
  const logged = (): string => output.join('\n');

  const write = (value: unknown): void => {
    fs.writeFileSync(configPath, `${JSON.stringify(value, null, 2)}\n`);
  };

  const v1Config = {
    config: { vaultPath: '~/vault' },
    rules: {
      composition: 'OR',
      pathRule: { include: ['MSFT/**'] },
      tagRule: { allowList: ['ms-rte'], requireAny: true },
    },
  };

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-rules-'));
    configPath = path.join(directory, 'config.json');
    output = [];
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  describe('preview mode', () => {
    beforeEach(() => write(v1Config));

    it('reports success without writing anything', () => {
      const before = fs.readFileSync(configPath, 'utf-8');
      const code = migrateRulesFile(configPath, { confirm: false, log });

      expect(code).toBe(0);
      expect(fs.readFileSync(configPath, 'utf-8')).toBe(before);
      expect(logged()).toContain('Re-run with --yes');
    });

    it('shows the added and removed lines', () => {
      migrateRulesFile(configPath, { confirm: false, log });

      const lines = logged()
        .split('\n')
        .map((line) => line.trim());
      expect(lines).toContain('+   "rulesVersion": 2,');
      expect(lines).toContain('-     "composition": "OR",');
    });

    it('creates no backup file', () => {
      migrateRulesFile(configPath, { confirm: false, log });

      expect(fs.existsSync(`${configPath}.v1.bak`)).toBe(false);
    });
  });

  describe('confirmed migration', () => {
    beforeEach(() => write(v1Config));

    it('rewrites the file as version 2', () => {
      const code = migrateRulesFile(configPath, { confirm: true, log });
      const result = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      expect(code).toBe(0);
      expect(result.rulesVersion).toBe(2);
      expect(result.rules.match).toEqual({ any: [{ rule: 'PathRule' }, { rule: 'TagRule' }] });
      expect(result.rules.definitions.PathRule).toEqual({ type: 'path', include: ['MSFT/**'] });
    });

    it('preserves the config section', () => {
      migrateRulesFile(configPath, { confirm: true, log });

      expect(JSON.parse(fs.readFileSync(configPath, 'utf-8')).config).toEqual({
        vaultPath: '~/vault',
      });
    });

    it('keeps the original alongside as a .v1.bak backup', () => {
      const before = fs.readFileSync(configPath, 'utf-8');
      migrateRulesFile(configPath, { confirm: true, log });

      expect(fs.readFileSync(`${configPath}.v1.bak`, 'utf-8')).toBe(before);
      expect(logged()).toContain('.v1.bak');
    });

    it('is idempotent when run twice', () => {
      migrateRulesFile(configPath, { confirm: true, log });
      const first = fs.readFileSync(configPath, 'utf-8');

      output = [];
      const code = migrateRulesFile(configPath, { confirm: true, log });

      expect(code).toBe(0);
      expect(fs.readFileSync(configPath, 'utf-8')).toBe(first);
      expect(logged()).toContain('already rulesVersion 2');
    });
  });

  describe('refusals', () => {
    it('fails when the file does not exist', () => {
      const code = migrateRulesFile(path.join(directory, 'nope.json'), { confirm: true, log });

      expect(code).toBe(1);
      expect(logged()).toContain('not found');
    });

    it('fails on malformed JSON without touching the file', () => {
      fs.writeFileSync(configPath, '{ not json');
      const code = migrateRulesFile(configPath, { confirm: true, log });

      expect(code).toBe(1);
      expect(logged()).toContain('Failed to parse');
      expect(fs.readFileSync(configPath, 'utf-8')).toBe('{ not json');
    });

    it('refuses to migrate an invalid configuration', () => {
      write({ rules: { composition: 'SOMETIMES', pathRule: { include: ['a/**'] } } });
      const code = migrateRulesFile(configPath, { confirm: true, log });

      expect(code).toBe(1);
      expect(logged()).toContain('Cannot migrate an invalid rules configuration');
      expect(fs.existsSync(`${configPath}.v1.bak`)).toBe(false);
    });

    it('leaves an already-migrated file alone', () => {
      write({
        rulesVersion: 2,
        rules: { definitions: { a: { type: 'privacy' } }, match: { rule: 'a' } },
      });
      const before = fs.readFileSync(configPath, 'utf-8');

      expect(migrateRulesFile(configPath, { confirm: true, log })).toBe(0);
      expect(fs.readFileSync(configPath, 'utf-8')).toBe(before);
    });
  });
});
