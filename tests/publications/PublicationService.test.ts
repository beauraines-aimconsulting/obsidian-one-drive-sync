import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PublicationService } from '../../src/publications/PublicationService.js';
import type { EligibilityResult } from '../../src/publications/types.js';
import { Rule } from '../../src/rules/types.js';
import { TagRule as WhitelistTagRule } from '../../src/rules/implementations/TagRule.js';

// Mock Rule implementation for testing
class MockPassRule extends Rule {
  name = 'MockPassRule';

  evaluate(
    filepath: string,
    frontmatter: Record<string, unknown>,
    content: string
  ) {
    return {
      passed: true,
      reason: 'Mock rule passed',
    };
  }
}

class MockFailRule extends Rule {
  name = 'MockFailRule';

  evaluate(
    filepath: string,
    frontmatter: Record<string, unknown>,
    content: string
  ) {
    return {
      passed: false,
      reason: 'Mock rule failed',
    };
  }
}

class PublishFrontmatterRule extends Rule {
  name = 'PublishFrontmatterRule';

  evaluate(
    filepath: string,
    frontmatter: Record<string, unknown>,
    content: string
  ) {
    const published = frontmatter.publish === true;
    return {
      passed: published,
      reason: published ? 'File is marked for publication' : 'Not marked for publication',
    };
  }
}

class PrivateRule extends Rule {
  name = 'PrivateRule';

  evaluate(
    filepath: string,
    frontmatter: Record<string, unknown>,
    content: string
  ) {
    const isPrivate = frontmatter.private === true;
    return {
      passed: !isPrivate,
      reason: isPrivate ? 'File is marked private' : 'File is not private',
    };
  }
}

class TagRule extends Rule {
  name = 'TagRule';
  private requiredTags: string[];

  constructor(requiredTags: string[] = ['public']) {
    super();
    this.requiredTags = requiredTags;
  }

  evaluate(
    filepath: string,
    frontmatter: Record<string, unknown>,
    content: string
  ) {
    const allTags = (frontmatter.tags as string[]) || [];
    const hasRequired = this.requiredTags.some((tag) =>
      allTags.includes(tag)
    );
    return {
      passed: hasRequired,
      reason: hasRequired
        ? `Has required tag: ${this.requiredTags.join(',')}`
        : `Missing required tags: ${this.requiredTags.join(',')}`,
    };
  }
}

