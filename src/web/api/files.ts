import * as fs from 'fs/promises';
import * as path from 'path';
import type { EligibilityResult } from '../../publications/types.js';
import { walkMarkdown } from '../../vault/walkMarkdown.js';
import { resolveContainedPath, sendApiJson } from '../security.js';
import type { RouteHandler } from '../types.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const SORT_VALUES = new Set(['path-asc', 'path-desc']);
const ELIGIBILITY_VALUES = new Set(['eligible', 'ineligible', 'parse-error', 'true', 'false']);

type FileStatus = 'eligible' | 'ineligible' | 'parse-error';

interface FileListItem {
  filepath: string;
  status: FileStatus;
  eligible: boolean;
  reason: string;
}

export const getFiles: RouteHandler = async (_request, response, context) => {
  const limitValue = context.requestUrl.searchParams.get('limit');
  const offsetValue = context.requestUrl.searchParams.get('offset');
  const sortValue = context.requestUrl.searchParams.get('sort') ?? 'path-asc';
  const query = context.requestUrl.searchParams.get('q')?.trim().toLowerCase() ?? '';
  const eligibilityFilter = normalizeEligibilityFilter(
    context.requestUrl.searchParams.get('eligible')
  );

  const limit = parseInteger(limitValue, DEFAULT_LIMIT, 'limit');
  const offset = parseInteger(offsetValue, 0, 'offset');
  if (limit === null || offset === null) {
    sendApiJson(response, 400, { error: 'limit and offset must be non-negative integers' });
    return;
  }

  if (!SORT_VALUES.has(sortValue)) {
    sendApiJson(response, 400, { error: 'sort must be one of: path-asc, path-desc' });
    return;
  }

  if (context.requestUrl.searchParams.has('eligible') && eligibilityFilter === null) {
    sendApiJson(response, 400, {
      error: 'eligible must be one of: eligible, ineligible, parse-error, true, false',
    });
    return;
  }

  const cappedLimit = Math.min(limit, MAX_LIMIT);
  const allFiles = walkMarkdown(context.options.vaultPath, {
    ignorePatterns: context.options.ignorePatterns,
  })
    .map((absolutePath) => path.relative(context.options.vaultPath, absolutePath).replace(/\\/g, '/'))
    .filter((filepath) => (query.length > 0 ? filepath.toLowerCase().includes(query) : true))
    .sort((left, right) => left.localeCompare(right));

  if (sortValue === 'path-desc') {
    allFiles.reverse();
  }

  let items: FileListItem[];
  let total: number;

  if (eligibilityFilter) {
    const evaluated = await Promise.all(
      allFiles.map((filepath) => evaluateListItem(context.options.vaultPath, filepath, context))
    );
    const filtered = evaluated.filter((item) => item.status === eligibilityFilter);
    total = filtered.length;
    items = filtered.slice(offset, offset + cappedLimit);
  } else {
    total = allFiles.length;
    const pagePaths = allFiles.slice(offset, offset + cappedLimit);
    items = await Promise.all(
      pagePaths.map((filepath) => evaluateListItem(context.options.vaultPath, filepath, context))
    );
  }

  sendApiJson(response, 200, {
    items,
    total,
    limit: cappedLimit,
    offset,
    sort: sortValue,
    q: query,
    eligible: eligibilityFilter,
    hasMore: offset + items.length < total,
  });
};

export const getFileContent: RouteHandler = async (_request, response, context) => {
  const relativePath = context.params.filepath?.trim();
  if (!relativePath) {
    sendApiJson(response, 400, { error: 'File path is required' });
    return;
  }

  try {
    const absolutePath = resolveContainedPath(context.options.vaultPath, relativePath);
    const stats = await fs.stat(absolutePath);
    if (!stats.isFile()) {
      sendApiJson(response, 404, { error: 'File not found' });
      return;
    }

    const content = await fs.readFile(absolutePath, 'utf-8');
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(content);
  } catch (error) {
    const nodeError = error as Error & { code?: string };
    if (nodeError.code === 'ENOENT') {
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

async function evaluateListItem(
  vaultPath: string,
  filepath: string,
  context: Parameters<RouteHandler>[2]
): Promise<FileListItem> {
  const content = await fs.readFile(path.join(vaultPath, filepath), 'utf-8');
  const result = await context.options.publicationService.evaluateFile(filepath, content);
  return toFileListItem(filepath, result);
}

function toFileListItem(filepath: string, result: EligibilityResult): FileListItem {
  if (result.parseError) {
    return {
      filepath,
      status: 'parse-error',
      eligible: false,
      reason: result.reason,
    };
  }

  return {
    filepath,
    status: result.eligible ? 'eligible' : 'ineligible',
    eligible: result.eligible,
    reason: result.reason,
  };
}

function parseInteger(value: string | null, fallback: number, field: string): number | null {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return null;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return null;
  }

  if (field === 'limit' && parsed === 0) {
    return 0;
  }

  return parsed;
}

function normalizeEligibilityFilter(value: string | null): FileStatus | undefined | null {
  if (value === null || value.trim() === '') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!ELIGIBILITY_VALUES.has(normalized)) return null;
  if (normalized === 'true') return 'eligible';
  if (normalized === 'false') return 'ineligible';
  return normalized as FileStatus;
}
