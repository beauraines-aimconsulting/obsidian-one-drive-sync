import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from '../../src/config/ConfigManager.js';
import { PublicationService } from '../../src/publications/PublicationService.js';
import { FrontmatterRule } from '../../src/rules/implementations/FrontmatterRule.js';
import { CategoryRule } from '../../src/rules/implementations/CategoryRule.js';
import { PathRule } from '../../src/rules/implementations/PathRule.js';
import { PrivacyRule } from '../../src/rules/implementations/PrivacyRule.js';
import { Rule } from '../../src/rules/types.js';
import { VaultService } from '../../src/vault/VaultService.js';
import { VaultWatcher } from '../../src/vault/VaultWatcher.js';
import {
  cleanupTempDirs,
  createTempDir,
  restoreEnv,
  snapshotEnv,
  waitFor,
  writeFile,
} from './helpers.js';

const ENV_KEYS = [
  'VAULT_PATH',
  'OUTPUT_PATH',
  'RULES_CONFIG',
  'LOG_LEVEL',
  'DEBOUNCE_DELAY',
  'IGNORE_PATTERNS',
];

class InlineTagRule extends Rule {
  name = 'InlineTagRule';

  constructor(private readonly requiredTag: string) {
    super();
  }

  evaluate(
    _filepath: string,
    frontmatter: Record<string, unknown>
  ): { passed: boolean; reason: string } {
    const allTags = Array.isArray(frontmatter.tags)
      ? frontmatter.tags.filter((tag): tag is string => typeof tag === 'string')
      : [];

    if (allTags.includes(this.requiredTag)) {
      return {
        passed: true,
        reason: `Found tag ${this.requiredTag}`,
      };
    }

    return {
      passed: false,
      reason: `Missing tag ${this.requiredTag}`,
    };
  }
}

