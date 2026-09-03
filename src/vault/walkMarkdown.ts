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
  const visitedDirs = new Set<string>();

  // Symlinked entries need a stat of the target to know what they are; vaults
  // commonly link folders in from outside the vault root.
  const resolveType = (full: string, entry: fs.Dirent): 'dir' | 'file' | 'other' => {
    if (entry.isDirectory()) return 'dir';
    if (entry.isFile()) return 'file';
    if (!entry.isSymbolicLink()) return 'other';
    try {
      const stats = fs.statSync(full);
      if (stats.isDirectory()) return 'dir';
      if (stats.isFile()) return 'file';
    } catch {
      // Dangling symlink — skip it
    }
    return 'other';
  };

  const walk = (dir: string): void => {
    let realDir: string;
    try {
      realDir = fs.realpathSync(dir);
    } catch {
      return;
    }
    // Guard against symlink loops
    if (visitedDirs.has(realDir)) return;
    visitedDirs.add(realDir);

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(vaultPath, full);
      const type = resolveType(full, entry);

      if (type === 'dir') {
        if (filter.isIgnored(relative)) continue;
        walk(full);
      } else if (type === 'file') {
        if (filter.filter(relative).allowed) files.push(full);
      }
    }
  };

  walk(vaultPath);
  return files;
}
