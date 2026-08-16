import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RuleLoader } from '../../src/rules/RuleLoader.js';

describe('RuleLoader', () => {
  let loader: RuleLoader;
  let tmpDir: string;

  beforeEach(() => {
    loader = new RuleLoader('error');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruleloader-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(config: object): string {
    const filePath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(filePath, JSON.stringify(config));
    return filePath;
  }

  it('throws if config file does not exist', () => {
    expect(() => loader.loadFromFile('/nonexistent/path.json')).toThrow(
      'Rules config file not found'
    );
  });

  it('throws on invalid JSON', () => {
    const filePath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(filePath, '{ invalid json }}}');
    expect(() => loader.loadFromFile(filePath)).toThrow('Failed to parse rules config');
  });

  it('returns empty engine when no rules section', () => {
    const filePath = writeConfig({ config: {} });
    const engine = loader.loadFromFile(filePath);
    expect(engine.getRuleCount()).toBe(0);
  });

  it('loads pathRule from config', () => {
    const filePath = writeConfig({
      rules: { pathRule: { include: ['MSFT/**'] } },
    });
    const engine = loader.loadFromFile(filePath);
    expect(engine.getRuleCount()).toBe(1);
    expect(engine.getRuleNames()).toContain('PathRule');
  });

  it('loads tagRule from config', () => {
    const filePath = writeConfig({
      rules: { tagRule: { whitelist: ['ms-rte', 'aim'], requireAny: true } },
    });
    const engine = loader.loadFromFile(filePath);
    expect(engine.getRuleCount()).toBe(1);
    expect(engine.getRuleNames()).toContain('TagRule');
  });

  it('loads frontmatterRule from config', () => {
    const filePath = writeConfig({
      rules: { frontmatterRule: true },
    });
    const engine = loader.loadFromFile(filePath);
    expect(engine.getRuleCount()).toBe(1);
    expect(engine.getRuleNames()).toContain('FrontmatterRule');
  });

  it('loads multiple rules with OR composition', () => {
    const filePath = writeConfig({
      rules: {
        composition: 'OR',
        pathRule: { include: ['MSFT/**', 'AIM/**'] },
        tagRule: { whitelist: ['ms-rte', 'sbux', 'aim'], requireAny: true },
      },
    });
    const engine = loader.loadFromFile(filePath);
    expect(engine.getRuleCount()).toBe(2);
    expect(engine.getComposition()).toBe('OR');
  });

  it('evaluates correctly with loaded OR rules', () => {
    const filePath = writeConfig({
      rules: {
        composition: 'OR',
        pathRule: { include: ['MSFT/**', 'AIM/**'] },
        tagRule: { whitelist: ['ms-rte', 'sbux', 'aim'], requireAny: true },
      },
    });
    const engine = loader.loadFromFile(filePath);

    // File in MSFT path should pass
    const result1 = engine.evaluate('MSFT/project.md', {}, '');
    expect(result1.eligible).toBe(true);

    // File with matching tag should pass
    const result2 = engine.evaluate('random/file.md', { tags: ['ms-rte'] }, '');
    expect(result2.eligible).toBe(true);

    // File with no match should fail
    const result3 = engine.evaluate('personal/diary.md', { tags: ['personal'] }, '');
    expect(result3.eligible).toBe(false);
  });

  it('loads privacyRule from config', () => {
    const filePath = writeConfig({
      rules: { privacyRule: { allowPrivate: false } },
    });
    const engine = loader.loadFromFile(filePath);
    expect(engine.getRuleCount()).toBe(1);
    expect(engine.getRuleNames()).toContain('PrivacyRule');
  });

  it('loads categoryRule from config', () => {
    const filePath = writeConfig({
      rules: { categoryRule: { whitelist: ['work', 'tech'] } },
    });
    const engine = loader.loadFromFile(filePath);
    expect(engine.getRuleCount()).toBe(1);
    expect(engine.getRuleNames()).toContain('CategoryRule');
  });

  it('throws on invalid composition value', () => {
    const filePath = writeConfig({
      rules: { composition: 'INVALID' },
    });
    expect(() => loader.loadFromFile(filePath)).toThrow('Invalid rules composition');
  });

  it('throws when pathRule is not an object', () => {
    const filePath = writeConfig({
      rules: { pathRule: true },
    });
    expect(() => loader.loadFromFile(filePath)).toThrow('pathRule must be an object');
  });

  it('throws when tagRule is not an object', () => {
    const filePath = writeConfig({
      rules: { tagRule: 'bad' },
    });
    expect(() => loader.loadFromFile(filePath)).toThrow('tagRule must be an object');
  });

  it('throws when frontmatterRule is not true', () => {
    const filePath = writeConfig({
      rules: { frontmatterRule: {} },
    });
    expect(() => loader.loadFromFile(filePath)).toThrow('frontmatterRule must be true');
  });
});
