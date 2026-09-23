import * as fs from 'fs';
import * as path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { resolveContainedPath, setStaticSecurityHeaders } from './security.js';

const ALLOWED_EXTENSIONS = new Set(['.html', '.js', '.css', '.json', '.svg', '.png', '.ico']);
const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export function resolvePublicRoot(cwd = process.cwd()): string {
  const distRoot = path.resolve(cwd, 'dist/web/public');
  if (fs.existsSync(distRoot)) return distRoot;
  return path.resolve(cwd, 'src/web/public');
}

export async function serveStaticFile(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  publicRoot = resolvePublicRoot()
): Promise<boolean> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }

  const requestedPath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const extension = path.extname(requestedPath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return false;
  }

  let filePath: string;
  try {
    filePath = resolveContainedPath(publicRoot, requestedPath);
  } catch {
    response.writeHead(404).end();
    return true;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404).end();
    return true;
  }

  setStaticSecurityHeaders(response);
  response.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
  });

  if (request.method === 'HEAD') {
    response.end();
    return true;
  }

  response.end(fs.readFileSync(filePath));
  return true;
}
