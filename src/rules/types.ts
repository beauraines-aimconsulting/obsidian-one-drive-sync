/**
 * A single rule's contribution to a decision. `children` is populated by
 * composite (group) rules so a nested decision can be explained rather than
 * reported as one opaque pass/fail.
 */
export interface RuleTrace {
  name: string;
  passed: boolean;
  reason: string;
  children?: RuleTrace[];
}

export interface RuleEngineConfig {
  rules: { name: string; rule: Rule }[];
  composition?: 'AND' | 'OR';
}

export interface EngineResult {
  eligible: boolean;
  reason: string;
  appliedRules: RuleTrace[];
}

// Re-export from rule implementations
export abstract class Rule {
  abstract name: string;
  abstract evaluate(
    filepath: string,
    frontmatter: Record<string, unknown>,
    content: string
  ): { passed: boolean; reason: string; children?: RuleTrace[] };
}
