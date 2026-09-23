import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import type { RulesDocumentV2 } from '../../rules/configTypes.js';
import {
  validateRulesConfig,
  type ConfigError,
  type ValidationOutcome,
} from '../../rules/validateRulesConfig.js';
import { sendApiJson } from '../security.js';
import type { RouteHandler } from '../types.js';

interface RulesValidationErrorBody {
  error: string;
  errors: ConfigError[];
  needsMigration?: boolean;
  warnings?: string[];
  migratedDocument?: RulesDocumentV2;
}

interface RulesReadResult {
  etag: string;
  rawText: string;
  document: unknown;
  validation: Extract<ValidationOutcome, { valid: true }>;
}

interface RulesWriteSuccess {
  kind: 'success';
  state: RulesReadResult;
}

interface RulesWriteConflict {
  kind: 'conflict';
  etag: string;
}

interface RulesWriteValidationFailure {
  kind: 'validation';
  body: RulesValidationErrorBody;
}

interface RulesWriteReloadFailure {
  kind: 'reload-failure';
  message: string;
}

const fileMutexes = new Map<string, Promise<void>>();

export const getRules: RouteHandler = async (_request, response, context) => {
  try {
    const state = await readRulesFile(context.options.rulesConfigPath);
    response.setHeader('ETag', state.etag);
    sendApiJson(response, 200, toRulesResponseBody(state));
  } catch (error) {
    sendApiJson(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const putRules: RouteHandler = async (request, response, context) => {
  const ifMatch = normalizeIfMatch(request.headers['if-match']);
  if (!ifMatch) {
    sendApiJson(response, 400, { error: 'If-Match header is required' });
    return;
  }

  try {
    const result = await withFileMutex(context.options.rulesConfigPath, async () => {
      const currentBuffer = await fs.readFile(context.options.rulesConfigPath);
      const currentEtag = computeEtag(currentBuffer);
      if (ifMatch !== currentEtag) {
        return { kind: 'conflict', etag: currentEtag } as RulesWriteConflict;
      }

      const validation = validateRulesConfig(context.body);
      if (!validation.valid) {
        return {
          kind: 'validation',
          body: {
            error: 'Rules validation failed',
            errors: validation.errors,
          },
        } as RulesWriteValidationFailure;
      }

      if (validation.version === 1) {
        return {
          kind: 'validation',
          body: {
            error: 'Rules must be migrated to rulesVersion 2 before saving',
            errors: [
              {
                path: 'rulesVersion',
                message: 'Rules must be migrated to rulesVersion 2 before saving',
              },
            ],
            needsMigration: true,
            warnings: validation.warnings,
            migratedDocument: validation.config,
          },
        } as RulesWriteValidationFailure;
      }

      const nextRawText = serializeRulesDocument(validation.config);
      const nextBuffer = Buffer.from(nextRawText, 'utf-8');
      const swap = await replaceFileAtomically(
        context.options.rulesConfigPath,
        currentBuffer,
        nextBuffer
      );

      try {
        await context.options.publicationService.reloadRules(context.options.rulesConfigPath);
      } catch (error) {
        await rollbackFileSwap(context.options.rulesConfigPath, swap.backupPath);
        return {
          kind: 'reload-failure',
          message: error instanceof Error ? error.message : String(error),
        } as RulesWriteReloadFailure;
      }

      await cleanupFile(swap.backupPath);
      const state = await readRulesFile(context.options.rulesConfigPath);
      return { kind: 'success', state } as RulesWriteSuccess;
    });

    if (result.kind === 'conflict') {
      response.setHeader('ETag', result.etag);
      sendApiJson(response, 409, {
        error: 'Rules file was modified by another writer',
        etag: result.etag,
      });
      return;
    }

    if (result.kind === 'validation') {
      sendApiJson(response, 400, result.body);
      return;
    }

    if (result.kind === 'reload-failure') {
      sendApiJson(response, 500, { error: result.message });
      return;
    }

    response.setHeader('ETag', result.state.etag);
    sendApiJson(response, 200, toRulesResponseBody(result.state));
  } catch (error) {
    sendApiJson(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const postValidateRules: RouteHandler = async (_request, response, context) => {
  const validation = validateRulesConfig(context.body);

  if (!validation.valid) {
    sendApiJson(response, 400, {
      error: 'Rules validation failed',
      errors: validation.errors,
    } satisfies RulesValidationErrorBody);
    return;
  }

  sendApiJson(response, 200, {
    valid: true,
    version: validation.version,
    needsMigration: validation.version === 1,
    warnings: validation.warnings,
    parsedDocument: validation.config,
    parsedRules: validation.config.rules ?? null,
  });
};

function toRulesResponseBody(state: RulesReadResult) {
  return {
    etag: state.etag,
    rawText: state.rawText,
    document: state.document,
    parsedDocument: state.validation.config,
    parsedRules: state.validation.config.rules ?? null,
    version: state.validation.version,
    needsMigration: state.validation.version === 1,
    warnings: state.validation.warnings,
  };
}

async function readRulesFile(filePath: string): Promise<RulesReadResult> {
  const rawBuffer = await fs.readFile(filePath);
  const rawText = rawBuffer.toString('utf-8');

  let document: unknown;
  try {
    document = JSON.parse(rawText) as unknown;
  } catch (error) {
    throw new Error(
      `Failed to parse rules config: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const validation = validateRulesConfig(document);
  if (!validation.valid) {
    const joinedErrors = validation.errors
      .map((entry) => (entry.path.length > 0 ? `${entry.path}: ${entry.message}` : entry.message))
      .join('; ');
    throw new Error(`Invalid rules configuration: ${joinedErrors}`);
  }

  return {
    etag: computeEtag(rawBuffer),
    rawText,
    document,
    validation,
  };
}

function serializeRulesDocument(document: RulesDocumentV2): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function computeEtag(content: Buffer): string {
  return createHash('sha1').update(content).digest('hex');
}

function normalizeIfMatch(headerValue: string | string[] | undefined): string | null {
  const rawValue = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!rawValue) return null;

  const trimmed = rawValue.trim();
  if (trimmed.length === 0 || trimmed === '*') return null;

  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

async function withFileMutex<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = fileMutexes.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.then(
    () => gate,
    () => gate
  );
  fileMutexes.set(key, next);

  await previous.catch(() => undefined);

  try {
    return await operation();
  } finally {
    release();
    if (fileMutexes.get(key) === next) {
      fileMutexes.delete(key);
    }
  }
}

async function writeAndSync(filePath: string, content: Buffer, mode: number): Promise<void> {
  const handle = await fs.open(filePath, 'w', mode);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(dirPath: string): Promise<void> {
  const handle = await fs.open(dirPath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function replaceFileAtomically(
  filePath: string,
  previousContent: Buffer,
  nextContent: Buffer
): Promise<{ backupPath: string }> {
  const directoryPath = path.dirname(filePath);
  const baseName = path.basename(filePath);
  const token = randomUUID();
  const tempPath = path.join(directoryPath, `.${baseName}.${token}.tmp`);
  const backupPath = path.join(directoryPath, `.${baseName}.${token}.bak`);
  const currentStat = await fs.stat(filePath);

  try {
    await writeAndSync(tempPath, nextContent, currentStat.mode);
    await writeAndSync(backupPath, previousContent, currentStat.mode);
    await fs.rename(tempPath, filePath);
    await syncDirectory(directoryPath);
    return { backupPath };
  } catch (error) {
    await Promise.allSettled([cleanupFile(tempPath), cleanupFile(backupPath)]);
    throw error;
  }
}

async function rollbackFileSwap(filePath: string, backupPath: string): Promise<void> {
  try {
    await fs.rename(backupPath, filePath);
    await syncDirectory(path.dirname(filePath));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to restore rules file after reload failure: ${message}`);
  }
}

async function cleanupFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    const code = (error as Error & { code?: string }).code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }
}
