import * as fs from 'fs';
import { Logger } from '../utils/Logger.js';
import { RuleEngine } from './RuleEngine.js';
import { PathRule } from './implementations/PathRule.js';
import { TagRule } from './implementations/TagRule.js';
import { FrontmatterRule } from './implementations/FrontmatterRule.js';
import { PrivacyRule } from './implementations/PrivacyRule.js';
import { CategoryRule } from './implementations/CategoryRule.js';

export interface RulesFileConfig {
  rules?: {
    composition?: 'AND' | 'OR';
    pathRule?: { include?: string[]; exclude?: string[] };
    tagRule?: { whitelist?: string[]; blacklist?: string[]; requireAny?: boolean };
    frontmatterRule?: boolean;
    privacyRule?: { allowPrivate?: boolean };
    categoryRule?: { whitelist?: string[]; blacklist?: string[] };
  };
}

/**
 * Loads rules from a JSON config file and populates a RuleEngine.
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
    let parsed: RulesFileConfig;

    try {
      parsed = JSON.parse(content) as RulesFileConfig;
    } catch (error) {
      throw new Error(
        `Failed to parse rules config: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return this.loadFromObject(parsed, vaultPath);
  }

  /**
   * Load rules from a parsed config object and return a configured RuleEngine.
   * @param config The rules configuration object
   * @param vaultPath Optional vault path for PathRule normalization
   */
  loadFromObject(config: RulesFileConfig, vaultPath?: string): RuleEngine {
    const rulesConfig = config.rules;

    if (!rulesConfig) {
      this.logger.warn('No rules section in config, using empty rule set');
      return new RuleEngine({ composition: 'AND' });
    }

    // Validate composition
    const composition = rulesConfig.composition ?? 'AND';
    if (composition !== 'AND' && composition !== 'OR') {
      throw new Error(
        `Invalid rules composition "${composition}": must be "AND" or "OR"`
      );
    }

    const engine = new RuleEngine({ composition });

    if (rulesConfig.pathRule) {
      if (typeof rulesConfig.pathRule !== 'object') {
        throw new Error('pathRule must be an object with include/exclude arrays');
      }
      engine.addRule(
        'PathRule',
        new PathRule({
          ...rulesConfig.pathRule,
          vaultPath,
        })
      );
      this.logger.info('Loaded PathRule', rulesConfig.pathRule);
    }

    if (rulesConfig.tagRule) {
      if (typeof rulesConfig.tagRule !== 'object') {
        throw new Error('tagRule must be an object with whitelist/blacklist arrays');
      }
      engine.addRule('TagRule', new TagRule(rulesConfig.tagRule));
      this.logger.info('Loaded TagRule', rulesConfig.tagRule);
    }

    if (rulesConfig.frontmatterRule) {
      if (rulesConfig.frontmatterRule !== true) {
        throw new Error('frontmatterRule must be true to enable it');
      }
      engine.addRule('FrontmatterRule', new FrontmatterRule());
      this.logger.info('Loaded FrontmatterRule');
    }

    if (rulesConfig.privacyRule) {
      if (typeof rulesConfig.privacyRule !== 'object') {
        throw new Error('privacyRule must be an object');
      }
      engine.addRule('PrivacyRule', new PrivacyRule(rulesConfig.privacyRule));
      this.logger.info('Loaded PrivacyRule', rulesConfig.privacyRule);
    }

    if (rulesConfig.categoryRule) {
      if (typeof rulesConfig.categoryRule !== 'object') {
        throw new Error('categoryRule must be an object with whitelist/blacklist arrays');
      }
      engine.addRule('CategoryRule', new CategoryRule(rulesConfig.categoryRule));
      this.logger.info('Loaded CategoryRule', rulesConfig.categoryRule);
    }

    this.logger.info(`Loaded ${engine.getRuleCount()} rule(s) with ${composition} composition`);
    return engine;
  }
}
