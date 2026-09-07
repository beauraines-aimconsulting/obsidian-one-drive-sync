import type { Frontmatter } from './Rule.js';

/**
 * Reserved key under which `PublicationService` threads per-source tag lists
 * into the frontmatter object handed to rules.
 *
 * `frontmatter.tags` keeps carrying the merged union, so rules that do not care
 * about provenance — including any written before this existed — are unaffected.
 * The double underscore marks it as not a real frontmatter field; a note that
 * genuinely declares `__tagSources` would be shadowed here, which is an
 * acceptable trade for not restructuring every rule's input.
 */
export const TAG_SOURCES_KEY = '__tagSources';

/** Where a tag was written. */
export type TagSource = 'frontmatter' | 'inline' | 'task';

/** How a rule selects which tag sources to consider. */
export type TagSourceSelector = TagSource | 'both' | 'all';

export interface TagSources {
  /** Tags declared in the YAML frontmatter block. */
  frontmatter: string[];
  /** `#tags` in the note body, excluding task lines. */
  inline: string[];
  /** `#tags` written on a task/checkbox line. */
  task: string[];
}

export function attachTagSources(frontmatter: Frontmatter, sources: TagSources): Frontmatter {
  return { ...frontmatter, [TAG_SOURCES_KEY]: sources };
}

/**
 * Read the per-source tag lists from a frontmatter object.
 *
 * When the key is absent — rules constructed directly in code, or tests that
 * pass a plain frontmatter object — `tags` is reported as frontmatter tags so
 * that selecting a source never silently sees nothing.
 */
export function readTagSources(frontmatter: Frontmatter): TagSources {
  const raw = (frontmatter as Record<string, unknown>)[TAG_SOURCES_KEY];

  if (raw !== null && typeof raw === 'object') {
    const candidate = raw as Partial<Record<keyof TagSources, unknown>>;
    return {
      frontmatter: toStringArray(candidate.frontmatter),
      inline: toStringArray(candidate.inline),
      task: toStringArray(candidate.task),
    };
  }

  return { frontmatter: toStringArray(frontmatter.tags), inline: [], task: [] };
}

/** Resolve a selector to the de-duplicated tags it covers, in source order. */
export function selectTags(sources: TagSources, selector: TagSourceSelector): string[] {
  const selected: string[] = [];

  if (selector === 'frontmatter' || selector === 'both' || selector === 'all') {
    selected.push(...sources.frontmatter);
  }
  if (selector === 'inline' || selector === 'both' || selector === 'all') {
    selected.push(...sources.inline);
  }
  if (selector === 'task' || selector === 'all') {
    selected.push(...sources.task);
  }

  return Array.from(new Set(selected));
}

/** Human-readable description of a selector, for rule reasons. */
export function describeSelector(selector: TagSourceSelector): string {
  switch (selector) {
    case 'both':
      return 'frontmatter and inline tags';
    case 'all':
      return 'frontmatter, inline, and task tags';
    default:
      return `${selector} tags`;
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}
