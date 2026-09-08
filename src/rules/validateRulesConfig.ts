/**
 * Rules configuration validation.
 *
 * Deliberately standalone and free of side effects: `RuleLoader` uses it to
 * fail fast at startup, and the web UI (#26) reuses the same function to turn a
 * rejected document into field-level errors. There must only ever be one
 * schema for rules configuration.
 */

import { z } from 'zod';
import { isValidGlob } from '../utils/glob.js';
import {
  isRuleDefinition,
  type DefinitionValue,
  type RuleNode,
  type RulesDocument,
  type RulesDocumentV2,
} from './configTypes.js';
import { migrateRulesDocument } from './migrateRulesConfig.js';

export interface ConfigError {
  /** Dotted pointer to the offending value, e.g. `rules.definitions.work.include[2]`. */
  path: string;
  message: string;
}

export type ValidationOutcome =
  | {
      valid: true;
      /** The version the document was authored in. */
      version: 1 | 2;
      /** The document as v2, migrated in memory when the input was v1. */
      config: RulesDocumentV2;
      /** Non-fatal observations, e.g. definitions nothing references. */
      warnings: string[];
    }
  | { valid: false; errors: ConfigError[] };

const globPattern = z
  .string()
  .min(1, 'Pattern must not be empty')
  .refine(isValidGlob, 'Not a valid glob pattern');

const globList = z.array(globPattern);
const tagList = z.array(z.string().min(1, 'Tag must not be empty'));

const pathRuleSchema = z
  .object({
    type: z.literal('path'),
    include: globList.optional(),
    exclude: globList.optional(),
    negate: z.boolean().optional(),
  })
  .strict();

const tagRuleSchema = z
  .object({
    type: z.literal('tag'),
    whitelist: tagList.optional(),
    blacklist: tagList.optional(),
    requireAny: z.boolean().optional(),
    negate: z.boolean().optional(),
  })
  .strict();

const categoryRuleSchema = z
  .object({
    type: z.literal('category'),
    whitelist: tagList.optional(),
    blacklist: tagList.optional(),
    negate: z.boolean().optional(),
  })
  .strict();

const frontmatterRuleSchema = z
  .object({
    type: z.literal('frontmatter'),
    negate: z.boolean().optional(),
  })
  .strict();

const privacyRuleSchema = z
  .object({
    type: z.literal('privacy'),
    allowPrivate: z.boolean().optional(),
    negate: z.boolean().optional(),
  })
  .strict();

/** Leaf rule types accepted in `rules.definitions`, for error messages. */
const RULE_TYPE_NAMES = ['path', 'tag', 'category', 'frontmatter', 'privacy'] as const;

const ruleDefinitionSchema = z.discriminatedUnion('type', [
  pathRuleSchema,
  tagRuleSchema,
  categoryRuleSchema,
  frontmatterRuleSchema,
  privacyRuleSchema,
]);

const ruleNodeSchema: z.ZodType<RuleNode> = z.lazy(() =>
  z.union([
    z
      .object({ all: z.array(ruleNodeSchema).min(1, 'Group must contain at least one node') })
      .strict(),
    z
      .object({ any: z.array(ruleNodeSchema).min(1, 'Group must contain at least one node') })
      .strict(),
    z.object({ not: ruleNodeSchema }).strict(),
    z.object({ rule: z.string().min(1, 'Rule reference must not be empty') }).strict(),
  ])
);

const definitionValueSchema: z.ZodType<DefinitionValue> = z.union([
  ruleDefinitionSchema,
  ruleNodeSchema,
]);

const rulesSectionV2Schema = z
  .object({
    definitions: z.record(z.string().min(1), definitionValueSchema).optional(),
    match: ruleNodeSchema.optional(),
  })
  .strict();

/**
 * The root allows unknown keys because the same file also carries the `config`
 * section owned by `ConfigManager`.
 */
const documentV2Schema = z.looseObject({
  rulesVersion: z.literal(2),
  rules: rulesSectionV2Schema.optional(),
});

