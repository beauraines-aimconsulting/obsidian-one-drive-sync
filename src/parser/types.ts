export interface Frontmatter {
  [key: string]: unknown;
  publish?: boolean;
  category?: string | string[];
  tags?: string[];
  private?: boolean;
}

export interface ParseResult {
  frontmatter: Frontmatter;
  content: string;
}
