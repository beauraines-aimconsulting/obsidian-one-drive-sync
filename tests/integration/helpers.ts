import * as fs from 'fs';
import * as path from 'path';

const tempDirs: string[] = [];

export function createTempDir(prefix: string): string {
  const dir = path.join(
    process.cwd(),
    `test-integration-${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  fs.mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

export function writeFile(filepath: string, content: string): void {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, content);
}

export async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs = 5000,
  intervalMs = 25
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for ${label}`);
}

export function snapshotEnv(keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

export function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

export function cleanupTempDirs(): void {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}