describe('integration workflows', { timeout: 15000 }, () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = snapshotEnv(ENV_KEYS);
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
    cleanupTempDirs();
  });

  it('loads config from a file and env overrides', async () => {
    const tempRoot = createTempDir('config');
    const vaultDir = path.join(tempRoot, 'vault');
    const outputDir = path.join(tempRoot, 'output');
    fs.mkdirSync(vaultDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });

    const configPath = path.join(tempRoot, 'rules.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          config: {
            vaultPath: vaultDir,
            outputPath: outputDir,
            debounceDelay: 75,
            logLevel: 'warn',
            ignorePatterns: ['archive/**', '.obsidian/**'],
          },
        },
        null,
        2
      )
    );

    process.env.RULES_CONFIG = configPath;
    process.env.LOG_LEVEL = 'debug';

    const config = await new ConfigManager().load();

    expect(config.vaultPath).toBe(vaultDir);
    expect(config.outputPath).toBe(outputDir);
    expect(config.debounceDelay).toBe(75);
    expect(config.logLevel).toBe('debug');
    expect(config.ignorePatterns).toEqual(['archive/**', '.obsidian/**']);
  });

  it('evaluates notes end-to-end with frontmatter, paths, and inline tags', async () => {
    const tempRoot = createTempDir('publication');
    const relativeNotePath = 'notes/release.md';
    const notePath = path.join(tempRoot, relativeNotePath);
    const content = `---
publish: true
category: knowledge
tags:
  - release
---
# Release note

This note references #copilot and [a link](#ignored-anchor).
`;

    writeFile(notePath, content);

    const publicationService = new PublicationService({
      enableCache: false,
      composition: 'AND',
      logLevel: 'error',
    });

    publicationService.addRule('frontmatter', new FrontmatterRule());
    publicationService.addRule('privacy', new PrivacyRule());
    publicationService.addRule(
      'category',
      new CategoryRule({ whitelist: ['knowledge'] })
    );
    publicationService.addRule(
      'path',
      new PathRule({ include: ['notes/**'] })
    );
    publicationService.addRule('inline-tag', new InlineTagRule('copilot'));

    const result = await publicationService.evaluateFile(
      relativeNotePath,
      content
    );

    expect(result.eligible).toBe(true);
    expect(result.rules.map((rule) => rule.name)).toEqual(
      expect.arrayContaining(['frontmatter', 'privacy', 'category', 'path', 'inline-tag'])
    );
    expect(
      result.rules.find((rule) => rule.name === 'inline-tag')?.passed
    ).toBe(true);
  });

  it('treats malformed YAML as unsafe and keeps the workflow running', async () => {
    const tempRoot = createTempDir('malformed');
    const relativeNotePath = 'notes/broken.md';
    const notePath = path.join(tempRoot, relativeNotePath);
    const malformedContent = `---
publish: true
tags:
  - release
bad: [unclosed
---
# Broken note
`;

    writeFile(notePath, malformedContent);

    const publicationService = new PublicationService({
      enableCache: false,
      composition: 'AND',
      logLevel: 'error',
    });

    publicationService.addRule('frontmatter', new FrontmatterRule());
    publicationService.addRule('path', new PathRule({ include: ['notes/**'] }));

    const result = await publicationService.evaluateFile(
      relativeNotePath,
      malformedContent
    );

    expect(result.eligible).toBe(false);
    expect(result.rules.find((rule) => rule.name === 'frontmatter')?.passed).toBe(
      false
    );
  });

  it('debounces real filesystem changes from the watcher', async () => {
    const vaultDir = createTempDir('watcher');
    const notePath = path.join(vaultDir, 'note.md');
    writeFile(notePath, '# note\n');

    const watcher = new VaultWatcher({ debounceDelay: 150 });
    const modifiedEvents: string[] = [];

    watcher.on('modify', (event) => {
      modifiedEvents.push(event.filepath);
    });

    await watcher.watch(vaultDir);

    try {
      writeFile(notePath, '# note\nfirst edit\n');
      writeFile(notePath, '# note\nsecond edit\n');
      writeFile(notePath, '# note\nthird edit\n');

      await waitFor(
        () => modifiedEvents.length >= 1,
        'debounced modify event'
      );

      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(modifiedEvents[0]).toContain('note.md');
      expect(modifiedEvents).toHaveLength(1);
      expect(watcher.getPendingDebounceCount()).toBe(0);
    } finally {
      await watcher.unwatch();
    }
  });

  it('monitors a temp vault, parses malformed notes, and handles add/delete cycles', async () => {
    const vaultDir = createTempDir('vault-service');

    writeFile(
      path.join(vaultDir, 'published.md'),
      `---
publish: true
---
# Published note
`
    );
    writeFile(
      path.join(vaultDir, 'broken.md'),
      `---
publish: true
bad: [unclosed
---
# Broken note
`
    );

    const service = new VaultService({
      vaultPath: vaultDir,
      debounceDelay: 150,
    });

    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    service.on('fileAdded', (metadata) => {
      added.push(metadata.filepath);
    });
    service.on('fileModified', (metadata) => {
      modified.push(metadata.filepath);
    });
    service.on('fileDeleted', (filepath) => {
      deleted.push(filepath);
    });

    await service.startMonitoring();

    try {
      const state = service.getVaultState();
      expect(state.fileCount).toBe(2);
      expect(state.published).toBe(1);
      expect(service.getFile('broken.md')?.published).toBe(false);

      const livePath = path.join(vaultDir, 'live.md');
      writeFile(
        livePath,
        `---
publish: true
---
# Live note
`
      );

      await waitFor(() => added.length >= 1, 'fileAdded event');
      expect(service.getFile('live.md')).toBeDefined();

      writeFile(
        livePath,
        `---
publish: true
---
# Live note
updated content
updated content
updated content
updated content
updated content
updated content
updated content
updated content
updated content
updated content
`
      );

      await waitFor(() => modified.length >= 1, 'fileModified event');

      fs.rmSync(livePath, { force: true });

      await waitFor(() => deleted.length >= 1, 'fileDeleted event');
      expect(service.getFile('live.md')).toBeUndefined();
    } finally {
      await service.stopMonitoring();
    }
  });
});
