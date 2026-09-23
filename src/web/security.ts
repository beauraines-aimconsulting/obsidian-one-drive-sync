import * as fs from 'fs';
import * as path from 'path';
import { createHash, timingSafeEqual } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import type { ApiErrorBody } from './types.js';

export const MAX_REQUEST_BODY_BYTES = 256 * 1024;

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const API_RESPONSE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const;

export interface SecurityCheckOptions {
  pathname: string;
  requestUrl: URL;
  token?: string;
  readOnly: boolean;
}

export interface SecurityCheckResult {
  body?: unknown;
}

export function isMutatingMethod(method: string | undefined): boolean {
  return MUTATING_METHODS.has((method ?? 'GET').toUpperCase());
}

export function isLoopbackBindAddress(bindAddress: string): boolean {
  return bindAddress === '127.0.0.1' || bindAddress === '::1' || bindAddress === 'localhost';
}

export function setStaticSecurityHeaders(response: ServerResponse): void {
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'"
  );
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

export function sendApiJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  if (response.headersSent) return;
  response.writeHead(statusCode, API_RESPONSE_HEADERS);
  response.end(JSON.stringify(payload));
}

export function sendApiError(response: ServerResponse, statusCode: number, error: string): void {
  const payload: ApiErrorBody = { error };
  sendApiJson(response, statusCode, payload);
}

export function constantTimeTokenMatch(expectedToken: string, providedToken: string): boolean {
  const expectedHash = createHash('sha256').update(expectedToken, 'utf-8').digest();
  const providedHash = createHash('sha256').update(providedToken, 'utf-8').digest();
  return timingSafeEqual(expectedHash, providedHash);
}

function readBearerToken(request: IncomingMessage, requestUrl: URL): string | undefined {
  const header = request.headers.authorization;
  if (header) {
    const [scheme, value] = header.split(/\s+/, 2);
    if (scheme === 'Bearer' && value) {
      return value;
    }
  }

  return requestUrl.searchParams.get('token') ?? undefined;
}

function isAllowedOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;

  const host = request.headers.host;
  if (!host) return false;

  try {
    const parsedOrigin = new URL(origin);
    return (
      parsedOrigin.host === host &&
      (parsedOrigin.protocol === 'http:' || parsedOrigin.protocol === 'https:')
    );
  } catch {
    return false;
  }
}

async function readJsonBodyWithLimit(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const bufferChunk = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += bufferChunk.length;
    if (total > MAX_REQUEST_BODY_BYTES) {
      throw new Error('REQUEST_TOO_LARGE');
    }
    chunks.push(bufferChunk);
  }

  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as unknown;
}

export async function applyApiSecurity(
  request: IncomingMessage,
  response: ServerResponse,
  options: SecurityCheckOptions
): Promise<SecurityCheckResult | null> {
  const isApiRequest = options.pathname.startsWith('/api/');
  if (!isApiRequest) return {};

  response.setHeader('Cache-Control', 'no-store');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'"
  );
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  if (options.token) {
    const providedToken = readBearerToken(request, options.requestUrl);
    if (!providedToken || !constantTimeTokenMatch(options.token, providedToken)) {
      sendApiError(response, 401, 'Unauthorized');
      return null;
    }
  }

  if (!isMutatingMethod(request.method)) {
    return {};
  }

  if (options.readOnly) {
    sendApiError(response, 403, 'Web UI is running in read-only mode');
    return null;
  }

  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    sendApiError(response, 415, 'Mutating API requests must use Content-Type: application/json');
    return null;
  }

  const fetchSite = request.headers['sec-fetch-site']?.trim().toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site' && fetchSite !== 'none') {
    sendApiError(response, 403, 'Cross-site requests are not allowed');
    return null;
  }

  if (!isAllowedOrigin(request)) {
    sendApiError(response, 403, 'Cross-site requests are not allowed');
    return null;
  }

  try {
    return { body: await readJsonBodyWithLimit(request) };
  } catch (error) {
    if (error instanceof Error && error.message === 'REQUEST_TOO_LARGE') {
      sendApiError(response, 413, 'Request body exceeds 256 KiB');
      return null;
    }
    if (error instanceof SyntaxError) {
      sendApiError(response, 400, 'Request body must be valid JSON');
      return null;
    }
    throw error;
  }
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${path.sep}`);
}

export function resolveContainedPath(rootPath: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error('Path must be relative to the vault');
  }

  const realRootPath = fs.realpathSync(rootPath);
  const candidatePath = path.resolve(rootPath, relativePath);
  if (!isPathInside(realRootPath, candidatePath)) {
    throw new Error('Path escapes the vault root');
  }

  let realCandidatePath: string;
  try {
    realCandidatePath = fs.realpathSync(candidatePath);
  } catch (error) {
    const nodeError = error as Error & { code?: string };
    if (nodeError.code !== 'ENOENT') {
      throw error;
    }
    const realParentPath = fs.realpathSync(path.dirname(candidatePath));
    realCandidatePath = path.join(realParentPath, path.basename(candidatePath));
  }

  if (!isPathInside(realRootPath, realCandidatePath)) {
    throw new Error('Path escapes the vault root');
  }

  return realCandidatePath;
}
