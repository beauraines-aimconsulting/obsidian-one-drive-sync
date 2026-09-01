/**
 * Shared vault walker. Recursively collects markdown files while honoring
 * the configured ignore patterns, so batch scans (dry-run, sync) filter files
 * the same way the watcher does.
 */

import * as fs from 'fs';
import * as path from 'path';
import { FileFilter } from './FileFilter.js';

export interface WalkOptions {
  ignorePatterns?: string[];
}

/**
 * Recursively find markdown files under `vaultPath`, skipping ignored paths.
 * Returns absolute paths.
 */
export function walkMarkdown(vaultPath: string, options?: WalkOptions): string[] {
  const filter = new FileFilter({
    patterns: options?.ignorePatterns ?? [],
    extensions: ['.md'],
  });

  const files: string[] = [];

  const walk = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(vaultPath, full);

      if (entry.isDirectory()) {
        if (filter.isIgnored(relative)) continue;
        walk(full);
      } else if (entry.isFile()) {
        if (filter.filter(relative).allowed) files.push(full);
      }
    }
  };

  walk(vaultPath);
  return files;
}
