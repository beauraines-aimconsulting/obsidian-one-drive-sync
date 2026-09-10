import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { explainFile } from '../../src/cli/explain.js';

let vaultPath: string;
let rulesPath: string;

const RULES = {
  rulesVersion: 2,
  rules: {
    definitions: {
      shared: { type: 'tag', allowList: ['share'], requireAny: true },
      notPrivate: { type: 'privacy', allowPrivate: false },
    },
    match: { all: [{ rule: 'notPrivate' }, { rule: 'shared' }] },
  },
};

function write(relative: string, contents: string): void {
  const target = path.join(vaultPath, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

beforeEach(() => {
  vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-'));
  rulesPath = path.join(vaultPath, 'rules.json');
  fs.writeFileSync(rulesPath, JSON.stringify(RULES));
});

afterEach(() => {
  fs.rmSync(vaultPath, { recursive: true, force: true });
});

describe('explainFile', () => {
  it('exits 0 and explains an eligible file', async () => {
    write('Notes/a.md', '---\ntags: [share]\n---\nbody\n');

    const result = await explainFile('Notes/a.md', { vaultPath, rulesPath });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('ELIGIBLE');
    expect(result.output).toContain('Notes/a.md');
  });

  it('exits 1 for a file the rules reject', async () => {
    write('Notes/b.md', '---\ntags: [other]\n---\nbody\n');

    const result = await explainFile('Notes/b.md', { vaultPath, rulesPath });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('INELIGIBLE');
    expect(result.output).toContain('shared (tag)');
  });

  it('exits 2 when the file does not exist', async () => {
    const result = await explainFile('Notes/missing.md', { vaultPath, rulesPath });

    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('File not found');
  });

  it('exits 2 when the path escapes the vault', async () => {
    const result = await explainFile('../outside.md', { vaultPath, rulesPath });

    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('outside the vault');
  });

  it('exits 2 when the rules config is missing', async () => {
    write('Notes/a.md', 'body');

    const result = await explainFile('Notes/a.md', {
      vaultPath,
      rulesPath: path.join(vaultPath, 'nope.json'),
    });

    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('Rules config not found');
  });

  it('exits 2 with the validation detail when the rules config is invalid', async () => {
    fs.writeFileSync(
      rulesPath,
      JSON.stringify({ rulesVersion: 2, rules: { definitions: { bad: { type: 'nope' } } } })
    );
    write('Notes/a.md', 'body');

    const result = await explainFile('Notes/a.md', { vaultPath, rulesPath });

    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('nope');
  });

  it('exits 2 and reports the cause when frontmatter cannot be parsed', async () => {
    write('Notes/bad.md', '---\nstatus: [unclosed\n---\nbody\n');

    const result = await explainFile('Notes/bad.md', { vaultPath, rulesPath });

    expect(result.exitCode).toBe(2);
    expect(result.output).toContain('ERROR');
    expect(result.output).toContain('Frontmatter parse error');
  });

  it('accepts an absolute path inside the vault', async () => {
    write('Notes/a.md', '---\ntags: [share]\n---\nbody\n');

    const result = await explainFile(path.join(vaultPath, 'Notes/a.md'), { vaultPath, rulesPath });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Notes/a.md');
  });

  it('emits the raw result as JSON, keeping the nested trace', async () => {
    write('Notes/b.md', '---\ntags: [other]\n---\nbody\n');

    // A nested group, so the JSON is proven to carry the whole trace rather
    // than only the top level.
    fs.writeFileSync(
      rulesPath,
      JSON.stringify({
        rulesVersion: 2,
        rules: {
          definitions: {
            shared: { type: 'tag', allowList: ['share'], requireAny: true },
            notPrivate: { type: 'privacy', allowPrivate: false },
            group: { any: [{ rule: 'shared' }, { rule: 'notPrivate' }] },
          },
          match: { all: [{ rule: 'group' }] },
        },
      })
    );

    const result = await explainFile('Notes/b.md', { vaultPath, rulesPath, json: true });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output) as {
      eligible: boolean;
      rules: { name: string; children?: { name: string }[] }[];
      tagSources: { frontmatter: string[] };
    };
    expect(parsed.eligible).toBe(true);
    expect(parsed.rules[0]?.name).toBe('group');
    expect(parsed.rules[0]?.children).toHaveLength(2);
    expect(parsed.tagSources.frontmatter).toEqual(['other']);
  });

  it('reports the tag-source breakdown in the tree', async () => {
    write('Notes/c.md', '---\ntags: [share]\n---\nbody #inline\n\n- [ ] todo #waiting\n');

    const result = await explainFile('Notes/c.md', { vaultPath, rulesPath });

    expect(result.output).toContain('frontmatter [share]');
    expect(result.output).toContain('inline [inline]');
    expect(result.output).toContain('task [waiting]');
  });

  it('evaluates with no rules configured', async () => {
    write('Notes/a.md', 'body');

    const result = await explainFile('Notes/a.md', { vaultPath });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('No rules configured');
  });

  it('does not serve a stale cached decision', async () => {
    write('Notes/a.md', '---\ntags: [share]\n---\nbody\n');
    expect((await explainFile('Notes/a.md', { vaultPath, rulesPath })).exitCode).toBe(0);

    write('Notes/a.md', '---\ntags: [other]\n---\nbody\n');
    expect((await explainFile('Notes/a.md', { vaultPath, rulesPath })).exitCode).toBe(1);
  });
});
