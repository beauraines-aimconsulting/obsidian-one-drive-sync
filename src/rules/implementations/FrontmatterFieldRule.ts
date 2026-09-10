import { Rule } from '../Rule.js';
import type { Frontmatter, EvaluationResult } from '../Rule.js';

export type FieldOperator =
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

export interface FieldCondition {
  /** Dot path into the frontmatter, e.g. `meta.review.status`. */
  field: string;
  op: FieldOperator;
  value?: unknown;
  caseInsensitive?: boolean;
}

export interface FrontmatterFieldRuleConfig {
  conditions: FieldCondition[];
  /** Whether every condition must hold (default) or any one of them. */
  mode?: 'all' | 'any';
}

/**
 * General-purpose frontmatter matching.
 *
 * Every operator is total: an operand of the wrong type fails the condition
 * with a reason naming the mismatch rather than throwing, because a single
 * odd note must never abort a whole sync.
 */
export class FrontmatterFieldRule extends Rule {
  name = 'FrontmatterFieldRule';
  private readonly conditions: FieldCondition[];
  private readonly mode: 'all' | 'any';
  /** Regexes for `matches`, compiled once; index-aligned with `conditions`. */
  private readonly patterns: Array<RegExp | undefined>;

  constructor(config: FrontmatterFieldRuleConfig) {
    super();
    this.conditions = config.conditions ?? [];
    this.mode = config.mode ?? 'all';
    this.patterns = this.conditions.map((condition) => {
      if (condition.op !== 'matches') return undefined;
      if (typeof condition.value !== 'string') {
        throw new Error(
          `FrontmatterFieldRule: "matches" on field "${condition.field}" requires a string pattern`
        );
      }
      return new RegExp(condition.value, condition.caseInsensitive ? 'i' : '');
    });
  }

  evaluate(_filepath: string, frontmatter: Frontmatter): EvaluationResult {
    if (this.conditions.length === 0) {
      return { passed: true, reason: 'No conditions configured' };
    }

    const outcomes = this.conditions.map((condition, index) =>
      this.test(condition, index, frontmatter)
    );

    const passed =
      this.mode === 'all' ? outcomes.every((o) => o.passed) : outcomes.some((o) => o.passed);

    // Report the outcomes that explain the decision. In `all` mode a failure is
    // explained by the conditions that failed; in `any` mode a pass is
    // explained by the ones that passed. The other two cases involve every
    // condition, which the fallback below covers.
    const drivers = outcomes.filter((outcome) => outcome.passed === (this.mode === 'any'));
    const summary = (drivers.length > 0 ? drivers : outcomes).map((o) => o.reason).join('; ');

    return { passed, reason: summary };
  }

