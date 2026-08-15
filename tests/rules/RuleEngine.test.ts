import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RuleEngine } from '../../src/rules/RuleEngine.js';
import type { Rule } from '../../src/rules/types.js';

// Mock rule for testing
class MockRule implements Rule {
  name: string;
  shouldPass: boolean;
  reason: string;

  constructor(name: string, shouldPass: boolean, reason: string) {
    this.name = name;
    this.shouldPass = shouldPass;
    this.reason = reason;
  }

  evaluate(): { passed: boolean; reason: string } {
    return {
      passed: this.shouldPass,
      reason: this.reason,
    };
  }
}

describe('RuleEngine', () => {
  let engine: RuleEngine;

  beforeEach(() => {
    engine = new RuleEngine();
  });

  describe('rule management', () => {
    it('should add a rule', () => {
      const rule = new MockRule('test', true, 'test reason');
      engine.addRule('test', rule);
      expect(engine.getRuleCount()).toBe(1);
    });

    it('should remove a rule', () => {
      const rule = new MockRule('test', true, 'test reason');
      engine.addRule('test', rule);
      engine.removeRule('test');
      expect(engine.getRuleCount()).toBe(0);
    });

    it('should clear all rules', () => {
      engine.addRule('rule1', new MockRule('rule1', true, 'reason1'));
      engine.addRule('rule2', new MockRule('rule2', true, 'reason2'));
      engine.clearRules();
      expect(engine.getRuleCount()).toBe(0);
    });

    it('should get rule names', () => {
      engine.addRule('rule1', new MockRule('rule1', true, 'reason1'));
      engine.addRule('rule2', new MockRule('rule2', true, 'reason2'));
      expect(engine.getRuleNames()).toContain('rule1');
      expect(engine.getRuleNames()).toContain('rule2');
    });
  });

  describe('AND composition', () => {
    beforeEach(() => {
      engine.setComposition('AND');
    });

    it('should pass when all rules pass', () => {
      engine.addRule('rule1', new MockRule('rule1', true, 'passed 1'));
      engine.addRule('rule2', new MockRule('rule2', true, 'passed 2'));

      const result = engine.evaluate('test.md', {}, '');

      expect(result.eligible).toBe(true);
      expect(result.reason).toContain('All rules passed');
    });

    it('should fail when any rule fails', () => {
      engine.addRule('rule1', new MockRule('rule1', true, 'passed 1'));
      engine.addRule('rule2', new MockRule('rule2', false, 'failed 2'));

      const result = engine.evaluate('test.md', {}, '');

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('Failed rules');
    });

    it('should fail when all rules fail', () => {
      engine.addRule('rule1', new MockRule('rule1', false, 'failed 1'));
      engine.addRule('rule2', new MockRule('rule2', false, 'failed 2'));

      const result = engine.evaluate('test.md', {}, '');

      expect(result.eligible).toBe(false);
      expect(result.appliedRules).toHaveLength(2);
    });

    it('should return all applied rules in result', () => {
      engine.addRule('rule1', new MockRule('rule1', true, 'passed 1'));
      engine.addRule('rule2', new MockRule('rule2', false, 'failed 2'));

      const result = engine.evaluate('test.md', {}, '');

      expect(result.appliedRules).toHaveLength(2);
      expect(result.appliedRules[0].name).toBe('rule1');
      expect(result.appliedRules[1].name).toBe('rule2');
    });
  });

  describe('OR composition', () => {
    beforeEach(() => {
      engine.setComposition('OR');
    });

    it('should pass when any rule passes', () => {
      engine.addRule('rule1', new MockRule('rule1', false, 'failed 1'));
      engine.addRule('rule2', new MockRule('rule2', true, 'passed 2'));

      const result = engine.evaluate('test.md', {}, '');

      expect(result.eligible).toBe(true);
      expect(result.reason).toContain('Rules passed (OR)');
    });

    it('should fail when all rules fail', () => {
      engine.addRule('rule1', new MockRule('rule1', false, 'failed 1'));
      engine.addRule('rule2', new MockRule('rule2', false, 'failed 2'));

      const result = engine.evaluate('test.md', {}, '');

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('All rules failed (OR)');
    });

    it('should pass when all rules pass', () => {
      engine.addRule('rule1', new MockRule('rule1', true, 'passed 1'));
      engine.addRule('rule2', new MockRule('rule2', true, 'passed 2'));

      const result = engine.evaluate('test.md', {}, '');

      expect(result.eligible).toBe(true);
    });
  });

  describe('configuration', () => {
    it('should handle no rules gracefully', () => {
      const result = engine.evaluate('test.md', {}, '');
      expect(result.eligible).toBe(true);
      expect(result.reason).toContain('No rules configured');
    });

    it('should set composition via constructor', () => {
      const orEngine = new RuleEngine({ composition: 'OR' });
      expect(orEngine.getComposition()).toBe('OR');
    });

    it('should initialize with rules from config', () => {
      const rule1 = new MockRule('rule1', true, 'reason1');
      const rule2 = new MockRule('rule2', true, 'reason2');
      const engine = new RuleEngine({
        rules: [
          { name: 'rule1', rule: rule1 },
          { name: 'rule2', rule: rule2 },
        ],
        composition: 'AND',
      });

      expect(engine.getRuleCount()).toBe(2);
      expect(engine.getComposition()).toBe('AND');
    });

    it('should allow changing composition', () => {
      engine.setComposition('OR');
      expect(engine.getComposition()).toBe('OR');
      engine.setComposition('AND');
      expect(engine.getComposition()).toBe('AND');
    });
  });
});
