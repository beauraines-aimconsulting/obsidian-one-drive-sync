import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { formatConfigErrors, validateRulesConfig } from '../../src/rules/validateRulesConfig.js';
import { RuleLoader } from '../../src/rules/RuleLoader.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const examplePath = path.join(repoRoot, 'config.example.json');

/**
 * The example config doubles as the fixture the README's rule reference is
 * written against, so it has to stay a valid document as the schema evolves.
 */
describe('config.example.json', () => {
  const parsed: unknown = JSON.parse(fs.readFileSync(examplePath, 'utf-8'));

  it('validates cleanly', () => {
    const outcome = validateRulesConfig(parsed);
    const detail = outcome.valid ? '' : formatConfigErrors(outcome.errors);

    expect(detail).toBe('');
    expect(outcome.valid).toBe(true);
  });

  it('is already a version 2 document, so it needs no migration', () => {
    expect((parsed as { rulesVersion?: number }).rulesVersion).toBe(2);
  });

  it('loads into a working rule engine', () => {
    const engine = new RuleLoader('error').loadFromFile(examplePath, '/vault');

    expect(engine.getRuleCount()).toBeGreaterThan(0);
  });

  it('exercises every documented rule type', () => {
    const definitions = (parsed as { rules: { definitions: Record<string, { type?: string }> } })
      .rules.definitions;
    const types = new Set(
      Object.values(definitions)
        .map((definition) => definition.type)
        .filter((type): type is string => typeof type === 'string')
    );

    for (const type of ['path', 'tag', 'privacy', 'frontmatterField', 'content', 'fileMeta']) {
      expect(types).toContain(type);
    }
  });

  it('demonstrates nesting and negation', () => {
    const serialised = JSON.stringify(parsed);

    expect(serialised).toContain('"any"');
    expect(serialised).toContain('"all"');
    expect(serialised).toContain('"not"');
  });
});
