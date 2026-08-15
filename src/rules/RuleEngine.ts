import type { Rule, EngineResult, RuleEngineConfig } from './types.js';

export class RuleEngine {
  private rules: Map<string, Rule>;
  private composition: 'AND' | 'OR';

  constructor(config?: Partial<RuleEngineConfig>) {
    this.rules = new Map();
    this.composition = config?.composition ?? 'AND';

    if (config?.rules) {
      for (const { name, rule } of config.rules) {
        this.rules.set(name, rule);
      }
    }
  }

  /**
   * Add a rule to the engine.
   */
  addRule(name: string, rule: Rule): void {
    this.rules.set(name, rule);
  }

  /**
   * Remove a rule from the engine.
   */
  removeRule(name: string): boolean {
    return this.rules.delete(name);
  }

  /**
   * Clear all rules.
   */
  clearRules(): void {
    this.rules.clear();
  }

  /**
   * Set composition mode: AND (all must pass) or OR (any can pass).
   */
  setComposition(composition: 'AND' | 'OR'): void {
    this.composition = composition;
  }

  /**
   * Get composition mode.
   */
  getComposition(): 'AND' | 'OR' {
    return this.composition;
  }

  /**
   * Evaluate all rules against a file.
   * Composition determines final decision:
   * - AND: All rules must pass
   * - OR: At least one rule must pass
   */
  evaluate(
    filepath: string,
    frontmatter: Record<string, unknown>,
    content: string
  ): EngineResult {
    const appliedRules: { name: string; passed: boolean; reason: string }[] =
      [];

    if (this.rules.size === 0) {
      return {
        eligible: true,
        reason: 'No rules configured',
        appliedRules: [],
      };
    }

    // Evaluate all rules
    for (const [name, rule] of this.rules) {
      const result = rule.evaluate(filepath, frontmatter, content);
      appliedRules.push({
        name,
        passed: result.passed,
        reason: result.reason,
      });
    }

    // Determine final result based on composition
    let eligible = false;
    let reason = '';

    if (this.composition === 'AND') {
      eligible = appliedRules.every((r) => r.passed);
      if (!eligible) {
        const failedRules = appliedRules.filter((r) => !r.passed);
        reason = `Failed rules (AND): ${failedRules.map((r) => `${r.name}: ${r.reason}`).join('; ')}`;
      } else {
        reason = 'All rules passed (AND)';
      }
    } else {
      // OR composition
      eligible = appliedRules.some((r) => r.passed);
      if (!eligible) {
        reason = `All rules failed (OR): ${appliedRules.map((r) => `${r.name}: ${r.reason}`).join('; ')}`;
      } else {
        const passedRules = appliedRules.filter((r) => r.passed);
        reason = `Rules passed (OR): ${passedRules.map((r) => r.name).join(', ')}`;
      }
    }

    return {
      eligible,
      reason,
      appliedRules,
    };
  }

  /**
   * Get the number of configured rules.
   */
  getRuleCount(): number {
    return this.rules.size;
  }

  /**
   * Get all rule names.
   */
  getRuleNames(): string[] {
    return Array.from(this.rules.keys());
  }
}
