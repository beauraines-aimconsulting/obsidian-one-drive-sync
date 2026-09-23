import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { RulesDocumentV2 } from '../../../src/rules/configTypes.js';

const supportDirectory = path.dirname(fileURLToPath(import.meta.url));
const e2eDirectory = path.resolve(supportDirectory, '..');
const repositoryRoot = path.resolve(e2eDirectory, '..', '..');

export const DEFAULT_SERVER_PORT = 4173;
export const DEFAULT_SERVER_ORIGIN = `http://127.0.0.1:${DEFAULT_SERVER_PORT}`;
export const RUNTIME_ROOT = path.join(e2eDirectory, '.runtime');
export const DEFAULT_WORKSPACE_ROOT = path.join(RUNTIME_ROOT, 'default');
export const DEFAULT_VAULT_PATH = path.join(DEFAULT_WORKSPACE_ROOT, 'vault');
export const DEFAULT_RULES_PATH = path.join(DEFAULT_WORKSPACE_ROOT, 'rules.json');

const MANY_FILE_COUNT = 102;

export function createSavedRulesDocument(): RulesDocumentV2 {
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

export function createCandidateRulesDocument(include = 'Drafts/**'): RulesDocumentV2 {
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
          include: [include],
        },
      },
      match: {
        all: [{ rule: 'publishTag' }, { any: [{ rule: 'publishableArea' }] }],
      },
    },
  };
}

export function workspaceRootFor(name: string): string {
  return path.join(RUNTIME_ROOT, name);
}

export async function recreateDirectory(directoryPath: string): Promise<void> {
  await fs.rm(directoryPath, { recursive: true, force: true });
  await fs.mkdir(directoryPath, { recursive: true });
}

export async function writeWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
  content: string
): Promise<void> {
  const absolutePath = path.join(workspaceRoot, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, 'utf-8');
}

export async function seedFixtureWorkspace(workspaceRoot: string): Promise<void> {
  await recreateDirectory(workspaceRoot);

  await writeWorkspaceFile(
    workspaceRoot,
    'vault/Eligible/keep.md',
    ['---', 'tags:', '  - publish', '---', '', '# Keep', '', 'Body for preview.', ''].join('\n')
  );
  await writeWorkspaceFile(
    workspaceRoot,
    'vault/Eligible/missing-tag.md',
    '# Missing publish tag\n\nThis note should stay ineligible.\n'
  );
  await writeWorkspaceFile(
    workspaceRoot,
    'vault/Drafts/candidate.md',
    ['---', 'tags:', '  - publish', '---', '', '# Candidate', '', 'Ready for pending-rule evaluation.', ''].join('\n')
  );
  await writeWorkspaceFile(
    workspaceRoot,
    'vault/Broken/bad.md',
    '---\ncreated: {{date}} {{time}}:00\nx: 1\n---\nBody\n'
  );

  for (let index = 0; index < MANY_FILE_COUNT; index += 1) {
    const fileName = `Many/file-${String(index).padStart(3, '0')}.md`;
    await writeWorkspaceFile(workspaceRoot, `vault/${fileName}`, `# File ${index}\n\nBody\n`);
  }

  await fs.writeFile(
    path.join(workspaceRoot, 'rules.json'),
    `${JSON.stringify(createSavedRulesDocument(), null, 2)}\n`,
    'utf-8'
  );
}

export async function resetDefaultServerState(baseUrl = DEFAULT_SERVER_ORIGIN): Promise<void> {
  await seedFixtureWorkspace(DEFAULT_WORKSPACE_ROOT);

  const getResponse = await fetch(`${baseUrl}/api/rules`);
  if (!getResponse.ok) {
    throw new Error(`Failed to load current rules (${getResponse.status}) while resetting fixtures`);
  }

  const { etag } = (await getResponse.json()) as { etag: string };
  const putResponse = await fetch(`${baseUrl}/api/rules`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'If-Match': etag,
      Origin: baseUrl,
    },
    body: JSON.stringify(createSavedRulesDocument()),
  });

  if (!putResponse.ok) {
    const body = await putResponse.text();
    throw new Error(`Failed to reset rules (${putResponse.status}): ${body}`);
  }
}

export async function removeRuntimeArtifacts(): Promise<void> {
  await fs.rm(RUNTIME_ROOT, { recursive: true, force: true });
}

export { repositoryRoot };
