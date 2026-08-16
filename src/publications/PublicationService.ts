import { EventEmitter } from '../utils/EventEmitter.js';
import { Logger } from '../utils/Logger.js';
import { FrontmatterParser } from '../parser/FrontmatterParser.js';
import { InlineTagParser } from '../parser/InlineTagParser.js';
import { RuleEngine } from '../rules/RuleEngine.js';
import { RuleLoader } from '../rules/RuleLoader.js';
import { ConfigManager } from '../config/ConfigManager.js';
import type { Rule } from '../rules/types.js';
import type { Frontmatter } from '../parser/types.js';
import type {
  PublicationServiceConfig,
  EligibilityResult,
  PublicationRuleConfig,
  CacheEntry,
  RuleResult,
} from './types.js';

export class PublicationService extends EventEmitter<EligibilityResult> {
  private logger: Logger;
  private frontmatterParser: FrontmatterParser;
  private inlineTagParser: InlineTagParser;
  private ruleEngine: RuleEngine;
  private configManager: ConfigManager;
  private cache: Map<string, CacheEntry> = new Map();
  private enableCache: boolean;
  private cacheSize: number;
  private ruleConfig: PublicationRuleConfig = {};

  constructor(config?: PublicationServiceConfig) {
    super();
    this.logger = new Logger(config?.logLevel ?? 'info', 'PublicationService');
    this.frontmatterParser = new FrontmatterParser();
    this.inlineTagParser = new InlineTagParser();
    this.configManager = new ConfigManager();
    this.ruleEngine = new RuleEngine({
      composition: config?.composition ?? 'AND',
    });

    this.enableCache = config?.enableCache ?? true;
    this.cacheSize = config?.cacheSize ?? 100;

    this.logger.debug('PublicationService initialized');
  }

  /**
   * Evaluate a file for publication eligibility.
   * Parses file content to extract frontmatter and inline tags,
   * then orchestrates rule evaluation.
   */
  async evaluateFile(
    filepath: string,
    content: string
  ): Promise<EligibilityResult> {
    // Check cache first
    if (this.enableCache) {
      const cached = this.getCachedResult(filepath);
      if (cached) {
        this.logger.debug(`Using cached result for ${filepath}`);
        return cached;
      }
    }

    // Parse frontmatter from content
    const parseResult = this.frontmatterParser.parse(content);
    const frontmatter = parseResult.frontmatter;

    // Evaluate with extracted frontmatter
    return this.evaluateFileWithFrontmatter(
      filepath,
      frontmatter,
      parseResult.content
    );
  }

  /**
   * Evaluate a file with pre-extracted frontmatter.
   * Useful for testing or when frontmatter is already available.
   */
  async evaluateFileWithFrontmatter(
    filepath: string,
    frontmatter: Frontmatter,
    content?: string
  ): Promise<EligibilityResult> {
    // Check cache first
    if (this.enableCache) {
      const cached = this.getCachedResult(filepath);
      if (cached) {
        this.logger.debug(`Using cached result for ${filepath}`);
        return cached;
      }
    }

    const contentToEval = content ?? '';

    // Extract tags from frontmatter
    const frontmatterTags = this.frontmatterParser.getTags(frontmatter);

    // Extract inline tags from content
    const inlineTags = this.inlineTagParser.extractTags(contentToEval);

    // Combine all tags
    const allTags = Array.from(new Set([...frontmatterTags, ...inlineTags]));

    // Add combined tags to frontmatter for rule evaluation
    const evaluationFrontmatter = {
      ...frontmatter,
      tags: allTags,
    };

    // Evaluate using rule engine
    const engineResult = this.ruleEngine.evaluate(
      filepath,
      evaluationFrontmatter,
      contentToEval
    );

    // Build eligibility result
    const result: EligibilityResult = {
      eligible: engineResult.eligible,
      reason: engineResult.reason,
      rules: engineResult.appliedRules as RuleResult[],
      evaluatedAt: Date.now(),
    };

    // Cache the result
    if (this.enableCache) {
      this.cacheResult(filepath, result);
    }

    // Emit event
    await this.emit('evaluated', result);

    this.logger.debug(
      `File ${filepath} evaluated: eligible=${result.eligible}`
    );

    return result;
  }

  /**
   * Reload publication rules from configuration file.
   */
  async reloadRules(configPath?: string): Promise<void> {
    this.logger.info('Reloading publication rules');

    try {
      let rulesPath = configPath;

      if (!rulesPath) {
        const appConfig = await this.configManager.load();
        rulesPath = appConfig.rulesConfig;
      }

      if (!rulesPath) {
        this.logger.warn('No rules config path specified');
        return;
      }

      const loader = new RuleLoader(this.logger.getLevel());
      this.ruleEngine = loader.loadFromFile(rulesPath);
      this.clearCache();

      this.logger.info('Rules reloaded successfully');
    } catch (error) {
      this.logger.error(`Failed to reload rules: ${error}`);
      throw error;
    }
  }

  /**
   * Get the current rule configuration.
   */
  getRuleConfig(): PublicationRuleConfig {
    return {
      composition: this.ruleEngine.getComposition(),
      rules: this.ruleEngine.getRuleNames().reduce(
        (acc, name) => {
          acc[name] = true;
          return acc;
        },
        {} as Record<string, boolean>
      ),
    };
  }

  /**
   * Add a rule to the engine for evaluation.
   */
  addRule(name: string, rule: Rule): void {
    this.ruleEngine.addRule(name, rule);
    this.logger.debug(`Rule added: ${name}`);
  }

  /**
   * Remove a rule from the engine.
   */
  removeRule(name: string): boolean {
    const result = this.ruleEngine.removeRule(name);
    if (result) {
      this.logger.debug(`Rule removed: ${name}`);
    }
    return result;
  }

  /**
   * Get the number of configured rules.
   */
  getRuleCount(): number {
    return this.ruleEngine.getRuleCount();
  }

  /**
   * Clear the result cache.
   */
  clearCache(filepath?: string): void {
    if (filepath) {
      this.cache.delete(filepath);
      this.logger.debug(`Cache cleared for ${filepath}`);
    } else {
      this.cache.clear();
      this.logger.debug('Entire cache cleared');
    }
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): { size: number; capacity: number } {
    return {
      size: this.cache.size,
      capacity: this.cacheSize,
    };
  }

  /**
   * Enable or disable caching.
   */
  setCache(enabled: boolean): void {
    this.enableCache = enabled;
    if (!enabled) {
      this.cache.clear();
    }
    this.logger.debug(`Cache ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get cached result for a file.
   */
  private getCachedResult(filepath: string): EligibilityResult | undefined {
    const entry = this.cache.get(filepath);
    if (entry) {
      return entry.result;
    }
    return undefined;
  }

  /**
   * Cache an evaluation result.
   */
  private cacheResult(filepath: string, result: EligibilityResult): void {
    // Implement LRU cache eviction if necessary
    if (this.cache.size >= this.cacheSize) {
      // Remove oldest entry
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(filepath, {
      result,
      timestamp: Date.now(),
    });
  }
}
