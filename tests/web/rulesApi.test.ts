import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { WebServer } from '../../src/web/WebServer.js';
import type { PublicationService } from '../../src/publications/PublicationService.js';

const workspaceRoot = path.resolve(process.cwd(), 'tests/workspace');

function createWorkspace(name: string): string {
  const dir = path.join(workspaceRoot, `${name}-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createRulesDocument(label: string) {
  return {
    rulesVersion: 2,
    rules: {
      definitions: {
        publishableArea: {
          type: 'path',
          include: [`${label}/**/*.md`],
        },
      },
      match: {
        rule: 'publishableArea',
      },
    },
  };
}

function createV1RulesDocument() {
  return {
    rules: {
      composition: 'AND',
      pathRule: {
        include: ['Legacy/**/*.md'],
      },
    },
  };
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe('rules API', () => {
  const servers: Array<{ stop(): Promise<void> }> = [];
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.stop()));
    servers.length = 0;
    for (const directory of directories) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
    directories.length = 0;
  });

  async function startServer(options: {
    readOnly?: boolean;
    rulesDocument?: unknown;
    publicationService?: PublicationService;
  } = {}) {
    const workspace = createWorkspace('rules-api');
    directories.push(workspace);

    const vaultPath = path.join(workspace, 'vault');
    fs.mkdirSync(vaultPath, { recursive: true });

    const rulesConfigPath = path.join(workspace, 'rules.json');
    const startingRules = options.rulesDocument ?? createRulesDocument('Initial');
    fs.writeFileSync(rulesConfigPath, `${JSON.stringify(startingRules, null, 2)}\n`);

    const publicationService =
      options.publicationService ??
      ({
        async reloadRules() {
          return undefined;
        },
      } as PublicationService);

    const server = new WebServer({
      port: 0,
      bindAddress: '127.0.0.1',
      readOnly: options.readOnly ?? false,
      vaultPath,
      rulesConfigPath,
      ignorePatterns: [],
      publicationService,
      healthStatus: () => ({
        watcherActive: true,
        lastFileProcessedAt: '2026-09-01T18:00:00.000Z',
      }),
    });

    servers.push(server);
    await server.start();

    return {
      baseUrl: `http://127.0.0.1:${server.getPort()}`,
      rulesConfigPath,
      server,
    };
  }

  it('returns the rules document, etag, parsed rules, and migration flag', async () => {
    const { baseUrl } = await startServer({ rulesDocument: createV1RulesDocument() });

    const response = await fetch(`${baseUrl}/api/rules`);
    const payload = (await response.json()) as {
      etag: string;
      rawText: string;
      needsMigration: boolean;
      parsedDocument: { rulesVersion: 2 };
      parsedRules: { definitions: Record<string, unknown> };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe(payload.etag);
    expect(payload.rawText).toContain('Legacy/**/*.md');
    expect(payload.needsMigration).toBe(true);
    expect(payload.parsedDocument.rulesVersion).toBe(2);
    expect(payload.parsedRules.definitions).toHaveProperty('PathRule');
  });

  it('saves a valid rules document, writes atomically, and reloads rules', async () => {
    const reloadCalls: string[] = [];
    const publicationService = {
      async reloadRules(configPath?: string) {
        reloadCalls.push(configPath ?? '');
      },
    } as PublicationService;

    const { baseUrl, rulesConfigPath } = await startServer({ publicationService });

    const getResponse = await fetch(`${baseUrl}/api/rules`);
    const { etag } = (await getResponse.json()) as { etag: string };
    const updatedDocument = createRulesDocument('Updated');

    const putResponse = await fetch(`${baseUrl}/api/rules`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': etag,
        Origin: baseUrl,
      },
      body: JSON.stringify(updatedDocument),
    });
    const payload = (await putResponse.json()) as {
      etag: string;
      document: { rulesVersion: 2 };
      rawText: string;
    };

    expect(putResponse.status).toBe(200);
    expect(payload.document.rulesVersion).toBe(2);
    expect(payload.rawText).toContain('Updated/**/*.md');
    expect(reloadCalls).toEqual([rulesConfigPath]);
    expect(fs.readFileSync(rulesConfigPath, 'utf-8')).toBe(
      `${JSON.stringify(updatedDocument, null, 2)}\n`
    );
  });

  it('returns field-level validation errors and leaves the file byte-identical', async () => {
    const { baseUrl, rulesConfigPath } = await startServer();
    const beforeBytes = fs.readFileSync(rulesConfigPath);

    const getResponse = await fetch(`${baseUrl}/api/rules`);
    const { etag } = (await getResponse.json()) as { etag: string };
    const invalidDocument = {
      rulesVersion: 2,
      rules: {
        definitions: {
          badPath: {
            type: 'path',
            include: [''],
          },
        },
        match: {
          rule: 'badPath',
        },
      },
    };

    const putResponse = await fetch(`${baseUrl}/api/rules`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': etag,
        Origin: baseUrl,
      },
      body: JSON.stringify(invalidDocument),
    });
    const payload = (await putResponse.json()) as {
      errors: Array<{ path: string; message: string }>;
    };

    expect(putResponse.status).toBe(400);
    expect(payload.errors).toContainEqual({
      path: 'rules.definitions.badPath.include[0]',
      message: 'Pattern must not be empty',
    });
    expect(fs.readFileSync(rulesConfigPath)).toEqual(beforeBytes);
  });

  it('rejects stale etags with 409', async () => {
    const { baseUrl, rulesConfigPath } = await startServer();

    const getResponse = await fetch(`${baseUrl}/api/rules`);
    const { etag } = (await getResponse.json()) as { etag: string };
    fs.writeFileSync(rulesConfigPath, `${JSON.stringify(createRulesDocument('Other'), null, 2)}\n`);

    const putResponse = await fetch(`${baseUrl}/api/rules`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': etag,
        Origin: baseUrl,
      },
      body: JSON.stringify(createRulesDocument('Stale')),
    });
    const payload = (await putResponse.json()) as { error: string; etag: string };

    expect(putResponse.status).toBe(409);
    expect(payload.error).toContain('modified by another writer');
    expect(payload.etag).not.toBe(etag);
  });

  it('rejects PUT requests in read-only mode', async () => {
    const { baseUrl } = await startServer({ readOnly: true });

    const getResponse = await fetch(`${baseUrl}/api/rules`);
    const { etag } = (await getResponse.json()) as { etag: string };

    const putResponse = await fetch(`${baseUrl}/api/rules`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': etag,
        Origin: baseUrl,
      },
      body: JSON.stringify(createRulesDocument('ReadOnly')),
    });

    expect(putResponse.status).toBe(403);
    await expect(putResponse.json()).resolves.toEqual({
      error: 'Web UI is running in read-only mode',
    });
  });

  it('rolls back the file when reloadRules throws after a valid write', async () => {
    const publicationService = {
      async reloadRules() {
        throw new Error('Failed to parse rules config: simulated reload failure');
      },
    } as PublicationService;

    const { baseUrl, rulesConfigPath } = await startServer({ publicationService });
    const beforeBytes = fs.readFileSync(rulesConfigPath);
    const getResponse = await fetch(`${baseUrl}/api/rules`);
    const { etag } = (await getResponse.json()) as { etag: string };

    const putResponse = await fetch(`${baseUrl}/api/rules`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': etag,
        Origin: baseUrl,
      },
      body: JSON.stringify(createRulesDocument('BrokenReload')),
    });

    expect(putResponse.status).toBe(500);
    await expect(putResponse.json()).resolves.toEqual({
      error: 'Failed to parse rules config: simulated reload failure',
    });
    expect(fs.readFileSync(rulesConfigPath)).toEqual(beforeBytes);
  });

  it('serializes concurrent writes so one wins cleanly and the other conflicts', async () => {
    const firstReload = createDeferred();
    let reloadCalls = 0;
    const publicationService = {
      async reloadRules() {
        reloadCalls += 1;
        if (reloadCalls === 1) {
          await firstReload.promise;
        }
      },
    } as PublicationService;

    const { baseUrl, rulesConfigPath } = await startServer({ publicationService });
    const getResponse = await fetch(`${baseUrl}/api/rules`);
    const { etag } = (await getResponse.json()) as { etag: string };

    const firstRequest = fetch(`${baseUrl}/api/rules`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': etag,
        Origin: baseUrl,
      },
      body: JSON.stringify(createRulesDocument('First')),
    });
    const secondRequest = fetch(`${baseUrl}/api/rules`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': etag,
        Origin: baseUrl,
      },
      body: JSON.stringify(createRulesDocument('Second')),
    });

    await Promise.resolve();
    firstReload.resolve();

    const [firstResponse, secondResponse] = await Promise.all([firstRequest, secondRequest]);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(409);
    expect(fs.readFileSync(rulesConfigPath, 'utf-8')).toBe(
      `${JSON.stringify(createRulesDocument('First'), null, 2)}\n`
    );
  });

  it('validates candidate documents without writing to disk', async () => {
    const { baseUrl, rulesConfigPath } = await startServer();
    const beforeBytes = fs.readFileSync(rulesConfigPath);

    const response = await fetch(`${baseUrl}/api/rules/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify(createRulesDocument('Candidate')),
    });
    const payload = (await response.json()) as {
      valid: true;
      parsedDocument: { rulesVersion: 2 };
    };

    expect(response.status).toBe(200);
    expect(payload.valid).toBe(true);
    expect(payload.parsedDocument.rulesVersion).toBe(2);
    expect(fs.readFileSync(rulesConfigPath)).toEqual(beforeBytes);
  });
});
