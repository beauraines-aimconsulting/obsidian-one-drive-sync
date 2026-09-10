import { Rule } from '../Rule.js';
import type { Frontmatter, EvaluationResult } from '../Rule.js';
import { compileGlobs } from '../../utils/glob.js';
import {
  describeSelector,
  readTagSources,
  selectTags,
  type TagSourceSelector,
} from '../tagSources.js';

export interface TagRuleConfig {
  allowList?: string[];
  ignoreList?: string[];
  /** Pass when at least one tag is allowListed, rather than requiring all tags to be. */
  requireAny?: boolean;
  /** Require every allowList entry to be present on the note. */
  requireAll?: boolean;
  /**
   * Which tags to consider. Defaults to `both` — frontmatter and inline tags,
   * excluding tags written on task lines.
   */
  source?: TagSourceSelector;
  caseInsensitive?: boolean;
  /** Treat a parent tag as matching its children (`project` matches `project/alpha`). */
  matchNested?: boolean;
}

/**
 * Checks if the file's tags match allowList or ignoreList rules.
 *
 * AllowList and ignoreList entries may be plain tags or globs (`project/*`), and
 * a leading `#` is accepted so config can be written the way tags appear in a
 * note.
 */
export class TagRule extends Rule {
  name = 'TagRule';
  private readonly allowList: string[];
  private readonly ignoreList: string[];
  private readonly matchAllowList: (value: string) => boolean;
  private readonly matchIgnoreList: (value: string) => boolean;
  private readonly matchEachAllowListEntry: Array<(value: string) => boolean>;
  private readonly requireAny: boolean;
  private readonly requireAll: boolean;
  private readonly source: TagSourceSelector;
  private readonly caseInsensitive: boolean;
  private readonly matchNested: boolean;

  constructor(config?: TagRuleConfig) {
    super();
    this.allowList = (config?.allowList ?? []).map(normalizeTag);
    this.ignoreList = (config?.ignoreList ?? []).map(normalizeTag);
    this.requireAny = config?.requireAny ?? false;
    this.requireAll = config?.requireAll ?? false;
    this.source = config?.source ?? 'both';
    this.caseInsensitive = config?.caseInsensitive ?? false;
    this.matchNested = config?.matchNested ?? false;

    const options = { caseInsensitive: this.caseInsensitive, dot: true };
    this.matchAllowList = compileGlobs(this.expand(this.allowList), options);
    this.matchIgnoreList = compileGlobs(this.expand(this.ignoreList), options);
    // `requireAll` asks a per-entry question, so each entry needs its own
    // matcher rather than the combined one.
    this.matchEachAllowListEntry = this.allowList.map((pattern) =>
      compileGlobs(this.expand([pattern]), options)
    );
  }

  /**
   * Nested matching is expressed as an extra glob rather than a separate
   * comparison path, so `project` and `project/*` go through one matcher.
   */
  private expand(patterns: string[]): string[] {
    if (!this.matchNested) return patterns;
    return patterns.flatMap((pattern) => [pattern, `${pattern}/**`]);
  }

  private getTags(frontmatter: Frontmatter): string[] {
    return selectTags(readTagSources(frontmatter), this.source).map(normalizeTag);
  }

  evaluate(_filepath: string, frontmatter: Frontmatter): EvaluationResult {
    const tags = this.getTags(frontmatter);
    const where = describeSelector(this.source);

    if (this.ignoreList.length > 0) {
      const ignoreListed = tags.filter((tag) => this.matchIgnoreList(tag));
      if (ignoreListed.length > 0) {
        return { passed: false, reason: `Tag is ignoreListed: ${ignoreListed.join(', ')}` };
      }
    }

    if (this.allowList.length > 0) {
      if (this.requireAll) {
        const missing = this.allowList.filter(
          (_pattern, index) => !tags.some((tag) => this.matchEachAllowListEntry[index](tag))
        );

        if (missing.length > 0) {
          return {
            passed: false,
            reason: `Missing required tags (${where}): ${missing.join(', ')}`,
          };
        }
      } else if (this.requireAny) {
        if (!tags.some((tag) => this.matchAllowList(tag))) {
          return {
            passed: false,
            reason: `None of the ${where} match allowList: ${this.allowList.join(', ')}`,
          };
        }
      } else {
        const invalidTags = tags.filter((tag) => !this.matchAllowList(tag));
        if (tags.length > 0 && invalidTags.length > 0) {
          return { passed: false, reason: `Tags not in allowList: ${invalidTags.join(', ')}` };
        }
      }
    }

    return {
      passed: true,
      reason: tags.length > 0 ? `Tags: ${tags.join(', ')}` : 'No tags specified',
    };
  }
}

/** Accept `#tag` in config and frontmatter alike; Obsidian writes both. */
function normalizeTag(tag: string): string {
  return tag.startsWith('#') ? tag.slice(1) : tag;
}
