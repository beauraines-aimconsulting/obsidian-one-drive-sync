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

  // Rejection behaviour is unchanged; the messages now name the offending
  // config path so a user can find the value without guessing.
  it('throws on invalid composition value', () => {
    const filePath = writeConfig({
      rules: { composition: 'INVALID' },
    });
    expect(() => loader.loadFromFile(filePath)).toThrow('rules.composition');
  });

  it('throws when pathRule is not an object', () => {
    const filePath = writeConfig({
      rules: { pathRule: true },
    });
    expect(() => loader.loadFromFile(filePath)).toThrow('rules.pathRule');
  });

  it('throws when tagRule is not an object', () => {
    const filePath = writeConfig({
      rules: { tagRule: 'bad' },
    });
    expect(() => loader.loadFromFile(filePath)).toThrow('rules.tagRule');
  });

  it('throws when frontmatterRule is not true', () => {
    const filePath = writeConfig({
      rules: { frontmatterRule: {} },
    });
    expect(() => loader.loadFromFile(filePath)).toThrow('rules.frontmatterRule');
  });

  it('reports every problem at once rather than only the first', () => {
    const filePath = writeConfig({
      rules: { pathRule: { include: [''] }, tagRule: 'bad' },
    });

    expect(() => loader.loadFromFile(filePath)).toThrow(/rules\.pathRule/);
    expect(() => loader.loadFromFile(filePath)).toThrow(/rules\.tagRule/);
  });

  it('rejects unknown options instead of silently ignoring them', () => {
    const filePath = writeConfig({
      rules: { tagRule: { whitlist: ['typo'] } },
    });

    expect(() => loader.loadFromFile(filePath)).toThrow('whitlist');
  });
});

describe('RuleLoader v2 documents', () => {
  const loader = (): RuleLoader => new RuleLoader('error');

  it('loads a nested match tree', () => {
    const engine = loader().loadFromObject({
      rulesVersion: 2,
      rules: {
        definitions: {
          workPaths: { type: 'path', include: ['MSFT/**'] },
          publicTags: { type: 'tag', whitelist: ['ms-rte'], requireAny: true },
          notPrivate: { type: 'privacy', allowPrivate: false },
        },
        match: {
          all: [{ any: [{ rule: 'workPaths' }, { rule: 'publicTags' }] }, { rule: 'notPrivate' }],
        },
      },
    });

    expect(engine.evaluate('MSFT/a.md', {}, '').eligible).toBe(true);
    expect(engine.evaluate('Other/a.md', { tags: ['ms-rte'] }, '').eligible).toBe(true);
    expect(engine.evaluate('Other/a.md', {}, '').eligible).toBe(false);
    expect(engine.evaluate('MSFT/a.md', { private: true }, '').eligible).toBe(false);
  });

  it('applies negate to any rule', () => {
    const engine = loader().loadFromObject({
      rulesVersion: 2,
      rules: {
        definitions: { notWork: { type: 'path', include: ['MSFT/**'], negate: true } },
        match: { rule: 'notWork' },
      },
    });

    expect(engine.evaluate('MSFT/a.md', {}, '').eligible).toBe(false);

    const result = engine.evaluate('Personal/a.md', {}, '');
    expect(result.eligible).toBe(true);
    expect(result.appliedRules[0].reason).toContain('NOT(');
  });

  it('supports a not group around a nested tree', () => {
    const engine = loader().loadFromObject({
      rulesVersion: 2,
      rules: {
        definitions: {
          workPaths: { type: 'path', include: ['MSFT/**'] },
          publicTags: { type: 'tag', whitelist: ['ms-rte'], requireAny: true },
        },
        match: { not: { any: [{ rule: 'workPaths' }, { rule: 'publicTags' }] } },
      },
    });

    expect(engine.evaluate('MSFT/a.md', {}, '').eligible).toBe(false);
    expect(engine.evaluate('Personal/a.md', {}, '').eligible).toBe(true);
  });

  it('exposes a nested trace for grouped decisions', () => {
    const engine = loader().loadFromObject({
      rulesVersion: 2,
      rules: {
        definitions: {
          workPaths: { type: 'path', include: ['MSFT/**'] },
          publicTags: { type: 'tag', whitelist: ['ms-rte'], requireAny: true },
        },
        match: { all: [{ any: [{ rule: 'workPaths' }, { rule: 'publicTags' }] }] },
      },
    });

    const trace = engine.evaluate('MSFT/a.md', {}, '').appliedRules;
    expect(trace[0].children?.map((child) => child.name)).toEqual(['any']);
    expect(trace[0].children?.[0].children?.map((child) => child.name)).toEqual([
      'workPaths',
      'publicTags',
    ]);
  });

  it('reports every configuration error at once', () => {
    expect(() =>
      loader().loadFromObject({
        rulesVersion: 2,
        rules: {
          definitions: {
            a: { type: 'path', include: ['MSFT/**'], bogus: 1 },
            b: { type: 'tag', whitlist: ['x'] },
          },
          match: { all: [{ rule: 'a' }, { rule: 'b' }] },
        },
      })
    ).toThrow(/bogus[\s\S]*whitlist|whitlist[\s\S]*bogus/);
  });
});