  private test(
    condition: FieldCondition,
    index: number,
    frontmatter: Frontmatter
  ): { passed: boolean; reason: string } {
    const actual = resolvePath(frontmatter, condition.field);
    const label = `${condition.field} ${condition.op}`;
    const pass = (detail: string): { passed: boolean; reason: string } => ({
      passed: true,
      reason: `${label}: ${detail}`,
    });
    const fail = (detail: string): { passed: boolean; reason: string } => ({
      passed: false,
      reason: `${label}: ${detail}`,
    });

    switch (condition.op) {
      case 'exists':
        return actual === undefined ? fail('field is missing') : pass('field is present');

      case 'notExists':
        return actual === undefined ? pass('field is missing') : fail('field is present');

      case 'truthy':
        return isTruthy(actual) ? pass('value is truthy') : fail(`value is ${describe(actual)}`);

      case 'equals':
        return valuesEqual(actual, condition.value, condition.caseInsensitive)
          ? pass(`${describe(actual)} equals expected`)
          : fail(`${describe(actual)} !== ${describe(condition.value)}`);

      case 'notEquals':
        return valuesEqual(actual, condition.value, condition.caseInsensitive)
          ? fail(`${describe(actual)} equals ${describe(condition.value)}`)
          : pass(`${describe(actual)} differs from expected`);

      case 'in':
      case 'notIn': {
        if (!Array.isArray(condition.value)) {
          return fail(`"${condition.op}" requires an array of values in the rule config`);
        }
        const found = condition.value.some((candidate) =>
          valuesEqual(actual, candidate, condition.caseInsensitive)
        );
        if (condition.op === 'in') {
          return found
            ? pass(`${describe(actual)} is listed`)
            : fail(`${describe(actual)} is not listed`);
        }
        return found
          ? fail(`${describe(actual)} is listed`)
          : pass(`${describe(actual)} is not listed`);
      }

      case 'contains':
        return this.testContains(actual, condition, fail, pass);

      case 'matches': {
        const pattern = this.patterns[index];
        if (!pattern) return fail('no pattern configured');

        if (typeof actual === 'string') {
          return pattern.test(actual)
            ? pass(`"${actual}" matches ${pattern.source}`)
            : fail(`"${actual}" does not match ${pattern.source}`);
        }
        if (Array.isArray(actual)) {
          const hit = actual.find((entry) => typeof entry === 'string' && pattern.test(entry));
          return hit === undefined
            ? fail(`no member matches ${pattern.source}`)
            : pass(`"${String(hit)}" matches ${pattern.source}`);
        }
        return fail(`cannot match ${describe(actual)} against a pattern`);
      }

      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const left = toComparable(actual);
        const right = toComparable(condition.value);

        if (left === undefined || right === undefined) {
          return fail(
            `cannot compare ${describe(actual)} with ${describe(condition.value)}; expected numbers or ISO-8601 dates`
          );
        }

        const holds =
          condition.op === 'gt'
            ? left > right
            : condition.op === 'gte'
              ? left >= right
              : condition.op === 'lt'
                ? left < right
                : left <= right;

        return holds
          ? pass(`${describe(actual)} ${condition.op} ${describe(condition.value)}`)
          : fail(`${describe(actual)} is not ${condition.op} ${describe(condition.value)}`);
      }

      default:
        return fail(`unsupported operator`);
    }
  }

  private testContains(
    actual: unknown,
    condition: FieldCondition,
    fail: (detail: string) => { passed: boolean; reason: string },
    pass: (detail: string) => { passed: boolean; reason: string }
  ): { passed: boolean; reason: string } {
    if (Array.isArray(actual)) {
      return actual.some((entry) => valuesEqual(entry, condition.value, condition.caseInsensitive))
        ? pass(`array contains ${describe(condition.value)}`)
        : fail(`array does not contain ${describe(condition.value)}`);
    }

    if (typeof actual === 'string' && typeof condition.value === 'string') {
      const haystack = condition.caseInsensitive ? actual.toLowerCase() : actual;
      const needle = condition.caseInsensitive ? condition.value.toLowerCase() : condition.value;
      return haystack.includes(needle)
        ? pass(`"${actual}" contains "${condition.value}"`)
        : fail(`"${actual}" does not contain "${condition.value}"`);
    }

    return fail(`cannot search ${describe(actual)} for ${describe(condition.value)}`);
  }
}

/** Resolve a dot path without `any`, stopping at the first non-object. */
function resolvePath(source: Frontmatter, path: string): unknown {
  let current: unknown = source;

  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;

    // Arrays are indexable by number, which makes `authors.0` work.
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function isTruthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

function valuesEqual(left: unknown, right: unknown, caseInsensitive?: boolean): boolean {
  if (caseInsensitive && typeof left === 'string' && typeof right === 'string') {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

/**
 * Convert a value to something orderable. Frontmatter is parsed with the YAML
 * core schema, so dates arrive as the strings the author wrote and are compared
 * as timestamps here rather than lexically.
 */
function toComparable(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;

    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

    if (/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(trimmed)) {
      const parsed = Date.parse(trimmed.replace(' ', 'T'));
      return Number.isNaN(parsed) ? undefined : parsed;
    }
  }

  if (value instanceof Date) return value.getTime();

  return undefined;
}

function describe(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map((entry) => describe(entry)).join(', ')}]`;
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'object') return 'object';
  return String(value);
}
