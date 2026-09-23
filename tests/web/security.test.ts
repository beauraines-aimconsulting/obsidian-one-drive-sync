import * as fs from 'fs';
import * as path from 'path';
import { createServer, type Server } from 'http';
import { randomUUID } from 'crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveContainedPath } from '../../src/web/security.js';
import { serveStaticFile } from '../../src/web/staticFiles.js';

const workspaceRoot = path.resolve(process.cwd(), 'tests/workspace');

function createWorkspace(name: string): string {
  const dir = path.join(workspaceRoot, `${name}-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('web security helpers', () => {
  const directories: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          })
      )
    );
    servers.length = 0;
    for (const directory of directories) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
    directories.length = 0;
  });

  it('rejects traversal outside the vault', () => {
    const workspace = createWorkspace('path-traversal');
    directories.push(workspace);
    const vaultPath = path.join(workspace, 'vault');
    fs.mkdirSync(vaultPath, { recursive: true });

    expect(() => resolveContainedPath(vaultPath, '../../etc/passwd')).toThrow('Path escapes');
  });

  it('rejects absolute paths', () => {
    const workspace = createWorkspace('absolute-path');
    directories.push(workspace);
    const vaultPath = path.join(workspace, 'vault');
    fs.mkdirSync(vaultPath, { recursive: true });

    expect(() => resolveContainedPath(vaultPath, '/etc/passwd')).toThrow('Path must be relative');
  });

  it('rejects symlink escapes', () => {
    const workspace = createWorkspace('symlink-escape');
    directories.push(workspace);
    const vaultPath = path.join(workspace, 'vault');
    const outsidePath = path.join(workspace, 'outside');
    fs.mkdirSync(vaultPath, { recursive: true });
    fs.mkdirSync(outsidePath, { recursive: true });
    fs.writeFileSync(path.join(outsidePath, 'secret.md'), '# secret');
    fs.symlinkSync(outsidePath, path.join(vaultPath, 'linked'));

    expect(() => resolveContainedPath(vaultPath, 'linked/secret.md')).toThrow('Path escapes');
  });

  it('serves allowed static assets and rejects disallowed extensions', async () => {
    const workspace = createWorkspace('static-files');
    directories.push(workspace);
    const publicRoot = path.join(workspace, 'public');
    fs.mkdirSync(publicRoot, { recursive: true });
    fs.writeFileSync(path.join(publicRoot, 'index.html'), '<!doctype html><title>ok</title>');
    fs.writeFileSync(path.join(publicRoot, 'bundle.js'), 'console.log("ok");');
    fs.writeFileSync(path.join(publicRoot, 'secret.txt'), 'nope');

    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      void serveStaticFile(request, response, url.pathname, publicRoot).then((served) => {
        if (!served) {
          response.writeHead(404).end();
        }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Server address unavailable');
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const [htmlResponse, jsResponse, txtResponse] = await Promise.all([
      fetch(`${baseUrl}/`),
      fetch(`${baseUrl}/bundle.js`),
      fetch(`${baseUrl}/secret.txt`),
    ]);

    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-type')).toContain('text/html');
    expect(jsResponse.status).toBe(200);
    expect(jsResponse.headers.get('content-type')).toContain('text/javascript');
    expect(txtResponse.status).toBe(404);
  });
});
