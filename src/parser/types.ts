export interface Frontmatter {
  [key: string]: unknown;
  publish?: boolean;
  category?: string | string[];
  tags?: string[];
  private?: boolean;
}

/**
 * Describes a YAML frontmatter block that could not be parsed.
 * Locations are 1-based and relative to the start of the source file,
 * so they match what an editor displays.
 */
export interface FrontmatterParseError {
  /** Vault-relative path, when the caller supplied one. */
  filepath?: string;
  /** 1-based line within the source file. */
  line?: number;
  /** 1-based column within the source file. */
  column?: number;
  /** Short human-readable cause, e.g. "bad indentation of a mapping entry". */
  reason: string;
}

export interface ParseResult {
  frontmatter: Frontmatter;
  content: string;
  /** Present only when a frontmatter block was found but failed to parse. */
  error?: FrontmatterParseError;
}
