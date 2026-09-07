import * as fs from 'fs';
import { Logger } from '../utils/Logger.js';
import { RuleEngine } from './RuleEngine.js';
import { PathRule } from './implementations/PathRule.js';
import { TagRule } from './implementations/TagRule.js';
import { FrontmatterRule } from './implementations/FrontmatterRule.js';
import { PrivacyRule } from './implementations/PrivacyRule.js';
import { CategoryRule } from './implementations/CategoryRule.js';
import { CompositeRule } from './implementations/CompositeRule.js';
import { NegatedRule } from './implementations/NegatedRule.js';
import { formatConfigErrors, validateRulesConfig } from './validateRulesConfig.js';
import {
  isRuleDefinition,
  type DefinitionValue,
  type RuleDefinition,
  type RuleNode,
  type RulesDocumentV2,
} from './configTypes.js';
import type { Rule } from './Rule.js';

export type {
  RulesDocument,
  RulesDocumentV1,
  RulesDocumentV2,
  RulesSectionV1,
  RulesSectionV2,
} from './configTypes.js';

/** Loose shape for callers that hand-build a rules document. */
export interface RulesFileConfig {
  rulesVersion?: number;
  rules?: Record<string, unknown>;
}

/**
 * Loads rules from a JSON config file and populates a RuleEngine.
 *
 * Both document versions are accepted: v1 documents are migrated in memory, so
 * everything below only ever deals with the v2 shape.
 */
export class RuleLoader {
  private logger: Logger;

  constructor(logLevel: 'debug' | 'info' | 'warn' | 'error' = 'info') {
    this.logger = new Logger(logLevel, 'RuleLoader');
  }

  /**
   * Load rules from a JSON config file path and return a configured RuleEngine.
   * @param configPath Path to the rules config file
   * @param vaultPath Optional vault path for PathRule normalization
   */
  loadFromFile(configPath: string, vaultPath?: string): RuleEngine {
    if (!fs.existsSync(configPath)) {
      throw new Error(`Rules config file not found: ${configPath}`);
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    let parsed: unknown;

    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(
        `Failed to parse rules config: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return this.loadFromObject(parsed, vaultPath);
  }

  /**
   * Load rules from a parsed config object and return a configured RuleEngine.
   * @param config The rules configuration object, in either v1 or v2 form
   * @param vaultPath Optional vault path for PathRule normalization
   */
  loadFromObject(config: unknown, vaultPath?: string): RuleEngine {
    const outcome = validateRulesConfig(config);

    if (!outcome.valid) {
      throw new Error(`Invalid rules configuration:\n${formatConfigErrors(outcome.errors)}`);
    }

    for (const warning of outcome.warnings) {
      this.logger.warn(warning);
    }

    if (outcome.version === 1 && outcome.config.rules?.match) {
      this.logger.info(
        'Loaded a v1 rules config (migrated in memory). Run --migrate-rules to save it as rulesVersion 2.'
      );
    }

    return this.buildEngine(outcome.config, vaultPath);
  }

  private buildEngine(document: RulesDocumentV2, vaultPath?: string): RuleEngine {
    const definitions = document.rules?.definitions ?? {};
    const match = document.rules?.match;

    if (!match) {
      this.logger.warn('No rules section in config, using empty rule set');
      return new RuleEngine({ composition: 'AND' });
    }

    const built = new Map<string, Rule>();
    const resolve = (name: string): Rule => {
      const existing = built.get(name);
      if (existing) return existing;

      const definition = definitions[name];
      if (!definition) {
        // Unreachable through a validated document; guards direct API misuse.
        throw new Error(`Unknown rule "${name}"`);
      }

      const rule = this.buildDefinition(name, definition, vaultPath, resolve);
      built.set(name, rule);
      return rule;
    };

    // A flat top-level group of plain references is exactly what v1 expressed,
    // so map it onto the engine's own composition. Migrated configs then keep
    // identical rule names and reason strings, and only genuinely nested trees
    // pay for the extra composite layer.
    const flat = asFlatGroup(match);
    if (flat) {
      const engine = new RuleEngine({ composition: flat.composition });
      for (const name of flat.names) {
        engine.addRule(name, resolve(name));
      }
      this.logger.info(
        `Loaded ${engine.getRuleCount()} rule(s) with ${flat.composition} composition`
      );
      return engine;
    }

    const engine = new RuleEngine({ composition: 'AND' });
    engine.addRule('match', new CompositeRule('match', match, resolve));
    this.logger.info(
      `Loaded ${Object.keys(definitions).length} rule definition(s) with a nested match tree`
    );
    return engine;
  }

  private buildDefinition(
    name: string,
    definition: DefinitionValue,
    vaultPath: string | undefined,
    resolve: (name: string) => Rule
  ): Rule {
    if (!isRuleDefinition(definition)) {
      return new CompositeRule(name, definition, resolve);
    }

    const rule = this.instantiate(definition, vaultPath);
    this.logger.debug(`Loaded ${definition.type} rule "${name}"`);
    return definition.negate ? new NegatedRule(rule) : rule;
  }

  private instantiate(definition: RuleDefinition, vaultPath?: string): Rule {
    switch (definition.type) {
      case 'path':
        return new PathRule({
          include: definition.include,
          exclude: definition.exclude,
          vaultPath,
        });
      case 'tag':
        return new TagRule({
          whitelist: definition.whitelist,
          blacklist: definition.blacklist,
          requireAny: definition.requireAny,
        });
      case 'category':
        return new CategoryRule({
          whitelist: definition.whitelist,
          blacklist: definition.blacklist,
        });
      case 'frontmatter':
        return new FrontmatterRule();
      case 'privacy':
        return new PrivacyRule({ allowPrivate: definition.allowPrivate });
    }
  }
}

/**
 * Recognise a top-level group that is nothing but a list of distinct rule
 * references, which the engine can represent directly with AND/OR composition.
 */
function asFlatGroup(node: RuleNode): { composition: 'AND' | 'OR'; names: string[] } | null {
  const isAll = 'all' in node;
  if (!isAll && !('any' in node)) return null;

  const children = isAll ? node.all : node.any;
  if (!children.every((child) => 'rule' in child)) return null;

  const names = children.map((child) => (child as { rule: string }).rule);
  if (new Set(names).size !== names.length) return null;

  return { composition: isAll ? 'AND' : 'OR', names };
}
