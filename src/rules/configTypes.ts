/**
 * Rules configuration types.
 *
 * Two document shapes are supported:
 *
 * - **v1** (no `rulesVersion` key) — the original flat shape, where each rule
 *   is a named key under `rules` and a single `composition` combines them all.
 * - **v2** (`rulesVersion: 2`) — named rule `definitions` plus a `match` tree
 *   that composes them with `all` / `any` / `not` to any depth.
 *
 * v1 documents keep loading: `RuleLoader` migrates them in memory. The version
 * key gates the new capabilities, it does not invalidate old files.
 */

/** A node in the `match` tree. */
export type RuleNode =
  { all: RuleNode[] } | { any: RuleNode[] } | { not: RuleNode } | { rule: string };

export interface BaseRuleDefinition {
  /** Invert this rule's outcome. */
  negate?: boolean;
}

export interface PathRuleDefinition extends BaseRuleDefinition {
  type: 'path';
  include?: string[];
  exclude?: string[];
  caseInsensitive?: boolean;
  vaultPath?: string;
}

export interface TagRuleDefinition extends BaseRuleDefinition {
  type: 'tag';
  allowList?: string[];
  ignoreList?: string[];
  requireAny?: boolean;
  requireAll?: boolean;
  source?: 'frontmatter' | 'inline' | 'task' | 'both' | 'all';
  caseInsensitive?: boolean;
  matchNested?: boolean;
}

export interface CategoryRuleDefinition extends BaseRuleDefinition {
  type: 'category';
  allowList?: string[];
  ignoreList?: string[];
  fromPath?: boolean;
  matchNested?: boolean;
  caseInsensitive?: boolean;
}

export interface FrontmatterRuleDefinition extends BaseRuleDefinition {
  type: 'frontmatter';
}

export interface FrontmatterFieldRuleDefinition extends BaseRuleDefinition {
  type: 'frontmatterField';
  conditions: Array<{
    field: string;
    op:
      | 'exists'
      | 'notExists'
      | 'truthy'
      | 'equals'
      | 'notEquals'
      | 'in'
      | 'notIn'
      | 'contains'
      | 'matches'
      | 'gt'
      | 'gte'
      | 'lt'
      | 'lte';
    value?: unknown;
    caseInsensitive?: boolean;
  }>;
  mode?: 'all' | 'any';
}

export interface PrivacyRuleDefinition extends BaseRuleDefinition {
  type: 'privacy';
  allowPrivate?: boolean;
}

export interface ContentRuleDefinition extends BaseRuleDefinition {
  type: 'content';
  includePatterns?: string[];
  excludePatterns?: string[];
  mode?: 'any' | 'all';
  caseInsensitive?: boolean;
  regex?: boolean;
  maxBytes?: number;
}

export interface FileMetaRuleDefinition extends BaseRuleDefinition {
  type: 'fileMeta';
  minSize?: number;
  maxSize?: number;
  modifiedWithin?: string;
  modifiedBefore?: string;
  extensions?: string[];
  vaultPath?: string;
}

export type RuleDefinition =
  | PathRuleDefinition
  | TagRuleDefinition
  | CategoryRuleDefinition
  | FrontmatterRuleDefinition
  | FrontmatterFieldRuleDefinition
  | PrivacyRuleDefinition
  | ContentRuleDefinition
  | FileMetaRuleDefinition;

/**
 * A definition is either a concrete rule (discriminated by `type`) or a named
 * group, so common combinations can be defined once and referenced by name.
 */
export type DefinitionValue = RuleDefinition | RuleNode;

export interface RulesSectionV2 {
  definitions?: Record<string, DefinitionValue>;
  match?: RuleNode;
}

export interface RulesDocumentV2 {
  rulesVersion: 2;
  rules?: RulesSectionV2;
}

export interface RulesSectionV1 {
  composition?: 'AND' | 'OR';
  pathRule?: { include?: string[]; exclude?: string[]; negate?: boolean };
  tagRule?: {
    allowList?: string[];
    ignoreList?: string[];
    requireAny?: boolean;
    negate?: boolean;
  };
  frontmatterRule?: boolean;
  privacyRule?: { allowPrivate?: boolean; negate?: boolean };
  categoryRule?: {
    allowList?: string[];
    ignoreList?: string[];
    negate?: boolean;
  };
}

export interface RulesDocumentV1 {
  rulesVersion?: undefined;
  rules?: RulesSectionV1;
}

export type RulesDocument = RulesDocumentV1 | RulesDocumentV2;

export const SUPPORTED_RULES_VERSIONS = [1, 2] as const;

/** True when a definition value is a concrete rule rather than a group. */
export function isRuleDefinition(value: DefinitionValue): value is RuleDefinition {
  return typeof value === 'object' && value !== null && 'type' in value;
}