const rulesSectionV1Schema = z
  .object({
    composition: z.enum(['AND', 'OR']).optional(),
    pathRule: z
      .object({
        include: globList.optional(),
        exclude: globList.optional(),
        negate: z.boolean().optional(),
      })
      .strict()
      .optional(),
    tagRule: z
      .object({
        whitelist: tagList.optional(),
        blacklist: tagList.optional(),
        requireAny: z.boolean().optional(),
        negate: z.boolean().optional(),
      })
      .strict()
      .optional(),
    frontmatterRule: z.literal(true).optional(),
    privacyRule: z
      .object({ allowPrivate: z.boolean().optional(), negate: z.boolean().optional() })
      .strict()
      .optional(),
    categoryRule: z
      .object({
        whitelist: tagList.optional(),
        blacklist: tagList.optional(),
        negate: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const documentV1Schema = z.looseObject({
  rules: rulesSectionV1Schema.optional(),
});

/** Render a zod path as a dotted pointer with bracketed array indices. */
function formatPath(segments: ReadonlyArray<PropertyKey>): string {
  return segments.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    return acc.length === 0 ? String(segment) : `${acc}.${String(segment)}`;
  }, '');
}

function toConfigErrors(error: z.ZodError): ConfigError[] {
  const errors: ConfigError[] = [];

  for (const issue of error.issues) {
    const basePath = formatPath(issue.path);

    if (issue.code === 'unrecognized_keys') {
      // Point at the offending key itself rather than its parent object.
      for (const key of issue.keys) {
        errors.push({
          path: basePath.length === 0 ? key : `${basePath}.${key}`,
          message: `Unknown option "${key}"`,
        });
      }
      continue;
    }

    if (issue.code === 'invalid_union' && !basePath.endsWith('type')) {
      // zod's nested union errors are unreadable for a recursive schema; a
      // single actionable message beats a dump of every failed branch.
      errors.push({
        path: basePath,
        message:
          'Expected a rule reference ({ "rule": "name" }) or a group ({ "all": [...] }, { "any": [...] }, { "not": {...} })',
      });
      continue;
    }

    errors.push({ path: basePath, message: issue.message });
  }

  // A single malformed leaf surfaces through several union branches, each with
  // its own wording. Reporting one message per location keeps the output
  // actionable instead of asking the reader to reconcile duplicates.
  const seen = new Set<string>();
  return errors.filter((error) => {
    if (seen.has(error.path)) return false;
    seen.add(error.path);
    return true;
  });
}

function collectReferences(node: RuleNode, into: string[]): void {
  if ('rule' in node) {
    into.push(node.rule);
    return;
  }
  if ('not' in node) {
    collectReferences(node.not, into);
    return;
  }
  const children = 'all' in node ? node.all : node.any;
  for (const child of children) collectReferences(child, into);
}

/**
 * Semantic checks the schema cannot express: references must resolve, groups
 * must not reference themselves in a loop, and definitions that nothing uses
 * are almost certainly a mistake worth mentioning.
 */
function validateSemantics(document: RulesDocumentV2): {
  errors: ConfigError[];
  warnings: string[];
} {
  const errors: ConfigError[] = [];
  const warnings: string[] = [];
  const definitions = document.rules?.definitions ?? {};
  const match = document.rules?.match;
  const definitionNames = new Set(Object.keys(definitions));

  if (!match) {
    if (definitionNames.size > 0) {
      errors.push({
        path: 'rules.match',
        message:
          'Required when rules.definitions is present, otherwise the defined rules are never evaluated',
      });
    }
    return { errors, warnings };
  }

  const referenced = new Set<string>();

  const checkNode = (node: RuleNode, path: string): void => {
    if ('rule' in node) {
      referenced.add(node.rule);
      if (!definitionNames.has(node.rule)) {
        errors.push({
          path: `${path}.rule`,
          message: `Unknown rule "${node.rule}". Defined rules: ${
            definitionNames.size > 0 ? [...definitionNames].join(', ') : '(none)'
          }`,
        });
      }
      return;
    }
    if ('not' in node) {
      checkNode(node.not, `${path}.not`);
      return;
    }
    const key = 'all' in node ? 'all' : 'any';
    const children = 'all' in node ? node.all : node.any;
    children.forEach((child, index) => checkNode(child, `${path}.${key}[${index}]`));
  };

  checkNode(match, 'rules.match');

  // Group definitions can reference other definitions, so a cycle is possible
  // and would otherwise recurse forever at evaluation time.
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (name: string, stack: string[]): void => {
    const current = state.get(name);
    if (current === 'done') return;
    if (current === 'visiting') {
      errors.push({
        path: `rules.definitions.${name}`,
        message: `Circular rule reference: ${[...stack, name].join(' -> ')}`,
      });
      return;
    }

    const definition = definitions[name];
    if (!definition) return;

    state.set(name, 'visiting');
    if (!isRuleDefinition(definition)) {
      const references: string[] = [];
      collectReferences(definition, references);
      for (const reference of references) {
        referenced.add(reference);
        if (!definitionNames.has(reference)) {
          errors.push({
            path: `rules.definitions.${name}`,
            message: `Unknown rule "${reference}"`,
          });
          continue;
        }
        visit(reference, [...stack, name]);
      }
    }
    state.set(name, 'done');
  };

  for (const name of definitionNames) visit(name, []);

  for (const name of definitionNames) {
    if (!referenced.has(name)) {
      warnings.push(`Rule "${name}" is defined but never referenced by rules.match`);
    }
  }

  return { errors, warnings };
}

/**
 * Validate a rules document of either version, returning it as v2.
 *
 * Never throws on malformed input — callers get every error at once, each with
 * a path they can point a user at.
 */
export function validateRulesConfig(input: unknown): ValidationOutcome {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return {
      valid: false,
      errors: [{ path: '', message: 'Rules configuration must be a JSON object' }],
    };
  }

  const version = (input as { rulesVersion?: unknown }).rulesVersion;

  if (version !== undefined && version !== 1 && version !== 2) {
    return {
      valid: false,
      errors: [
        {
          path: 'rulesVersion',
          message: `Unsupported rules version ${JSON.stringify(version)}. Supported versions: 1, 2`,
        },
      ],
    };
  }

  // `rulesVersion: 1` is accepted as an explicit spelling of the legacy shape.
  const isV2 = version === 2;

  // Checked ahead of the schema: a bad discriminator makes zod fail the whole
  // definition union, which reports the definition object rather than the
  // `type` field the author actually got wrong.
  if (isV2) {
    const typeErrors = checkDefinitionTypes(input);
    if (typeErrors.length > 0) {
      return { valid: false, errors: typeErrors };
    }
  }
  const parsed = isV2 ? documentV2Schema.safeParse(input) : documentV1Schema.safeParse(input);

  if (!parsed.success) {
    return { valid: false, errors: toConfigErrors(parsed.error) };
  }

  const migrated = isV2
    ? (parsed.data as RulesDocumentV2)
    : migrateRulesDocument(parsed.data as RulesDocument);

  const { errors, warnings } = validateSemantics(migrated);
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, version: isV2 ? 2 : 1, config: migrated, warnings };
}

/**
 * Report definitions whose `type` is present but not a known rule type.
 */
function checkDefinitionTypes(input: object): ConfigError[] {
  const rules = (input as { rules?: unknown }).rules;
  if (rules === null || typeof rules !== 'object') return [];

  const definitions = (rules as { definitions?: unknown }).definitions;
  if (definitions === null || typeof definitions !== 'object') return [];

  const errors: ConfigError[] = [];
  for (const [name, value] of Object.entries(definitions as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;

    const type = (value as { type?: unknown }).type;
    if (type === undefined) continue;

    if (
      typeof type !== 'string' ||
      !RULE_TYPE_NAMES.includes(type as (typeof RULE_TYPE_NAMES)[number])
    ) {
      errors.push({
        path: `rules.definitions.${name}.type`,
        message: `Unknown rule type ${JSON.stringify(type)}. Valid types: ${RULE_TYPE_NAMES.join(', ')}`,
      });
    }
  }

  return errors;
}

/** Format errors for a thrown message, one per line. */
export function formatConfigErrors(errors: ConfigError[]): string {
  return errors
    .map((error) =>
      error.path.length > 0 ? `  ${error.path}: ${error.message}` : `  ${error.message}`
    )
    .join('\n');
}
