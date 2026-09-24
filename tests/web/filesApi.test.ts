import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { PublicationService } from '../../src/publications/PublicationService.js';
import { WebServer } from '../../src/web/WebServer.js';

const workspaceRoot = path.resolve(process.cwd(), 'tests/workspace');

function createWorkspace(name: string): string {
  const dir = path.join(workspaceRoot, `${name}-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(root: string, relativePath: string, content: string): void {
  const absolutePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
}

function createSavedRulesDocument() {
  return {
    rulesVersion: 2,
    rules: {
      definitions: {
        publishTag: {
          type: 'tag',
          allowList: ['publish'],
          requireAny: true,
          source: 'all',
        },
        publishableArea: {
          type: 'path',
          include: ['Eligible/**'],
        },
      },
      match: {
        all: [{ rule: 'publishTag' }, { any: [{ rule: 'publishableArea' }] }],
      },
    },
  };
}

function createCandidateRulesDocument() {
  return {
    rulesVersion: 2,
    rules: {
      definitions: {
        publishTag: {
          type: 'tag',
          allowList: ['publish'],
          requireAny: true,
          source: 'all',
        },
        publishableArea: {
          type: 'path',
          include: ['Drafts/**'],
        },
      },
      match: {
        all: [{ rule: 'publishTag' }, { any: [{ rule: 'publishableArea' }] }],
      },
    },
  };
}

describe('files and rules test APIs', () => {
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

  async function startServer(options: { extraFiles?: Array<{ path: string; content: string }> } = {}) {
    const workspace = createWorkspace('files-api');
    directories.push(workspace);

    const vaultPath = path.join(workspace, 'vault');
    fs.mkdirSync(vaultPath, { recursive: true });
    writeFile(
      vaultPath,
      'Eligible/keep.md',
      '---\ntags:\n  - publish\n---\n\n# Keep\n\nBody with #inline-tag'
    );
    writeFile(vaultPath, 'Eligible/missing-tag.md', '# No publish tag');
    writeFile(
      vaultPath,
      'Drafts/candidate.md',
      '---\ntags:\n  - publish\n---\n\n- [ ] Task #waiting\n'
    );
    writeFile(vaultPath, 'Broken/bad.md', '---\ncreated: {{date}} {{time}}:00\nx: 1\n---\nBody');
    writeFile(vaultPath, 'Ignored/skip.md', '# ignored');
    for (const file of options.extraFiles ?? []) {
      writeFile(vaultPath, file.path, file.content);
    }

    const outsidePath = path.join(workspace, 'outside');
    fs.mkdirSync(outsidePath, { recursive: true });
    writeFile(outsidePath, 'secret.md', '# secret');
    fs.symlinkSync(outsidePath, path.join(vaultPath, 'linked'));

    const rulesConfigPath = path.join(workspace, 'rules.json');
    fs.writeFileSync(rulesConfigPath, `${JSON.stringify(createSavedRulesDocument(), null, 2)}\n`);

    const publicationService = new PublicationService({
      vaultPath,
      logLevel: 'warn',
    });
    await publicationService.reloadRules(rulesConfigPath);

    const server = new WebServer({
      port: 0,
      bindAddress: '127.0.0.1',
      readOnly: false,
      vaultPath,
      rulesConfigPath,
      ignorePatterns: ['Ignored/**'],
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
      publicationService,
      server,
      vaultPath,
    };
  }

  it('evaluates a note against saved rules with nested trace and tag sources', async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/rules/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({ filepath: 'Eligible/keep.md' }),
    });
    const payload = (await response.json()) as {
      eligible: boolean;
      tagSources: { frontmatter: string[]; inline: string[]; task: string[] };
      rules: Array<{ name: string; children?: Array<{ name: string; passed: boolean }> }>;
    };

    expect(response.status).toBe(200);
    expect(payload.eligible).toBe(true);
    expect(payload.tagSources).toEqual({
      frontmatter: ['publish'],
      inline: ['inline-tag'],
      task: [],
    });
    expect(payload.rules[0].name).toBe('match');
    expect(payload.rules[0].children).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'publishTag', passed: true })])
    );
    expect(payload.rules[0].children?.[1]).toEqual(
      expect.objectContaining({
        name: 'any',
        passed: true,
        children: [expect.objectContaining({ name: 'publishableArea', passed: true })],
      })
    );
  });

  it('evaluates a note selected through a vault symlink', async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/rules/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({ filepath: 'linked/secret.md' }),
    });
    const payload = (await response.json()) as { eligible: boolean };

    expect(response.status).toBe(200);
    expect(payload.eligible).toBe(false);
  });

  it('evaluates a note against candidate rules without mutating the live engine', async () => {
    const { baseUrl, publicationService } = await startServer();
    const beforeRuleCount = publicationService.getRuleCount();

    const liveBefore = await fetch(`${baseUrl}/api/rules/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({ filepath: 'Drafts/candidate.md' }),
    });
    const liveBeforePayload = (await liveBefore.json()) as { eligible: boolean };

    const candidateResponse = await fetch(`${baseUrl}/api/rules/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({
        filepath: 'Drafts/candidate.md',
        rules: createCandidateRulesDocument(),
      }),
    });
    const candidatePayload = (await candidateResponse.json()) as { eligible: boolean };

    const liveAfter = await fetch(`${baseUrl}/api/rules/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({ filepath: 'Drafts/candidate.md' }),
    });
    const liveAfterPayload = (await liveAfter.json()) as { eligible: boolean };

    expect(liveBeforePayload.eligible).toBe(false);
    expect(candidatePayload.eligible).toBe(true);
    expect(candidateResponse.status).toBe(200);
    expect(publicationService.getRuleCount()).toBe(beforeRuleCount);
    expect(liveAfterPayload.eligible).toBe(false);
  });

  it('returns field validation errors for an invalid candidate rules document', async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/rules/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl,
      },
      body: JSON.stringify({
        filepath: 'Eligible/keep.md',
        rules: {
          rulesVersion: 2,
          rules: {
            definitions: {
              broken: {
                type: 'path',
                include: [''],
              },
            },
            match: { rule: 'broken' },
          },
        },
      }),
    });
    const payload = (await response.json()) as {
      error: string;
      errors: Array<{ path: string; message: string }>;
    };

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Rules validation failed');
    expect(payload.errors).toContainEqual({
      path: 'rules.definitions.broken.include[0]',
      message: 'Pattern must not be empty',
    });
  });

  it('supports pagination defaults and caps the limit at 500', async () => {
    const extraFiles = Array.from({ length: 520 }, (_, index) => ({
      path: `Many/file-${String(index).padStart(3, '0')}.md`,
      content: '# file',
    }));
    const { baseUrl } = await startServer({ extraFiles });

    const [defaultResponse, cappedResponse] = await Promise.all([
      fetch(`${baseUrl}/api/files`),
      fetch(`${baseUrl}/api/files?limit=999`),
    ]);

    const defaultPayload = (await defaultResponse.json()) as {
      items: unknown[];
      limit: number;
      total: number;
      hasMore: boolean;
    };
    const cappedPayload = (await cappedResponse.json()) as {
      items: unknown[];
      limit: number;
      total: number;
      hasMore: boolean;
    };

    expect(defaultResponse.status).toBe(200);
    expect(defaultPayload.limit).toBe(100);
    expect(defaultPayload.items).toHaveLength(100);
    expect(defaultPayload.total).toBeGreaterThan(500);
    expect(defaultPayload.hasMore).toBe(true);

    expect(cappedResponse.status).toBe(200);
    expect(cappedPayload.limit).toBe(500);
    expect(cappedPayload.items).toHaveLength(500);
    expect(cappedPayload.hasMore).toBe(true);
  });

  it('filters the file list by search query and eligibility status', async () => {
    const { baseUrl } = await startServer();

    const [queryResponse, eligibleResponse, parseErrorResponse] = await Promise.all([
      fetch(`${baseUrl}/api/files?q=keep`),
      fetch(`${baseUrl}/api/files?eligible=eligible`),
      fetch(`${baseUrl}/api/files?eligible=parse-error`),
    ]);

    const queryPayload = (await queryResponse.json()) as { items: Array<{ filepath: string }> };
    const eligiblePayload = (await eligibleResponse.json()) as {
      items: Array<{ filepath: string; status: string }>;
    };
    const parseErrorPayload = (await parseErrorResponse.json()) as {
      items: Array<{ filepath: string; status: string }>;
    };

    expect(queryResponse.status).toBe(200);
    expect(queryPayload.items.map((item) => item.filepath)).toEqual(['Eligible/keep.md']);

    expect(eligibleResponse.status).toBe(200);
    expect(eligiblePayload.items).toEqual([
      expect.objectContaining({ filepath: 'Eligible/keep.md', status: 'eligible' }),
    ]);

    expect(parseErrorResponse.status).toBe(200);
    expect(parseErrorPayload.items).toEqual([
      expect.objectContaining({ filepath: 'Broken/bad.md', status: 'parse-error' }),
    ]);
  });

  it('returns raw note content through vault symlinks and rejects traversal attempts', async () => {
    const { baseUrl } = await startServer();

    const [previewResponse, symlinkResponse, traversalResponse, absoluteResponse] =
      await Promise.all([
        fetch(`${baseUrl}/api/files/Eligible/keep.md`),
        fetch(`${baseUrl}/api/files/linked/secret.md`),
        fetch(`${baseUrl}/api/files/..%2F..%2Fetc%2Fpasswd`),
        fetch(`${baseUrl}/api/files/%2Fetc%2Fpasswd`),
      ]);

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.headers.get('content-type')).toContain('text/plain');
    expect(await previewResponse.text()).toContain('# Keep');

    expect(symlinkResponse.status).toBe(200);
    expect(await symlinkResponse.text()).toContain('# secret');

    expect(traversalResponse.status).toBe(400);
    await expect(traversalResponse.json()).resolves.toEqual({ error: 'Path escapes the vault root' });

    expect(absoluteResponse.status).toBe(400);
    await expect(absoluteResponse.json()).resolves.toEqual({ error: 'Path must be relative to the vault' });
  });

  it('includes local sync statuses and filters by sync status', async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/files?syncStatus=never-synced`);
    const payload = (await response.json()) as {
      items: Array<{ filepath: string; syncStatus: string }>;
      syncStatus: string;
    };

    expect(response.status).toBe(200);
    expect(payload.syncStatus).toBe('never-synced');
    expect(payload.items).toEqual([
      expect.objectContaining({
        filepath: 'Eligible/keep.md',
        syncStatus: 'never-synced',
      }),
    ]);

    const invalidResponse = await fetch(`${baseUrl}/api/files?syncStatus=unknown`);
    expect(invalidResponse.status).toBe(400);
  });

  it('returns 404 for a missing preview file', async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/files/Notes/missing.md`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'File not found' });
  });

  it('reports parse-error files distinctly in file listings', async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/api/files?q=Broken`);
    const payload = (await response.json()) as {
      items: Array<{ filepath: string; status: string; eligible: boolean; reason: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.items).toEqual([
      expect.objectContaining({
        filepath: 'Broken/bad.md',
        status: 'parse-error',
        eligible: false,
      }),
    ]);
    expect(payload.items[0].reason).toContain('Frontmatter parse error');
  });
});
