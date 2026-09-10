/** Where an inline tag was found. */
export type InlineTagSource = 'inline' | 'task';

export interface SourcedTag {
  tag: string;
  source: InlineTagSource;
}

/**
 * Matches a markdown task line: `- [ ]`, `* [x]`, `+ [/]`, and Obsidian's
 * custom checkbox statuses, at any indentation.
 */
const TASK_LINE_PATTERN = /^\s*[-*+]\s+\[[^\]]?\]\s/;

/**
 * Extracts Obsidian inline tags (#tagname) from markdown content.
 * Ignores markdown link anchors ([text](#anchor)), wikilink bookmarks ([[File#bookmark]]), and code blocks.
 */
export class InlineTagParser {
  /**
   * Extract all inline tags from markdown content.
   * Regex matches #tagname but excludes markdown link anchors and wikilink bookmarks.
   */
  extractTags(content: string): string[] {
    return Array.from(
      new Set(this.extractTagsWithSource(content).map((entry) => entry.tag))
    ).sort();
  }

  /**
   * Extract inline tags along with where each one was written.
   *
   * A tag on a task line (`- [ ] call vendor #waiting`) annotates that task
   * rather than labelling the note, so rules need to be able to tell the two
   * apart. A tag appearing in both positions is reported once per source.
   */
  extractTagsWithSource(content: string): SourcedTag[] {
    // Cleaning is done per line so that a tag's line number — and therefore
    // whether it sits on a task — survives the removals. Fenced code blocks
    // still have to be stripped up front, since they span lines.
    const lines = this.blankCodeBlocks(content).split('\n');
    const seen = new Set<string>();
    const results: SourcedTag[] = [];

    for (const line of lines) {
      const source: InlineTagSource = TASK_LINE_PATTERN.test(line) ? 'task' : 'inline';

      let cleanLine = this.removeWikilinks(line);
      cleanLine = this.removeMarkdownLinks(cleanLine);
      cleanLine = this.removeInlineCode(cleanLine);

      // \B ensures # is not at a word boundary (i.e., preceded by non-word char or at start)
      const tagRegex = /\B#([a-zA-Z0-9_/-]+)/g;

      let match;
      while ((match = tagRegex.exec(cleanLine)) !== null) {
        const tag = match[1];
        if (!tag) continue;

        const key = `${source}:${tag}`;
        if (seen.has(key)) continue;

        seen.add(key);
        results.push({ tag, source });
      }
    }

    return results;
  }

  /**
   * Remove code blocks (triple backticks and inline code) from content.
   * This prevents extracting tags from code examples.
   */
  private removeCodeBlocks(content: string): string {
    return this.removeInlineCode(this.blankCodeBlocks(content));
  }

  /**
   * Replace fenced code blocks with the same number of blank lines, so that
   * line-based scanning keeps its alignment with the original document.
   */
  private blankCodeBlocks(content: string): string {
    return content.replace(/```[\s\S]*?```/g, (block) => '\n'.repeat(block.split('\n').length - 1));
  }

  /** Remove inline code spans (backticks) so tags inside them are not matched. */
  private removeInlineCode(content: string): string {
    return content.replace(/`[^`]*`/g, '');
  }

  /**
   * Remove wikilinks [[link]] and [[link#bookmark]] to avoid extracting bookmarks as tags.
   */
  private removeWikilinks(content: string): string {
    return content.replace(/\[\[([^\]]*)\]\]/g, '');
  }

  /**
   * Remove markdown links [text](#anchor) to avoid extracting anchor tags.
   */
  private removeMarkdownLinks(content: string): string {
    return content.replace(/\[([^\]]*)\]\(([^)]*)\)/g, '');
  }

  /**
   * Check if a string is a valid Obsidian tag name.
   * Tags can contain letters, numbers, underscores, and hyphens.
   */
  isValidTagName(tag: string): boolean {
    return /^[a-zA-Z0-9_-]+$/.test(tag);
  }

  /**
   * Normalize tag name (lowercase, trim).
   */
  normalizeTag(tag: string): string {
    return tag.toLowerCase().trim();
  }
}
