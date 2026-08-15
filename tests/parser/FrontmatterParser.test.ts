import { describe, it, expect, beforeEach } from 'vitest';
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
      expect(result.content).toBe(content);
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
        created: '2024-01-01',
      });
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
