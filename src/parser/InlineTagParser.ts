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
    const tags: Set<string> = new Set();

    // Remove wikilinks to avoid extracting tags from bookmarks like [[File#bookmark]]
    let cleanContent = this.removeWikilinks(content);

    // Remove markdown links to avoid extracting tags from anchors like [text](#anchor)
    cleanContent = this.removeMarkdownLinks(cleanContent);

    // Remove code blocks to avoid extracting tags from code
    cleanContent = this.removeCodeBlocks(cleanContent);

    // Regex: Match #tagname
    // \B ensures # is not at a word boundary (i.e., preceded by non-word char or at start)
    const tagRegex = /\B#([a-zA-Z0-9_-]+)/g;

    let match;
    while ((match = tagRegex.exec(cleanContent)) !== null) {
      const tag = match[1];
      if (tag) {
        tags.add(tag);
      }
    }

    return Array.from(tags).sort();
  }

  /**
   * Remove code blocks (triple backticks and inline code) from content.
   * This prevents extracting tags from code examples.
   */
  private removeCodeBlocks(content: string): string {
    // Remove triple backtick code blocks
    let cleaned = content.replace(/```[\s\S]*?```/g, '');

    // Remove inline code (backticks)
    cleaned = cleaned.replace(/`[^`]*`/g, '');

    return cleaned;
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
