/**
 * v1 -> v2 rules migration.
 *
 * A pure transform, used two ways: `RuleLoader` migrates legacy documents in
 * memory on every load so old configs keep working, and `--migrate-rules`
 * writes the result back to disk for users who want the new capabilities.
 */

import type {
  RuleDefinition,
  RuleNode,
  RulesDocument,
  RulesDocumentV1,
  RulesDocumentV2,
  RulesSectionV1,
} from './configTypes.js';

/**
 * Definition names deliberately match the rule names the engine already
 * reports, so log output and failure reasons do not change under migration.
 */
export const V1_DEFINITION_NAMES = {
  pathRule: 'PathRule',
  tagRule: 'TagRule',
  frontmatterRule: 'FrontmatterRule',
  privacyRule: 'PrivacyRule',
  categoryRule: 'CategoryRule',
} as const;

function isV2(document: RulesDocument): document is RulesDocumentV2 {
  return (document as RulesDocumentV2).rulesVersion === 2;
}

function buildDefinitions(rules: RulesSectionV1): Record<string, RuleDefinition> {
  const definitions: Record<string, RuleDefinition> = {};

  if (rules.pathRule) {
    definitions[V1_DEFINITION_NAMES.pathRule] = { type: 'path', ...rules.pathRule };
  }
  if (rules.tagRule) {
    definitions[V1_DEFINITION_NAMES.tagRule] = { type: 'tag', ...rules.tagRule };
  }
  if (rules.frontmatterRule) {
    definitions[V1_DEFINITION_NAMES.frontmatterRule] = { type: 'frontmatter' };
  }
  if (rules.privacyRule) {
    definitions[V1_DEFINITION_NAMES.privacyRule] = { type: 'privacy', ...rules.privacyRule };
  }
  if (rules.categoryRule) {
    definitions[V1_DEFINITION_NAMES.categoryRule] = { type: 'category', ...rules.categoryRule };
  }

  return definitions;
}

/**
 * Migrate a rules document to v2. Already-v2 documents are returned unchanged,
 * so this is safe to call unconditionally.
 *
 * Every other top-level key — notably the `config` section owned by
 * `ConfigManager` — is preserved verbatim.
 */
export function migrateRulesDocument(document: RulesDocument): RulesDocumentV2 {
  if (isV2(document)) return document;

  const source = document as RulesDocumentV1 & Record<string, unknown>;
  const rules = source.rules;
  // `rulesVersion` is replaced below; everything else is carried across as-is.
  const rest = { ...source };
  delete rest.rules;
  delete rest.rulesVersion;

  if (!rules) {
    return { ...rest, rulesVersion: 2 } as RulesDocumentV2;
  }

  const definitions = buildDefinitions(rules);
  const names = Object.keys(definitions);

  if (names.length === 0) {
    return { ...rest, rulesVersion: 2, rules: {} } as RulesDocumentV2;
  }

  const references: RuleNode[] = names.map((name) => ({ rule: name }));
  const match: RuleNode = rules.composition === 'OR' ? { any: references } : { all: references };

  return { ...rest, rulesVersion: 2, rules: { definitions, match } } as RulesDocumentV2;
}

/** True when a document still uses the legacy shape. */
export function needsMigration(document: RulesDocument): boolean {
  return !isV2(document);
}
