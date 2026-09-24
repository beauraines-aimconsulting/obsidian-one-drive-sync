import { createHash } from 'crypto';
import { EventEmitter } from '../utils/EventEmitter.js';
import { Logger } from '../utils/Logger.js';
import { FrontmatterParser } from '../parser/FrontmatterParser.js';
import { InlineTagParser } from '../parser/InlineTagParser.js';
import { attachTagSources } from '../rules/tagSources.js';
import { RuleEngine } from '../rules/RuleEngine.js';
import { RuleLoader } from '../rules/RuleLoader.js';
import { ConfigManager } from '../config/ConfigManager.js';
import type { Rule } from '../rules/types.js';
import type { Frontmatter, FrontmatterParseError } from '../parser/types.js';
import type {
  PublicationServiceConfig,
  EligibilityResult,
  PublicationRuleConfig,
  CacheEntry,
} from './types.js';

function hashInput(...parts: string[]): string {
  const hash = createHash('sha1');
  for (const part of parts) {
    hash.update(part);
    hash.update('\u0000');
  }
  return hash.digest('hex');
}

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
  private vaultPath?: string;

  constructor(config?: PublicationServiceConfig) {
    super();
    this.logger = new Logger(config?.logLevel ?? 'info', 'PublicationService');
    this.frontmatterParser = new FrontmatterParser(config?.logLevel ?? 'info');
    this.inlineTagParser = new InlineTagParser();
    this.configManager = new ConfigManager();
    this.ruleEngine = new RuleEngine({
      composition: config?.composition ?? 'AND',
    });

    this.enableCache = config?.enableCache ?? true;
    this.cacheSize = config?.cacheSize ?? 100;
    this.vaultPath = config?.vaultPath;

    this.logger.debug('PublicationService initialized');
  }

  /**
   * Evaluate a file for publication eligibility.
   * Parses file content to extract frontmatter and inline tags,
   * then orchestrates rule evaluation.
   */
  async evaluateFile(filepath: string, content: string): Promise<EligibilityResult> {
    return this.evaluateFileWithEngine(filepath, content, this.ruleEngine, {
      useCache: this.enableCache,
      emitEvent: true,
    });
  }

  /**
   * Evaluate a file against an explicit engine without mutating live state.
   */
  async evaluateFileWithRuleEngine(
    filepath: string,
    content: string,
    ruleEngine: RuleEngine
  ): Promise<EligibilityResult> {
    return this.evaluateFileWithEngine(filepath, content, ruleEngine, {
      useCache: false,
      emitEvent: false,
    });
  }

  /**
   * Evaluate a file with pre-extracted frontmatter.
   * Useful for testing or when frontmatter is already available.
   */
  async evaluateFileWithFrontmatter(
    filepath: string,
    frontmatter: Frontmatter,
    content?: string,
    precomputedHash?: string,
    parseError?: FrontmatterParseError
  ): Promise<EligibilityResult> {
    return this.evaluateFrontmatterWithEngine(filepath, frontmatter, this.ruleEngine, {
      content,
      contentHash: precomputedHash,
      parseError,
      useCache: this.enableCache,
      emitEvent: true,
    });
  }

  private async evaluateFileWithEngine(
    filepath: string,
    content: string,
    ruleEngine: RuleEngine,
    options: { useCache: boolean; emitEvent: boolean }
  ): Promise<EligibilityResult> {
    const contentHash = hashInput(content);

    if (options.useCache) {
      const cached = this.getCachedResult(filepath, contentHash);
      if (cached) {
        this.logger.debug(`Using cached result for ${filepath}`);
        return cached;
      }
    }

    const parseResult = this.frontmatterParser.parse(content, filepath);
    return this.evaluateFrontmatterWithEngine(filepath, parseResult.frontmatter, ruleEngine, {
      content: parseResult.content,
      contentHash,
      parseError: parseResult.error,
      useCache: options.useCache,
      emitEvent: options.emitEvent,
    });
  }

  private async evaluateFrontmatterWithEngine(
    filepath: string,
    frontmatter: Frontmatter,
    ruleEngine: RuleEngine,
    options: {
      content?: string;
      contentHash?: string;
      parseError?: FrontmatterParseError;
      useCache: boolean;
      emitEvent: boolean;
    }
  ): Promise<EligibilityResult> {
    const contentHash =
      options.contentHash ?? hashInput(JSON.stringify(frontmatter ?? {}), options.content ?? '');

    if (options.useCache) {
      const cached = this.getCachedResult(filepath, contentHash);
      if (cached) {
        this.logger.debug(`Using cached result for ${filepath}`);
        return cached;
      }
    }

    const contentToEval = options.content ?? '';

    if (options.parseError) {
      const location = [
        options.parseError.line !== undefined ? `line ${options.parseError.line}` : null,
        options.parseError.column !== undefined ? `column ${options.parseError.column}` : null,
      ]
        .filter(Boolean)
        .join(', ');

      const result: EligibilityResult = {
        eligible: false,
        reason: location
          ? `Frontmatter parse error at ${location}: ${options.parseError.reason}`
          : `Frontmatter parse error: ${options.parseError.reason}`,
        rules: [],
        evaluatedAt: Date.now(),
        parseError: options.parseError,
      };

      if (options.useCache) {
        this.cacheResult(filepath, result, contentHash);
      }

      if (options.emitEvent) {
        await this.emit('evaluated', result);
      }
      this.logger.debug(`Skipping ${filepath}: ${result.reason}`);

      return result;
    }

    const frontmatterTags = this.frontmatterParser.getTags(frontmatter);
    const sourcedTags = this.inlineTagParser.extractTagsWithSource(contentToEval);
    const inlineTags = sourcedTags.filter((t) => t.source === 'inline').map((t) => t.tag);
    const taskTags = sourcedTags.filter((t) => t.source === 'task').map((t) => t.tag);
    const allTags = Array.from(new Set([...frontmatterTags, ...inlineTags, ...taskTags]));

    const tagSources = { frontmatter: frontmatterTags, inline: inlineTags, task: taskTags };
    const evaluationFrontmatter = attachTagSources({ ...frontmatter, tags: allTags }, tagSources);
    const engineResult = ruleEngine.evaluate(filepath, evaluationFrontmatter, contentToEval);

    const result: EligibilityResult = {
      eligible: engineResult.eligible,
      reason: engineResult.reason,
      rules: engineResult.appliedRules,
      evaluatedAt: Date.now(),
      tagSources,
    };

    if (options.useCache) {
      this.cacheResult(filepath, result, contentHash);
    }

    if (options.emitEvent) {
      await this.emit('evaluated', result);
    }

    this.logger.debug(`File ${filepath} evaluated: eligible=${result.eligible}`);

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
      this.ruleEngine = loader.loadFromFile(rulesPath, this.vaultPath);
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
  private getCachedResult(filepath: string, contentHash: string): EligibilityResult | undefined {
    const entry = this.cache.get(filepath);
    if (entry && entry.contentHash === contentHash) {
      return entry.result;
    }
    if (entry) {
      // Content changed since the last evaluation — drop the stale entry
      this.cache.delete(filepath);
    }
    return undefined;
  }

  /**
   * Cache an evaluation result.
   */
  private cacheResult(filepath: string, result: EligibilityResult, contentHash: string): void {
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
      contentHash,
    });
  }
}
