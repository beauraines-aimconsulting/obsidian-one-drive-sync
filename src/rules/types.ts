export interface RuleEngineConfig {
  rules: { name: string; rule: Rule }[];
  composition?: 'AND' | 'OR';
}

export interface EngineResult {
  eligible: boolean;
  reason: string;
  appliedRules: { name: string; passed: boolean; reason: string }[];
}

// Re-export from rule implementations
export abstract class Rule {
  abstract name: string;
  abstract evaluate(
    filepath: string,
    frontmatter: Record<string, unknown>,
    content: string
  ): { passed: boolean; reason: string };
}
