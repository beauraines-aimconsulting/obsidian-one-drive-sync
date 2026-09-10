import type { EligibilityResult, RuleResult } from '../publications/types.js';

export interface RenderTraceOptions {
  /**
   * Vault-relative path of the file, printed as the heading.
   */
  filepath: string;
  /**
   * Maps a rule definition name to its `type`, so the tree can annotate
   * `workPaths` as `(path)`. Names not present — group nodes such as `all`, or
   * rules built in code — are rendered without an annotation.
   */
  ruleTypes?: Record<string, string>;
}

const PASS = '✅';
const FAIL = '⛔';
const WARN = '⚠️';

/**
 * Render an evaluation result as an indented pass/fail tree.
 *
 * Kept separate from the command that prints it so the formatting can be tested
 * without spawning a process, and so the web UI's rule tester can reuse it.
 */
export function renderTrace(result: EligibilityResult, options: RenderTraceOptions): string {
  const lines: string[] = [];
  lines.push(`📄 ${options.filepath}`);

  if (result.parseError) {
    lines.push(`   Decision: ${WARN} ERROR`);
    lines.push('');
    lines.push(`   ${result.reason}`);
    return lines.join('\n');
  }

  lines.push(`   Decision: ${result.eligible ? `${PASS} ELIGIBLE` : `${FAIL} INELIGIBLE`}`);
  lines.push('');

  if (result.rules.length === 0) {
    lines.push(`   ${result.reason}`);
  } else {
    for (const rule of result.rules) {
      lines.push(...renderNode(rule, '   ', true, options.ruleTypes ?? {}, true));
    }
  }

  const tagLine = renderTagSources(result);
  if (tagLine) {
    lines.push('');
    lines.push(`   ${tagLine}`);
  }

  return lines.join('\n');
}

/**
 * Render one node and its descendants.
 *
 * `prefix` is the indentation already emitted for this depth; `isLast` selects
 * the elbow used for this node and the padding used for its children, which is
 * what keeps the connecting lines aligned at arbitrary depth.
 */
function renderNode(
  node: RuleResult,
  prefix: string,
  isLast: boolean,
  ruleTypes: Record<string, string>,
  isRoot = false
): string[] {
  const icon = node.passed ? PASS : FAIL;
  const type = ruleTypes[node.name];
  const label = type ? `${node.name} (${type})` : node.name;
  const children = node.children ?? [];
  // A group's reason is a summary of its children, which are about to be
  // printed underneath it — repeating it here just buries the tree.
  const text = children.length > 0 ? label : `${label} — ${node.reason}`;
  const lines: string[] = [];

  // Top-level entries have no parent to connect to, so they are printed flush.
  if (isRoot) {
    lines.push(`${prefix}${icon} ${text}`);
  } else {
    lines.push(`${prefix}${isLast ? '└─' : '├─'} ${icon} ${text}`);
  }

  if (children.length === 0) return lines;

  const childPrefix = isRoot ? `${prefix}` : `${prefix}${isLast ? '   ' : '│  '}`;
  children.forEach((child, index) => {
    lines.push(...renderNode(child, childPrefix, index === children.length - 1, ruleTypes, false));
  });

  return lines;
}

/**
 * Summarise where each tag was written.
 *
 * `TagRule` now defaults to ignoring task-line tags, so "which bucket did that
 * tag land in?" is the first question an unexpected result raises.
 */
function renderTagSources(result: EligibilityResult): string | undefined {
  const sources = result.tagSources;
  if (!sources) return undefined;

  const total = sources.frontmatter.length + sources.inline.length + sources.task.length;
  if (total === 0) return 'Tags: none';

  return `Tags: ${[
    `frontmatter [${sources.frontmatter.join(', ')}]`,
    `inline [${sources.inline.join(', ')}]`,
    `task [${sources.task.join(', ')}]`,
  ].join(' · ')}`;
}
