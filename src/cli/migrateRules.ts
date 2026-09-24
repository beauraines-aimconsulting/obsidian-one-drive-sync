/**
 * `--migrate-rules`: rewrite a v1 rules document as `rulesVersion: 2`.
 *
 * The migration itself is a pure transform (`migrateRulesDocument`); everything
 * here is the safety around writing it back — preview the change, keep a
 * backup, and never replace the file non-atomically.
 */

import * as fs from 'fs';
import * as path from 'path';
import { migrateRulesDocument, needsMigration } from '../rules/migrateRulesConfig.js';
import { formatConfigErrors, validateRulesConfig } from '../rules/validateRulesConfig.js';
import type { RulesDocument } from '../rules/configTypes.js';
import { writeFileAtomic } from '../utils/atomicWrite.js';
import { diffLines } from './diff.js';

export interface MigrateOptions {
  /** Write the result. Without this the command only previews the change. */
  confirm: boolean;
  log?: (message: string) => void;
}

function migrationWriteFailure(configPath: string, error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : undefined;

  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return [
      `❌ Cannot write migrated config ${configPath}: ${code}.`,
      'The migration needs a writable config directory for the atomic temp file and .v1.bak backup.',
      'For Docker, mount the host config directory at /config:rw and ensure it is writable by the container user.',
    ].join(' ');
  }

  return `❌ Failed to write migrated config ${configPath}: ${
    error instanceof Error ? error.message : String(error)
  }`;
}

export function migrateRulesFile(configPath: string, options: MigrateOptions): number {
  const log = options.log ?? ((message: string) => console.log(message));

  if (!fs.existsSync(configPath)) {
    log(`❌ Config file not found: ${configPath}`);
    return 1;
  }

  const original = fs.readFileSync(configPath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(original);
  } catch (error) {
    log(
      `❌ Failed to parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`
    );
    return 1;
  }

  // Refuse to migrate something that is not valid to begin with: rewriting a
  // broken config would only make the breakage harder to spot.
  const outcome = validateRulesConfig(parsed);
  if (!outcome.valid) {
    log(`❌ Cannot migrate an invalid rules configuration:\n${formatConfigErrors(outcome.errors)}`);
    return 1;
  }

  if (!needsMigration(parsed as RulesDocument)) {
    log(`✅ ${configPath} is already rulesVersion 2 — nothing to do.`);
    return 0;
  }

  const migrated = migrateRulesDocument(parsed as RulesDocument);
  const updated = `${JSON.stringify(migrated, null, 2)}\n`;

  log(`📝 Migration preview for ${configPath}:\n`);
  for (const line of diffLines(original.trimEnd(), updated.trimEnd())) {
    log(`   ${line}`);
  }
  log('');

  if (!options.confirm) {
    log('No changes written. Re-run with --yes to apply.');
    return 0;
  }

  const backupPath = `${configPath}.v1.bak`;
  try {
    fs.accessSync(path.dirname(configPath), fs.constants.W_OK | fs.constants.X_OK);
    if (fs.existsSync(backupPath)) {
      fs.accessSync(backupPath, fs.constants.W_OK);
    }
    fs.copyFileSync(configPath, backupPath);
    writeFileAtomic(configPath, updated);
  } catch (error) {
    log(migrationWriteFailure(configPath, error));
    return 1;
  }

  log(`✅ Migrated ${configPath} to rulesVersion 2.`);
  log(`   Backup written to ${backupPath}`);
  return 0;
}
