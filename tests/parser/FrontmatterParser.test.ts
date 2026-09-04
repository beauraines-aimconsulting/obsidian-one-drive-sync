import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FrontmatterParser } from '../../src/parser/FrontmatterParser.js';

describe('FrontmatterParser', () => {
  let parser: FrontmatterParser;

  beforeEach(() => {
    parser = new FrontmatterParser();
    parser.clearCache();
  });

  describe('parse', () => {
    it('should parse valid YAML frontmatter', () => {
      const content = `---
publish: true
category: projects
tags:
  - important
  - work
---
# My Note

This is the content.`;

      const result = parser.parse(content);

      expect(result.frontmatter.publish).toBe(true);
      expect(result.frontmatter.category).toBe('projects');
      expect(result.frontmatter.tags).toEqual(['important', 'work']);
      expect(result.content).toContain('# My Note');
    });

    it('should handle missing frontmatter', () => {
      const content = '# My Note\n\nThis is content without frontmatter.';

      const result = parser.parse(content);

      expect(result.frontmatter).toEqual({});
      expect(result.content).toBe(content);
    });

    it('should handle empty frontmatter', () => {
      const content = `---
---
# My Note`;

      const result = parser.parse(content);

      expect(result.frontmatter).toEqual({});
      expect(result.content).toContain('# My Note');
    });

    it('should handle unclosed frontmatter delimiter', () => {
      const content = `---
publish: true
category: projects

# My Note`;

      const result = parser.parse(content);

      expect(result.frontmatter).toEqual({});
      expect(result.content).toBe(content);
    });

    it('should handle malformed YAML', () => {
      const content = `---
publish: true
bad: [unclosed
---
# My Note`;

      const result = parser.parse(content);

      // Should return empty frontmatter on parse error
      expect(result.frontmatter).toEqual({});
      // The frontmatter block is stripped even on failure, so a malformed
      // block is never emitted verbatim into the published content.
      expect(result.content).toBe('# My Note');
      expect(result.error).toBeDefined();
    });

    it('should trim whitespace from content', () => {
      const content = `---
publish: true
---

# My Note`;

      const result = parser.parse(content);

      expect(result.content).toBe('# My Note');
    });

    it('should handle frontmatter with complex fields', () => {
      const content = `---
publish: true
metadata:
  author: John
  created: 2024-01-01
tags:
  - work
  - urgent
---
Content`;

      const result = parser.parse(content);

      expect(result.frontmatter.publish).toBe(true);
      expect(result.frontmatter.metadata).toEqual({
        author: 'John',
        // Timestamps stay as authored strings (core schema), not Date objects.
        created: '2024-01-01',
      });
    });
  });

  describe('parse errors', () => {
    // Mirrors Obsidian template files with unrendered substitution
    // placeholders — YAML reads the unquoted `{{` as a flow mapping.
    const templateContent = `---
created: {{date}} {{time}}:00
TQ_show_created_date: false
---
# Daily Note`;

    it('should report unquoted {{placeholder}} frontmatter as a parse error', () => {
      const result = parser.parse(templateContent, 'Templates/Daily Note.md');

      expect(result.frontmatter).toEqual({});
      expect(result.error).toBeDefined();
      expect(result.error?.filepath).toBe('Templates/Daily Note.md');
      expect(result.error?.reason).toContain('bad indentation');
    });

    it('should accept the same placeholders when they are quoted', () => {
      const content = `---
created: "{{date}} {{time}}:00"
---
# Daily Note`;

      const result = parser.parse(content, 'Templates/Quoted.md');

      expect(result.error).toBeUndefined();
      expect(result.frontmatter.created).toBe('{{date}} {{time}}:00');
    });

    it('should include the filepath in the error', () => {
      const result = parser.parse('---\nbad: [unclosed\n---\nBody', 'notes/broken.md');

      expect(result.error?.filepath).toBe('notes/broken.md');
    });

    it('should omit the filepath when none is supplied', () => {
      const result = parser.parse('---\nbad: [unclosed\n---\nBody');

      expect(result.error).toBeDefined();
      expect(result.error?.filepath).toBeUndefined();
    });

    it('should report 1-based line and column relative to the file', () => {
      const result = parser.parse(templateContent, 'Templates/Daily Note.md');

      // `created:` is the second line of the file (line 1 is the opening ---).
      expect(result.error?.line).toBe(2);
      expect(result.error?.column).toBeGreaterThan(0);
    });

    it('should offset line numbers past leading blank lines', () => {
      const content = `\n\n---\ncreated: {{date}} {{time}}:00\nx: 1\n---\nBody`;

      const result = parser.parse(content, 'notes/padded.md');

      expect(result.error?.line).toBe(4);
    });

    it('should strip the frontmatter block from content on failure', () => {
      const result = parser.parse(templateContent, 'Templates/Daily Note.md');

      expect(result.content).toBe('# Daily Note');
      expect(result.content).not.toContain('---');
      expect(result.content).not.toContain('{{date}}');
    });

    it('should log a concise warning without a stack trace or note content', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      parser.parse(templateContent, 'Templates/Daily Note.md');

      expect(warn).toHaveBeenCalledTimes(1);
      const output = warn.mock.calls[0].join(' ');
      expect(output).toContain('Templates/Daily Note.md');
      expect(output).toContain('bad indentation');
      // No stack frames and no echoed note content (js-yaml's mark.buffer).
      expect(output).not.toContain('at ');
      expect(output).not.toContain('TQ_show_created_date');

      warn.mockRestore();
    });

    it('should respect LOG_LEVEL by routing through Logger', () => {
      const quietParser = new FrontmatterParser('error');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      quietParser.parse(templateContent, 'Templates/Daily Note.md');

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('should not set an error for content without frontmatter', () => {
      expect(parser.parse('# Just a note').error).toBeUndefined();
    });

    it('should cache the parse error alongside the frontmatter', () => {
      parser.parseAndCache('Templates/Daily Note.md', templateContent);

      expect(parser.getCachedError('Templates/Daily Note.md')?.reason).toContain(
        'bad indentation'
      );

      parser.clearCache('Templates/Daily Note.md');
      expect(parser.getCachedError('Templates/Daily Note.md')).toBeUndefined();
    });

    it('should not report an error for a file that parses cleanly', () => {
      parser.parseAndCache('notes/good.md', '---\npublish: true\n---\nBody');

      expect(parser.getCachedError('notes/good.md')).toBeUndefined();
    });
  });

  describe('timestamp handling', () => {
    it('should keep date fields as the strings the author wrote', () => {
      const content = `---
created: 2026-08-16
updated: 2026-08-16 10:30:00
---
Body`;

      const result = parser.parse(content);

      expect(result.frontmatter.created).toBe('2026-08-16');
      expect(result.frontmatter.updated).toBe('2026-08-16 10:30:00');
      expect(result.frontmatter.created).not.toBeInstanceOf(Date);
    });

    it('should still resolve non-timestamp scalars normally', () => {
      const content = `---
publish: true
count: 5
ratio: 1.5
nothing: ~
---
Body`;

      const result = parser.parse(content);

      expect(result.frontmatter.publish).toBe(true);
      expect(result.frontmatter.count).toBe(5);
      expect(result.frontmatter.ratio).toBe(1.5);
      expect(result.frontmatter.nothing).toBeNull();
    });
  });

  describe('isPublished', () => {
    it('should return true when publish is true', () => {
      const frontmatter = { publish: true };
      expect(parser.isPublished(frontmatter)).toBe(true);
    });

    it('should return false when publish is false', () => {
      const frontmatter = { publish: false };
      expect(parser.isPublished(frontmatter)).toBe(false);
    });

    it('should return false when publish is missing', () => {
      const frontmatter = {};
      expect(parser.isPublished(frontmatter)).toBe(false);
    });
  });

  describe('isPrivate', () => {
    it('should return true when private is true', () => {
      const frontmatter = { private: true };
      expect(parser.isPrivate(frontmatter)).toBe(true);
    });

    it('should return false when private is false', () => {
      const frontmatter = { private: false };
      expect(parser.isPrivate(frontmatter)).toBe(false);
    });

    it('should return false when private is missing', () => {
      const frontmatter = {};
      expect(parser.isPrivate(frontmatter)).toBe(false);
    });
  });

  describe('getTags', () => {
    it('should return tags as array', () => {
      const frontmatter = { tags: ['work', 'important'] };
      expect(parser.getTags(frontmatter)).toEqual(['work', 'important']);
    });

    it('should return empty array when tags is missing', () => {
      const frontmatter = {};
      expect(parser.getTags(frontmatter)).toEqual([]);
    });

    it('should filter out non-string tags', () => {
      const frontmatter = { tags: ['work', 123, 'important'] };
      expect(parser.getTags(frontmatter)).toEqual(['work', 'important']);
    });
  });

  describe('getCategories', () => {
    it('should return category as array when it is a string', () => {
      const frontmatter = { category: 'projects' };
      expect(parser.getCategories(frontmatter)).toEqual(['projects']);
    });

    it('should return categories as array when it is an array', () => {
      const frontmatter = { category: ['projects', 'work'] };
      expect(parser.getCategories(frontmatter)).toEqual(['projects', 'work']);
    });

    it('should return empty array when category is missing', () => {
      const frontmatter = {};
      expect(parser.getCategories(frontmatter)).toEqual([]);
    });

    it('should filter out non-string categories', () => {
      const frontmatter = { category: ['projects', 123, 'work'] };
      expect(parser.getCategories(frontmatter)).toEqual(['projects', 'work']);
    });
  });

  describe('caching', () => {
    it('should cache parsed frontmatter', () => {
      const content = `---
publish: true
---
Content`;

      const fm1 = parser.parseAndCache('test.md', content);
      const fm2 = parser.getCached('test.md');

      expect(fm1).toEqual(fm2);
    });

    it('should return cached frontmatter without reparsing', () => {
      const content = `---
publish: true
---
Content`;

      parser.parseAndCache('test.md', content);
      const cached = parser.getCached('test.md');

      expect(cached).toEqual({ publish: true });
    });

    it('should clear specific cache entry', () => {
      parser.parseAndCache('test.md', '---\npublish: true\n---\nContent');
      parser.clearCache('test.md');

      expect(parser.getCached('test.md')).toBeUndefined();
    });

    it('should clear entire cache', () => {
      parser.parseAndCache('test1.md', '---\npublish: true\n---\nContent');
      parser.parseAndCache('test2.md', '---\npublish: false\n---\nContent');
      parser.clearCache();

      expect(parser.getCached('test1.md')).toBeUndefined();
      expect(parser.getCached('test2.md')).toBeUndefined();
    });
  });

  describe('getField', () => {
    it('should return custom field from frontmatter', () => {
      const frontmatter = { author: 'John', status: 'draft' };
      expect(parser.getField(frontmatter, 'author')).toBe('John');
      expect(parser.getField(frontmatter, 'status')).toBe('draft');
    });

    it('should return undefined for missing field', () => {
      const frontmatter = { author: 'John' };
      expect(parser.getField(frontmatter, 'missing')).toBeUndefined();
    });
  });
});
