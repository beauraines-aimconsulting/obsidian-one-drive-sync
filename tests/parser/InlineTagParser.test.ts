import { describe, it, expect, beforeEach } from 'vitest';
import { InlineTagParser } from '../../src/parser/InlineTagParser.js';

describe('InlineTagParser', () => {
  let parser: InlineTagParser;

  beforeEach(() => {
    parser = new InlineTagParser();
  });

  describe('extractTags', () => {
    describe('basic inline tag extraction', () => {
      it('should extract a single tag', () => {
        const content = 'This is a #tag in text.';
        const tags = parser.extractTags(content);

        expect(tags).toEqual(['tag']);
      });

      it('should extract multiple different tags', () => {
        const content = 'This has #first tag and #second tag and #third.';
        const tags = parser.extractTags(content);

        expect(tags).toContain('first');
        expect(tags).toContain('second');
        expect(tags).toContain('third');
        expect(tags.length).toBe(3);
      });

      it('should not duplicate tags', () => {
        const content = 'We have #tag, #tag again, and #tag one more time.';
        const tags = parser.extractTags(content);

        expect(tags).toEqual(['tag']);
      });

      it('should return sorted tags', () => {
        const content = '#zebra #apple #banana';
        const tags = parser.extractTags(content);

        expect(tags).toEqual(['apple', 'banana', 'zebra']);
      });
    });

    describe('tags mixed with content', () => {
      it('should extract tags from mixed content', () => {
        const content = `
# My Note

This is a note about #projects and #work.

We also discuss #learning.
`;
        const tags = parser.extractTags(content);

        expect(tags).toContain('projects');
        expect(tags).toContain('work');
        expect(tags).toContain('learning');
      });

      it('should extract tags at the beginning of content', () => {
        const content = '#start of content with more #tags.';
        const tags = parser.extractTags(content);

        expect(tags).toContain('start');
        expect(tags).toContain('tags');
      });

      it('should extract tags at the end of content', () => {
        const content = 'Content with tags at end #first #second #third';
        const tags = parser.extractTags(content);

        expect(tags).toContain('first');
        expect(tags).toContain('second');
        expect(tags).toContain('third');
      });

      it('should extract tags after punctuation', () => {
        const content = 'This is important! #urgent Related? #related';
        const tags = parser.extractTags(content);

        expect(tags).toContain('urgent');
        expect(tags).toContain('related');
      });
    });

    describe('ignoring markdown link anchors', () => {
      it('should not extract tags from markdown link anchors', () => {
        const content = '[Go to section](#section-anchor)';
        const tags = parser.extractTags(content);

        expect(tags).toEqual([]);
      });

      it('should extract tags from text but ignore anchors', () => {
        const content = 'We use #mytag for this. [See reference](#mytag)';
        const tags = parser.extractTags(content);

        expect(tags).toEqual(['mytag']);
      });

      it('should ignore multiple anchors', () => {
        const content = '[Link1](#anchor1) and [Link2](#anchor2) with #realtag';
        const tags = parser.extractTags(content);

        expect(tags).toEqual(['realtag']);
      });

      it('should handle mixed anchors and tags', () => {
        const content = `
[Table of Contents](#toc)
Check out #important for details.
[Back to top](#top)
`;
        const tags = parser.extractTags(content);

        expect(tags).toEqual(['important']);
      });
    });

    describe('ignoring code blocks', () => {
      it('should not extract tags from triple backtick code blocks', () => {
        const content = `Here is some code:
\`\`\`
const tag = '#notrealtag';
function test() {
  return #falsetag;
}
\`\`\`
Real tag: #realtag`;
        const tags = parser.extractTags(content);

        expect(tags).toEqual(['realtag']);
      });

      it('should not extract tags from inline code', () => {
        const content = 'Use the command `echo #nottagged` to print. The real #tag is here.';
        const tags = parser.extractTags(content);

        expect(tags).toEqual(['tag']);
      });

      it('should handle nested code in content', () => {
        const content = `
Here is a #real tag.

\`\`\`javascript
// #fake tag
const myVar = '#alsoFake';
\`\`\`

Another #another tag.
`;
        const tags = parser.extractTags(content);

        expect(tags).toContain('real');
        expect(tags).toContain('another');
        expect(tags).not.toContain('fake');
        expect(tags).not.toContain('alsoFake');
      });

      it('should handle multiple inline code blocks', () => {
        const content = 'Use `#code1` or `#code2` but not #real';
        const tags = parser.extractTags(content);

        expect(tags).toEqual(['real']);
      });

      it('should handle code blocks with multiple hash symbols', () => {
        const content = `
#real tag

\`\`\`
#comment #another #block
\`\`\`

#end tag
`;
        const tags = parser.extractTags(content);

        expect(tags).toContain('real');
        expect(tags).toContain('end');
        expect(tags).not.toContain('comment');
        expect(tags).not.toContain('another');
        expect(tags).not.toContain('block');
      });
    });

    describe('tag validation and format', () => {
      it('should accept tags with letters', () => {
        const content = '#abc #XYZ #CamelCase';
        const tags = parser.extractTags(content);

        expect(tags.length).toBe(3);
      });

      it('should accept tags with numbers', () => {
        const content = '#tag1 #test2 #hash123';
        const tags = parser.extractTags(content);

        expect(tags).toContain('tag1');
        expect(tags).toContain('test2');
        expect(tags).toContain('hash123');
      });

      it('should accept tags with underscores', () => {
        const content = '#my_tag #test_case #under_score_test';
        const tags = parser.extractTags(content);

        expect(tags).toContain('my_tag');
        expect(tags).toContain('test_case');
        expect(tags).toContain('under_score_test');
      });

      it('should accept tags with hyphens', () => {
        const content = '#my-tag #test-case #hyphen-separated';
        const tags = parser.extractTags(content);

        expect(tags).toContain('my-tag');
        expect(tags).toContain('test-case');
        expect(tags).toContain('hyphen-separated');
      });

      it('should not extract # without following characters', () => {
        const content = 'This is a # symbol without tag. Here is #validtag.';
        const tags = parser.extractTags(content);

        expect(tags).toEqual(['validtag']);
      });

      it('should not extract # followed by only special characters', () => {
        const content = 'This #! or #@ should not work, but #valid should.';
        const tags = parser.extractTags(content);

        expect(tags).toEqual(['valid']);
      });

      it('should extract tags starting with numbers', () => {
        const content = '#123 #9test #0zero';
        const tags = parser.extractTags(content);

        expect(tags).toContain('123');
        expect(tags).toContain('9test');
        expect(tags).toContain('0zero');
      });
    });

    describe('edge cases', () => {
      it('should handle empty content', () => {
        const content = '';
        const tags = parser.extractTags(content);

        expect(tags).toEqual([]);
      });

      it('should handle content with only whitespace', () => {
        const content = '   \n\t  \n  ';
        const tags = parser.extractTags(content);

        expect(tags).toEqual([]);
      });

      it('should handle very long tag names', () => {
        const longTag = '#' + 'a'.repeat(100);
        const content = `Here is a ${longTag} tag.`;
        const tags = parser.extractTags(content);

        expect(tags).toContain('a'.repeat(100));
      });

      it('should handle content with only tags', () => {
        const content = '#tag1 #tag2 #tag3';
        const tags = parser.extractTags(content);

        expect(tags).toEqual(['tag1', 'tag2', 'tag3']);
      });

      it('should handle tags with surrounding punctuation', () => {
        const content = '(#tag1) [#tag2] {#tag3} - #tag4, #tag5.';
        const tags = parser.extractTags(content);

        expect(tags).toContain('tag1');
        expect(tags).toContain('tag2');
        expect(tags).toContain('tag3');
        expect(tags).toContain('tag4');
        expect(tags).toContain('tag5');
      });

      it('should not extract tags with spaces in the name', () => {
        const content = 'Check #python code, #javascript and #typescript.';
        const tags = parser.extractTags(content);

        expect(tags).toEqual(['javascript', 'python', 'typescript']);
      });

      it('should handle consecutive tags separated by punctuation', () => {
        const content = '#tag1 (or #tag2) and #tag3.';
        const tags = parser.extractTags(content);

        expect(tags).toEqual(['tag1', 'tag2', 'tag3']);
      });

      it('should handle tag followed by newline', () => {
        const content = `This is #tag1
on a new line with #tag2`;
        const tags = parser.extractTags(content);

        expect(tags).toContain('tag1');
        expect(tags).toContain('tag2');
      });

      it('should handle mixed case tags', () => {
        const content = '#MyTag #ALLCAPS #camelCase';
        const tags = parser.extractTags(content);

        expect(tags).toContain('MyTag');
        expect(tags).toContain('ALLCAPS');
        expect(tags).toContain('camelCase');
      });

      it('should handle complex real-world example', () => {
        const content = `
# My Project Note

This is about #projects and #work. We're using #automation with [reference](#link).

\`\`\`javascript
// const tag = '#notincluded';
function process() {
  return #fake;
}
\`\`\`

Check the code and use \`#nothere\` pattern. Final tags: #important #urgent
`;
        const tags = parser.extractTags(content);

        expect(tags).toContain('projects');
        expect(tags).toContain('work');
        expect(tags).toContain('automation');
        expect(tags).toContain('important');
        expect(tags).toContain('urgent');
        expect(tags).not.toContain('notincluded');
        expect(tags).not.toContain('fake');
        expect(tags).not.toContain('nothere');
        expect(tags).not.toContain('link');
      });
    });
  });

  describe('removeCodeBlocks', () => {
    it('should remove triple backtick code blocks', () => {
      const content = `Before
\`\`\`
code here
\`\`\`
After`;
      const result = (parser as InlineTagParser).removeCodeBlocks(content);

      expect(result).not.toContain('code here');
      expect(result).toContain('Before');
      expect(result).toContain('After');
    });

    it('should remove inline code with backticks', () => {
      const content = 'Text with `inline code` and more text.';
      const result = (parser as InlineTagParser).removeCodeBlocks(content);

      expect(result).not.toContain('inline code');
      expect(result).toContain('Text with');
      expect(result).toContain('and more text.');
    });

    it('should handle multiple code blocks', () => {
      const content = `Start \`code1\` middle \`\`\`
block
\`\`\` end`;
      const result = (parser as InlineTagParser).removeCodeBlocks(content);

      expect(result).not.toContain('code1');
      expect(result).not.toContain('block');
    });
  });

  describe('isValidTagName', () => {
    it('should return true for valid tag names', () => {
      expect(parser.isValidTagName('tag')).toBe(true);
      expect(parser.isValidTagName('MyTag')).toBe(true);
      expect(parser.isValidTagName('tag123')).toBe(true);
      expect(parser.isValidTagName('my_tag')).toBe(true);
      expect(parser.isValidTagName('my-tag')).toBe(true);
      expect(parser.isValidTagName('_')).toBe(true);
      expect(parser.isValidTagName('-')).toBe(true);
      expect(parser.isValidTagName('123')).toBe(true);
    });

    it('should return false for invalid tag names', () => {
      expect(parser.isValidTagName('my tag')).toBe(false);
      expect(parser.isValidTagName('tag!')).toBe(false);
      expect(parser.isValidTagName('tag@')).toBe(false);
      expect(parser.isValidTagName('tag#')).toBe(false);
      expect(parser.isValidTagName('tag.')).toBe(false);
      expect(parser.isValidTagName('tag/')).toBe(false);
      expect(parser.isValidTagName('')).toBe(false);
    });

    it('should return false for special characters', () => {
      expect(parser.isValidTagName('tag()')).toBe(false);
      expect(parser.isValidTagName('tag[]')).toBe(false);
      expect(parser.isValidTagName('tag{}')).toBe(false);
      expect(parser.isValidTagName('tag+')).toBe(false);
      expect(parser.isValidTagName('tag=')).toBe(false);
    });
  });

  describe('normalizeTag', () => {
    it('should convert tag to lowercase', () => {
      expect(parser.normalizeTag('MyTag')).toBe('mytag');
      expect(parser.normalizeTag('UPPERCASE')).toBe('uppercase');
      expect(parser.normalizeTag('MiXeDcAsE')).toBe('mixedcase');
    });

    it('should trim whitespace', () => {
      expect(parser.normalizeTag('  tag  ')).toBe('tag');
      expect(parser.normalizeTag('\ttag\n')).toBe('tag');
      expect(parser.normalizeTag('  My Tag  ')).toBe('my tag');
    });

    it('should handle combination of lowercase and whitespace', () => {
      expect(parser.normalizeTag('  MyTag  ')).toBe('mytag');
      expect(parser.normalizeTag('\t UPPERCASE \n')).toBe('uppercase');
    });

    it('should preserve numbers and special allowed characters', () => {
      expect(parser.normalizeTag('tag123')).toBe('tag123');
      expect(parser.normalizeTag('My_Tag')).toBe('my_tag');
      expect(parser.normalizeTag('My-Tag')).toBe('my-tag');
    });

    it('should handle empty string', () => {
      expect(parser.normalizeTag('')).toBe('');
    });
  });
});
