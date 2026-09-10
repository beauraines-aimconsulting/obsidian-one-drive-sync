import { describe, it, expect } from 'vitest';
import { renderTrace } from '../../src/cli/renderTrace.js';
import type { EligibilityResult } from '../../src/publications/types.js';

function result(overrides: Partial<EligibilityResult> = {}): EligibilityResult {
  return {
    eligible: true,
    reason: 'All rules passed (AND)',
    rules: [],
    evaluatedAt: 0,
    ...overrides,
  };
}

describe('renderTrace', () => {
  it('prints the file and an eligible decision', () => {
    const output = renderTrace(result(), { filepath: 'Notes/a.md' });

    expect(output).toContain('📄 Notes/a.md');
    expect(output).toContain('Decision: ✅ ELIGIBLE');
  });

  it('prints an ineligible decision', () => {
    const output = renderTrace(result({ eligible: false, reason: 'nope' }), {
      filepath: 'Notes/a.md',
    });

    expect(output).toContain('Decision: ⛔ INELIGIBLE');
  });

  it('falls back to the summary reason when no rules ran', () => {
    const output = renderTrace(result({ reason: 'No rules configured' }), {
      filepath: 'a.md',
    });

    expect(output).toContain('No rules configured');
  });

  it('renders leaf rules with their reason and type annotation', () => {
    const output = renderTrace(
      result({
        rules: [{ name: 'workPaths', passed: true, reason: 'matched include "MSFT/**"' }],
      }),
      { filepath: 'a.md', ruleTypes: { workPaths: 'path' } }
    );

    expect(output).toContain('✅ workPaths (path) — matched include "MSFT/**"');
  });

  it('omits the annotation for names with no known type', () => {
    const output = renderTrace(
      result({ rules: [{ name: 'anonymous', passed: true, reason: 'ok' }] }),
      { filepath: 'a.md' }
    );

    expect(output).toContain('✅ anonymous — ok');
    expect(output).not.toContain('(undefined)');
  });

  it('renders nested children with connecting elbows', () => {
    const output = renderTrace(
      result({
        rules: [
          {
            name: 'all',
            passed: true,
            reason: 'summary that should not be repeated',
            children: [
              { name: 'first', passed: true, reason: 'ok' },
              { name: 'second', passed: false, reason: 'no' },
            ],
          },
        ],
      }),
      { filepath: 'a.md' }
    );

    const lines = output.split('\n');
    expect(lines).toContain('   ✅ all');
    expect(lines).toContain('   ├─ ✅ first — ok');
    expect(lines).toContain('   └─ ⛔ second — no');
  });

  it('does not repeat a group reason that its children already explain', () => {
    const output = renderTrace(
      result({
        rules: [
          {
            name: 'group',
            passed: false,
            reason: 'summary that should not be repeated',
            children: [{ name: 'child', passed: false, reason: 'no' }],
          },
        ],
      }),
      { filepath: 'a.md' }
    );

    expect(output).not.toContain('summary that should not be repeated');
  });

  it('keeps alignment at depth, padding under a non-final parent', () => {
    const output = renderTrace(
      result({
        rules: [
          {
            name: 'root',
            passed: true,
            reason: '',
            children: [
              {
                name: 'branch',
                passed: true,
                reason: '',
                children: [{ name: 'deep', passed: true, reason: 'ok' }],
              },
              { name: 'sibling', passed: true, reason: 'ok' },
            ],
          },
        ],
      }),
      { filepath: 'a.md' }
    );

    const lines = output.split('\n');
    // `branch` is not the last child, so its own children hang off a `│`.
    expect(lines).toContain('   ├─ ✅ branch');
    expect(lines).toContain('   │  └─ ✅ deep — ok');
    expect(lines).toContain('   └─ ✅ sibling — ok');
  });

  it('renders a negated node', () => {
    const output = renderTrace(
      result({
        rules: [
          {
            name: 'not(isDraft)',
            passed: true,
            reason: 'NOT(status is draft)',
            children: [{ name: 'isDraft', passed: false, reason: 'status is not draft' }],
          },
        ],
      }),
      { filepath: 'a.md' }
    );

    expect(output).toContain('✅ not(isDraft)');
    expect(output).toContain('└─ ⛔ isDraft — status is not draft');
  });

  it('reports a parse error instead of an empty trace', () => {
    const output = renderTrace(
      result({
        eligible: false,
        reason: 'Frontmatter parse error at line 3, column 1: bad indentation',
        parseError: { reason: 'bad indentation', line: 3, column: 1 },
      }),
      { filepath: 'a.md' }
    );

    expect(output).toContain('Decision: ⚠️ ERROR');
    expect(output).toContain('Frontmatter parse error at line 3, column 1: bad indentation');
    expect(output).not.toContain('ELIGIBLE');
  });

  it('summarises where each tag was written', () => {
    const output = renderTrace(
      result({
        tagSources: { frontmatter: ['project'], inline: ['msft'], task: ['waiting'] },
      }),
      { filepath: 'a.md' }
    );

    expect(output).toContain('Tags: frontmatter [project] · inline [msft] · task [waiting]');
  });

  it('reports "none" when a file carries no tags at all', () => {
    const output = renderTrace(result({ tagSources: { frontmatter: [], inline: [], task: [] } }), {
      filepath: 'a.md',
    });

    expect(output).toContain('Tags: none');
  });

  it('omits the tag line when provenance is unavailable', () => {
    const output = renderTrace(result(), { filepath: 'a.md' });

    expect(output).not.toContain('Tags:');
  });
});
