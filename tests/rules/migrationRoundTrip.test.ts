import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { RuleLoader } from '../../src/rules/RuleLoader.js';
import { migrateRulesDocument } from '../../src/rules/migrateRulesConfig.js';
import type { RulesDocument } from '../../src/rules/configTypes.js';

/**
 * The migration is only safe if it is decision-preserving. Rather than assert
 * on the migrated shape, this exercises the repository's own `config.json`
 * through both the v1 and the migrated v2 path and requires identical answers.
 */
describe('rules migration round-trip', () => {
  const configPath = path.resolve(process.cwd(), 'config.json');
  const original = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as RulesDocument;

  const samples: Array<{
    name: string;
    filepath: string;
    frontmatter: Record<string, unknown>;
    content: string;
  }> = [
    {
      name: 'included path, no tags',
      filepath: 'MSFT/design/notes.md',
      frontmatter: {},
      content: '',
    },
    { name: 'second included path', filepath: 'AIM/clients/acme.md', frontmatter: {}, content: '' },
    {
      name: 'excluded path, no tags',
      filepath: 'Personal/journal.md',
      frontmatter: {},
      content: '',
    },
    {
      name: 'excluded path, whitelisted tag',
      filepath: 'Personal/journal.md',
      frontmatter: { tags: ['ms-rte'] },
      content: '',
    },
    {
      name: 'excluded path, other whitelisted tag',
      filepath: 'Random/thing.md',
      frontmatter: { tags: ['sbux'] },
      content: '',
    },
    {
      name: 'excluded path, unlisted tag',
      filepath: 'Random/thing.md',
      frontmatter: { tags: ['personal'] },
      content: '',
    },
    {
      name: 'included path and whitelisted tag',
      filepath: 'MSFT/design/notes.md',
      frontmatter: { tags: ['aim'] },
      content: '',
    },
    { name: 'root-level note', filepath: 'inbox.md', frontmatter: {}, content: '' },
    {
      name: 'nested below an included root',
      filepath: 'MSFT/a/b/c/deep.md',
      frontmatter: { tags: [] },
      content: '',
    },
  ];

  const v1Engine = new RuleLoader().loadFromObject(original);
  const v2Engine = new RuleLoader().loadFromObject(migrateRulesDocument(original));

  it('migrates the repository config without changing its version in place', () => {
    expect(original.rulesVersion).toBeUndefined();
    expect(migrateRulesDocument(original).rulesVersion).toBe(2);
  });

  it.each(samples)('decides $name identically before and after migration', (sample) => {
    const before = v1Engine.evaluate(sample.filepath, sample.frontmatter, sample.content);
    const after = v2Engine.evaluate(sample.filepath, sample.frontmatter, sample.content);

    expect(after.eligible).toBe(before.eligible);
    expect(after.reason).toBe(before.reason);
    expect(after.appliedRules.map((rule) => ({ name: rule.name, passed: rule.passed }))).toEqual(
      before.appliedRules.map((rule) => ({ name: rule.name, passed: rule.passed }))
    );
  });

  it('keeps the config section untouched by the migration', () => {
    const migrated = migrateRulesDocument(original) as Record<string, unknown>;
    expect(migrated.config).toEqual((original as Record<string, unknown>).config);
  });
});