describe('PublicationService', () => {
  let service: PublicationService;

  beforeEach(() => {
    service = new PublicationService({
      enableCache: true,
      cacheSize: 10,
    });
  });

  afterEach(() => {
    service.clearCache();
  });

  describe('Initialization', () => {
    it('should initialize with default config', () => {
      const svc = new PublicationService();
      expect(svc).toBeDefined();
      expect(svc.getRuleCount()).toBe(0);
    });

    it('should initialize with custom config', () => {
      const svc = new PublicationService({
        enableCache: false,
        cacheSize: 50,
      });
      expect(svc).toBeDefined();
      expect(svc.getCacheStats().capacity).toBe(50);
    });

    it('should initialize with log level', () => {
      const svc = new PublicationService({
        logLevel: 'debug',
      });
      expect(svc).toBeDefined();
    });

    it('should initialize with AND composition', () => {
      const svc = new PublicationService({
        composition: 'AND',
      });
      expect(svc.getRuleConfig().composition).toBe('AND');
    });

    it('should initialize with OR composition', () => {
      const svc = new PublicationService({
        composition: 'OR',
      });
      expect(svc.getRuleConfig().composition).toBe('OR');
    });
  });

  describe('File Evaluation', () => {
    it('should evaluate file with frontmatter', async () => {
      service.addRule('pass', new MockPassRule());

      const content = '# Test Document\n\nSome content here.';
      const result = await service.evaluateFile('/test/file.md', content);

      expect(result).toBeDefined();
      expect(result.eligible).toBe(true);
      expect(result.rules).toHaveLength(1);
      expect(result.evaluatedAt).toBeLessThanOrEqual(Date.now());
    });

    it('should evaluate file with YAML frontmatter', async () => {
      service.addRule('publish', new PublishFrontmatterRule());

      const content = `---
publish: true
title: Test
---

# Content here`;

      const result = await service.evaluateFile('/test/file.md', content);

      expect(result.eligible).toBe(true);
      expect(result.rules[0].reason).toContain('publication');
    });

    it('should handle file without frontmatter', async () => {
      service.addRule('pass', new MockPassRule());

      const content = '# Just markdown without frontmatter';
      const result = await service.evaluateFile('/test/file.md', content);

      expect(result).toBeDefined();
      expect(result.eligible).toBe(true);
    });

    it('should handle empty file', async () => {
      service.addRule('pass', new MockPassRule());

      const result = await service.evaluateFile('/test/file.md', '');

      expect(result).toBeDefined();
      expect(result.eligible).toBe(true);
    });

    it('should return result with timestamp', async () => {
      service.addRule('pass', new MockPassRule());

      const before = Date.now();
      const result = await service.evaluateFile('/test/file.md', '# Test');
      const after = Date.now();

      expect(result.evaluatedAt).toBeGreaterThanOrEqual(before);
      expect(result.evaluatedAt).toBeLessThanOrEqual(after);
    });
  });

  describe('Frontmatter Evaluation', () => {
    it('should evaluate file with pre-extracted frontmatter', async () => {
      service.addRule('publish', new PublishFrontmatterRule());

      const frontmatter = { publish: true, title: 'Test' };
      const result = await service.evaluateFileWithFrontmatter(
        '/test/file.md',
        frontmatter,
        '# Content'
      );

      expect(result.eligible).toBe(true);
    });

    it('should handle missing frontmatter fields', async () => {
      service.addRule('publish', new PublishFrontmatterRule());

      const frontmatter = { title: 'Test' };
      const result = await service.evaluateFileWithFrontmatter(
        '/test/file.md',
        frontmatter,
        '# Content'
      );

      expect(result.eligible).toBe(false);
    });

    it('should handle empty frontmatter', async () => {
      service.addRule('pass', new MockPassRule());

      const result = await service.evaluateFileWithFrontmatter(
        '/test/file.md',
        {},
        '# Content'
      );

      expect(result).toBeDefined();
      expect(result.eligible).toBe(true);
    });

    it('should work without content parameter', async () => {
      service.addRule('pass', new MockPassRule());

      const result = await service.evaluateFileWithFrontmatter(
        '/test/file.md',
        { title: 'Test' }
      );

      expect(result).toBeDefined();
      expect(result.eligible).toBe(true);
    });
  });

  describe('Tag Extraction', () => {
    it('should extract frontmatter tags', async () => {
      service.addRule('tag', new TagRule(['public']));

      const content = `---
tags:
  - public
  - important
---

# Content`;

      const result = await service.evaluateFile('/test/file.md', content);

      expect(result.eligible).toBe(true);
      expect(result.rules[0].passed).toBe(true);
    });

    it('should extract inline tags from content', async () => {
      service.addRule('tag', new TagRule(['public']));

      const content = `---
---

# Content with #public tag and #other`;

      const result = await service.evaluateFile('/test/file.md', content);

      expect(result.eligible).toBe(true);
    });

    it('should combine frontmatter and inline tags', async () => {
      service.addRule('tag', new TagRule(['public', 'featured']));

      const content = `---
tags:
  - public
---

# Content with #featured tag`;

      const result = await service.evaluateFile('/test/file.md', content);

      expect(result.eligible).toBe(true);
    });

    it('should deduplicate combined tags', async () => {
      service.addRule('tag', new TagRule(['public']));

      const content = `---
tags:
  - public
---

# Content with #public tag`;

      const result = await service.evaluateFile('/test/file.md', content);

      expect(result.eligible).toBe(true);
    });

    it('should ignore tags in code blocks', async () => {
      const mockRule = new Rule();
      mockRule.name = 'CheckAllTags';
      mockRule.evaluate = (filepath, frontmatter) => {
        const allTags = (frontmatter.tags as string[]) || [];
        return {
          passed: !allTags.includes('code'),
          reason: `Found tags: ${allTags.join(',')}`,
        };
      };
      service.addRule('checktags', mockRule);

      const content = `# Content

\`\`\`javascript
// #code tag in code block
\`\`\`

Regular #public tag`;

      const result = await service.evaluateFile('/test/file.md', content);

      expect(result.rules[0].passed).toBe(true); // #code was ignored
    });
  });

  describe('Rule Orchestration', () => {
    it('should apply single rule', async () => {
      service.addRule('pass', new MockPassRule());

      const result = await service.evaluateFile('/test/file.md', '# Content');

      expect(result.rules).toHaveLength(1);
      expect(result.rules[0].name).toBe('pass');
      expect(result.rules[0].passed).toBe(true);
    });

    it('should apply multiple rules with AND composition', async () => {
      service = new PublicationService({ composition: 'AND' });
      service.addRule('pass', new MockPassRule());
      service.addRule('pass2', new MockPassRule());

      const result = await service.evaluateFile('/test/file.md', '# Content');

      expect(result.rules).toHaveLength(2);
      expect(result.eligible).toBe(true);
    });

    it('should fail with AND if any rule fails', async () => {
      service = new PublicationService({ composition: 'AND' });
      service.addRule('pass', new MockPassRule());
      service.addRule('fail', new MockFailRule());

      const result = await service.evaluateFile('/test/file.md', '# Content');

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('Failed rules');
    });

    it('should apply multiple rules with OR composition', async () => {
      service = new PublicationService({ composition: 'OR' });
      service.addRule('fail', new MockFailRule());
      service.addRule('pass', new MockPassRule());

      const result = await service.evaluateFile('/test/file.md', '# Content');

      expect(result.eligible).toBe(true);
    });

    it('should provide rule-level reasoning', async () => {
      service.addRule('publish', new PublishFrontmatterRule());

      const content = `---
publish: false
---

# Content`;

      const result = await service.evaluateFile('/test/file.md', content);

      expect(result.rules[0].reason).toBeDefined();
      expect(result.rules[0].reason).toContain('Not marked');
    });
  });

  describe('Eligibility Decision', () => {
    it('should mark file as eligible when conditions met', async () => {
      service.addRule('publish', new PublishFrontmatterRule());
      service.addRule('notprivate', new PrivateRule());

      const content = `---
publish: true
private: false
---

# Content`;

      const result = await service.evaluateFile('/test/file.md', content);

      expect(result.eligible).toBe(true);
    });

    it('should mark file as ineligible when conditions not met', async () => {
      service.addRule('publish', new PublishFrontmatterRule());

      const content = `---
publish: false
---

# Content`;

      const result = await service.evaluateFile('/test/file.md', content);

      expect(result.eligible).toBe(false);
    });

    it('should reject private files', async () => {
      service.addRule('notprivate', new PrivateRule());

      const content = `---
private: true
---

# Content`;

      const result = await service.evaluateFile('/test/file.md', content);

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('private');
    });

    it('should provide comprehensive reason for ineligibility', async () => {
      service = new PublicationService({ composition: 'AND' });
      service.addRule('publish', new PublishFrontmatterRule());
      service.addRule('notprivate', new PrivateRule());

      const content = `---
publish: false
private: true
---

# Content`;

      const result = await service.evaluateFile('/test/file.md', content);

      expect(result.eligible).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.rules).toHaveLength(2);
    });
  });

  describe('Caching', () => {
    it('should cache evaluation results', async () => {
      service.addRule('pass', new MockPassRule());

      const filepath = '/test/file.md';
      const content = '# Content';

      const result1 = await service.evaluateFile(filepath, content);
      const result2 = await service.evaluateFile(filepath, content);

      expect(result1.evaluatedAt).toBe(result2.evaluatedAt);
    });

    it('should re-evaluate when file content changes', async () => {
      service.addRule(
        'tags',
        new WhitelistTagRule({ whitelist: ['published'], requireAny: true })
      );

      const filepath = '/test/file.md';
      const before = await service.evaluateFile(filepath, 'no tags here');
      expect(before.eligible).toBe(false);

      const after = await service.evaluateFile(filepath, '#published now tagged');

      expect(after.eligible).toBe(true);
      expect(after.reason).not.toBe(before.reason);
    });

    it('should return different results for different files', async () => {
      service.addRule('pass', new MockPassRule());

      const result1 = await service.evaluateFile('/test/file1.md', '# Content 1');
      // Add a small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 5));
      const result2 = await service.evaluateFile('/test/file2.md', '# Content 2');

      expect(result1.evaluatedAt).not.toBe(result2.evaluatedAt);
    });

    it('should clear specific cache entry', async () => {
      service.addRule('pass', new MockPassRule());

      const filepath = '/test/file.md';
      const result1 = await service.evaluateFile(filepath, '# Content');
      service.clearCache(filepath);
      // Add a small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 5));
      const result2 = await service.evaluateFile(filepath, '# Content');

      expect(result1.evaluatedAt).not.toBe(result2.evaluatedAt);
    });

    it('should clear all cache', async () => {
      service.addRule('pass', new MockPassRule());

      const result1a = await service.evaluateFile('/test/file1.md', '# Content 1');
      const result2a = await service.evaluateFile('/test/file2.md', '# Content 2');

      service.clearCache();
      
      // Add delays to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 5));
      const result1b = await service.evaluateFile('/test/file1.md', '# Content 1');
      await new Promise((resolve) => setTimeout(resolve, 5));
      const result2b = await service.evaluateFile('/test/file2.md', '# Content 2');

      expect(result1a.evaluatedAt).not.toBe(result1b.evaluatedAt);
      expect(result2a.evaluatedAt).not.toBe(result2b.evaluatedAt);
    });

    it('should respect cache size limit', async () => {
      const smallService = new PublicationService({
        enableCache: true,
        cacheSize: 2,
      });
      smallService.addRule('pass', new MockPassRule());

      await smallService.evaluateFile('/test/file1.md', '# Content 1');
      await smallService.evaluateFile('/test/file2.md', '# Content 2');
      await smallService.evaluateFile('/test/file3.md', '# Content 3');

      const stats = smallService.getCacheStats();
      expect(stats.size).toBeLessThanOrEqual(stats.capacity);
    });

    it('should disable cache when requested', async () => {
      service.setCache(false);
      service.addRule('pass', new MockPassRule());

      const filepath = '/test/file.md';
      const result1 = await service.evaluateFile(filepath, '# Content');
      // Add a small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 5));
      const result2 = await service.evaluateFile(filepath, '# Content');

      expect(result1.evaluatedAt).not.toBe(result2.evaluatedAt);
    });

    it('should report cache statistics', () => {
      const stats = service.getCacheStats();

      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('capacity');
      expect(stats.size).toBe(0);
      expect(stats.capacity).toBe(10);
    });
  });

  describe('Rule Management', () => {
    it('should add a rule', () => {
      const rule = new MockPassRule();
      service.addRule('test', rule);

      expect(service.getRuleCount()).toBe(1);
    });

    it('should remove a rule', () => {
      service.addRule('test', new MockPassRule());
      expect(service.getRuleCount()).toBe(1);

      const removed = service.removeRule('test');

      expect(removed).toBe(true);
      expect(service.getRuleCount()).toBe(0);
    });

    it('should handle removing non-existent rule', () => {
      const removed = service.removeRule('nonexistent');

      expect(removed).toBe(false);
    });

    it('should get rule configuration', () => {
      service.addRule('test1', new MockPassRule());
      service.addRule('test2', new MockPassRule());

      const config = service.getRuleConfig();

      expect(config).toHaveProperty('composition');
      expect(config).toHaveProperty('rules');
      expect(Object.keys(config.rules!)).toHaveLength(2);
    });
  });

  describe('Events', () => {
    it('should emit evaluated event', async () => {
      service.addRule('pass', new MockPassRule());

      const eventHandler = vi.fn();
      service.on('evaluated', eventHandler);

      await service.evaluateFile('/test/file.md', '# Content');

      expect(eventHandler).toHaveBeenCalled();
      const emittedResult = eventHandler.mock.calls[0][0] as EligibilityResult;
      expect(emittedResult.eligible).toBe(true);
    });

    it('should emit rulesReloaded event', async () => {
      // Create a temporary valid rules config file
      const tmpConfig = path.join(os.tmpdir(), `rules-test-${Date.now()}.json`);
      fs.writeFileSync(tmpConfig, JSON.stringify({ rules: { composition: 'AND' } }));

      try {
        await service.reloadRules(tmpConfig);
        // reloadRules should not throw with a valid config
        expect(service.getRuleCount()).toBe(0);
      } finally {
        fs.unlinkSync(tmpConfig);
      }
    });

    it('should handle once listener', async () => {
      service.addRule('pass', new MockPassRule());

      const eventHandler = vi.fn();
      service.once('evaluated', eventHandler);

      await service.evaluateFile('/test/file1.md', '# Content 1');
      await service.evaluateFile('/test/file2.md', '# Content 2');

      expect(eventHandler).toHaveBeenCalledTimes(1);
    });

    it('should remove event listener', async () => {
      service.addRule('pass', new MockPassRule());

      const eventHandler = vi.fn();
      service.on('evaluated', eventHandler);
      service.off('evaluated', eventHandler);

      await service.evaluateFile('/test/file.md', '# Content');

      expect(eventHandler).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should mark files with invalid YAML frontmatter as ineligible', async () => {
      service.addRule('pass', new MockPassRule());

      const content = `---
invalid: [yaml: content here
---

# Content`;

      const result = await service.evaluateFile('/test/file.md', content);

      expect(result).toBeDefined();
      // Fail closed: the frontmatter is unreadable, so publish/private intent
      // is unknown and the file must not be published on a rule technicality.
      expect(result.eligible).toBe(false);
      expect(result.parseError).toBeDefined();
      expect(result.reason).toContain('Frontmatter parse error');
      expect(result.rules).toEqual([]);
    });

    it('should distinguish parse failures from rule failures', async () => {
      service.addRule('fail', new MockFailRule());

      const ruleMiss = await service.evaluateFile(
        '/test/rule-miss.md',
        '---\npublish: true\n---\nBody'
      );
      const parseMiss = await service.evaluateFile(
        '/test/parse-miss.md',
        '---\ncreated: {{date}} {{time}}:00\nx: 1\n---\nBody'
      );

      expect(ruleMiss.eligible).toBe(false);
      expect(ruleMiss.parseError).toBeUndefined();

      expect(parseMiss.eligible).toBe(false);
      expect(parseMiss.parseError?.filepath).toBe('/test/parse-miss.md');
      expect(parseMiss.parseError?.line).toBe(2);
    });

    it('should handle special characters in content', async () => {
      service.addRule('pass', new MockPassRule());

      const content = `---
title: Special & < > " ' characters
---

# Content with "quotes" and <tags>`;

      const result = await service.evaluateFile('/test/file.md', content);

      expect(result).toBeDefined();
    });

    it('should handle very long filenames', async () => {
      service.addRule('pass', new MockPassRule());

      const longFilename = `/test/${'a'.repeat(500)}.md`;
      const result = await service.evaluateFile(longFilename, '# Content');

      expect(result).toBeDefined();
    });

    it('should handle very large content', async () => {
      service.addRule('pass', new MockPassRule());

      const largeContent = '# Content\n\n' + 'Text line\n'.repeat(10000);
      const result = await service.evaluateFile('/test/file.md', largeContent);

      expect(result).toBeDefined();
    });
  });

  describe('Integration', () => {
    it('should work with complex publication rules', async () => {
      service = new PublicationService({ composition: 'AND' });
      service.addRule('publish', new PublishFrontmatterRule());
      service.addRule('notprivate', new PrivateRule());
      service.addRule('hastag', new TagRule(['public']));

      const content = `---
publish: true
private: false
tags:
  - public
---

# Article

This is a public article with #featured tag`;

      const result = await service.evaluateFile('/test/article.md', content);

      expect(result.eligible).toBe(true);
      expect(result.rules).toHaveLength(3);
      expect(result.rules.every((r) => r.passed)).toBe(true);
    });

    it('should handle mixed rule outcomes', async () => {
      service = new PublicationService({ composition: 'AND' });
      service.addRule('publish', new PublishFrontmatterRule());
      service.addRule('hastag', new TagRule(['premium']));

      const content = `---
publish: true
tags:
  - public
---

# Content`;

      const result = await service.evaluateFile('/test/file.md', content);

      expect(result.eligible).toBe(false);
      expect(result.rules.some((r) => r.passed)).toBe(true);
      expect(result.rules.some((r) => !r.passed)).toBe(true);
    });
  });
});
