import * as fs from 'fs';
import * as path from 'path';

/**
 * Write a file atomically.
 *
 * Config and state files are read at startup and by other processes, so a
 * partially written file is worse than no write at all: a truncated rules
 * config cannot be parsed on the next run. Writing to a sibling temp file and
 * renaming makes the replacement atomic on POSIX filesystems.
 */
export function writeFileAtomic(filepath: string, contents: string): void {
  const directory = path.dirname(filepath);
  fs.mkdirSync(directory, { recursive: true });

  const tempPath = path.join(directory, `.${path.basename(filepath)}.${process.pid}.tmp`);
  const handle = fs.openSync(tempPath, 'w');

  try {
    fs.writeFileSync(handle, contents, 'utf-8');
    // Flush to disk before the rename, so a crash cannot leave the renamed
    // file present but empty.
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }

  try {
    fs.renameSync(tempPath, filepath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Best effort: the rename failure is the error worth reporting.
    }
    throw error;
  }
}
