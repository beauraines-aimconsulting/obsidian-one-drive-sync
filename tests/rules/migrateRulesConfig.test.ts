import { describe, it, expect } from 'vitest';
import { migrateRulesDocument, needsMigration } from '../../src/rules/migrateRulesConfig.js';
import type { RulesDocument } from '../../src/rules/configTypes.js';

describe('migrateRulesConfig', () => {
  describe('needsMigration', () => {
    it('is true for a document with no version', () => {
      expect(needsMigration({ rules: { pathRule: { include: ['a/**'] } } })).toBe(true);
    });

    it('is true for an explicit version 1', () => {
      expect(needsMigration({ rulesVersion: 1, rules: {} })).toBe(true);
    });

    it('is false for version 2', () => {
      expect(needsMigration({ rulesVersion: 2, rules: { match: { rule: 'a' } } })).toBe(false);
    });
  });

  describe('migrateRulesDocument', () => {
    it('turns AND composition into an all group', () => {
      const migrated = migrateRulesDocument({
        rules: {
          composition: 'AND',
          pathRule: { include: ['MSFT/**'] },
          privacyRule: { allowPrivate: false },
        },
      });

      expect(migrated.rulesVersion).toBe(2);
      expect(migrated.rules?.match).toEqual({
        all: [{ rule: 'PathRule' }, { rule: 'PrivacyRule' }],
      });
    });

    it('turns OR composition into an any group', () => {
      const migrated = migrateRulesDocument({
        rules: {
          composition: 'OR',
          pathRule: { include: ['a/**'] },
          tagRule: { allowList: ['x'] },
        },
      });

      expect(migrated.rules?.match).toEqual({ any: [{ rule: 'PathRule' }, { rule: 'TagRule' }] });
    });

    it('defaults to AND when no composition is given', () => {
      const migrated = migrateRulesDocument({
        rules: { pathRule: { include: ['a/**'] }, frontmatterRule: true },
      });
      expect(migrated.rules?.match).toEqual({
        all: [{ rule: 'PathRule' }, { rule: 'FrontmatterRule' }],
      });
    });

    it('carries each rule body into definitions with its type tag', () => {
      const migrated = migrateRulesDocument({
        rules: { tagRule: { allowList: ['ms-rte'], ignoreList: ['private'], requireAny: true } },
      });

      expect(migrated.rules?.definitions).toEqual({
        TagRule: { type: 'tag', allowList: ['ms-rte'], ignoreList: ['private'], requireAny: true },
      });
    });

    it('expands a boolean rule into an empty definition', () => {
      const migrated = migrateRulesDocument({ rules: { frontmatterRule: true } });

      expect(migrated.rules?.definitions).toEqual({ FrontmatterRule: { type: 'frontmatter' } });
      expect(migrated.rules?.match).toEqual({ all: [{ rule: 'FrontmatterRule' }] });
    });

    it('drops rules disabled with false', () => {
      const migrated = migrateRulesDocument({
        rules: { frontmatterRule: false, pathRule: { include: ['a/**'] } },
      });

      expect(Object.keys(migrated.rules?.definitions ?? {})).toEqual(['PathRule']);
      expect(migrated.rules?.match).toEqual({ all: [{ rule: 'PathRule' }] });
    });

    it('omits match entirely when no rules are configured', () => {
      const migrated = migrateRulesDocument({ rules: {} });

      expect(migrated.rulesVersion).toBe(2);
      expect(migrated.rules?.match).toBeUndefined();
      expect(migrated.rules?.definitions).toBeUndefined();
    });

    it('is a no-op for a document already at version 2', () => {
      const document: RulesDocument = {
        rulesVersion: 2,
        rules: { definitions: { a: { type: 'privacy' } }, match: { rule: 'a' } },
      };

      expect(migrateRulesDocument(document)).toEqual(document);
    });

    it('preserves sections it does not own', () => {
      const migrated = migrateRulesDocument({
        config: { vaultPath: '~/vault', publicationRoot: 'Public' },
        rules: { pathRule: { include: ['a/**'] } },
      } as RulesDocument);

      expect((migrated as Record<string, unknown>).config).toEqual({
        vaultPath: '~/vault',
        publicationRoot: 'Public',
      });
    });

    it('does not mutate the input document', () => {
      const document: RulesDocument = { rules: { pathRule: { include: ['a/**'] } } };
      const snapshot = JSON.parse(JSON.stringify(document));

      migrateRulesDocument(document);

      expect(document).toEqual(snapshot);
    });
  });
});
