import * as fs from 'fs/promises';
import { RuleLoader } from '../../rules/RuleLoader.js';
import { validateRulesConfig } from '../../rules/validateRulesConfig.js';
import { resolveVaultPath, sendApiJson } from '../security.js';
import type { RouteHandler } from '../types.js';

interface RulesTestRequestBody {
  rules?: unknown;
  filepath?: string;
  content?: string;
}

const DEFAULT_EVALUATION_FILEPATH = 'Pasted.md';

export const postRulesTest: RouteHandler = async (_request, response, context) => {
  const body = context.body;
  if (!isRulesTestRequestBody(body)) {
    sendApiJson(response, 400, {
      error: 'Request body must be an object with optional rules, filepath, and content fields',
    });
    return;
  }

  const evaluationPath = normalizeEvaluationPath(body.filepath);
  if (!evaluationPath && typeof body.content !== 'string') {
    sendApiJson(response, 400, {
      error: 'Either filepath or content must be provided',
    });
    return;
  }

  try {
    const filepath = evaluationPath ?? DEFAULT_EVALUATION_FILEPATH;
    const content =
      typeof body.content === 'string'
        ? body.content
        : await readVaultFile(context.options.vaultPath, evaluationPath!);

    if (body.rules !== undefined) {
      const validation = validateRulesConfig(body.rules);
      if (!validation.valid) {
        sendApiJson(response, 400, {
          error: 'Rules validation failed',
          errors: validation.errors,
        });
        return;
      }

      const engine = new RuleLoader('warn').loadFromObject(
        validation.config,
        context.options.vaultPath
      );
      const result = await context.options.publicationService.evaluateFileWithRuleEngine(
        filepath,
        content,
        engine
      );
      sendApiJson(response, 200, result);
      return;
    }

    const result = await context.options.publicationService.evaluateFile(filepath, content);
    sendApiJson(response, 200, result);
  } catch (error) {
    const code = (error as Error & { code?: string }).code;
    if (code === 'ENOENT') {
      sendApiJson(response, 404, { error: 'File not found' });
      return;
    }

    if (
      error instanceof Error &&
      (error.message.includes('Path escapes') || error.message.includes('Path must be relative'))
    ) {
      sendApiJson(response, 400, { error: error.message });
      return;
    }

    throw error;
  }
};

function isRulesTestRequestBody(value: unknown): value is RulesTestRequestBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeEvaluationPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

async function readVaultFile(vaultPath: string, relativePath: string): Promise<string> {
  const absolutePath = resolveVaultPath(vaultPath, relativePath);
  return fs.readFile(absolutePath, 'utf-8');
}
