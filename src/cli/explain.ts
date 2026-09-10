import * as fs from 'fs';
import * as path from 'path';
import { PublicationService } from '../publications/PublicationService.js';
import type { EligibilityResult } from '../publications/types.js';
import { formatConfigErrors, validateRulesConfig } from '../rules/validateRulesConfig.js';
import { isRuleDefinition } from '../rules/configTypes.js';
import { renderTrace } from './renderTrace.js';

export interface ExplainOptions {
  /** Absolute path to the vault root. */
  vaultPath: string;
  /** Path to the rules config, when one is configured. */
  rulesPath?: string;
  /** Emit the raw result as JSON instead of the tree. */
  json?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export interface ExplainResult {
  exitCode: number;
  output: string;
}

/** Eligible. */
const EXIT_ELIGIBLE = 0;
/** Correctly evaluated, but the rules said no. */
const EXIT_INELIGIBLE = 1;
/** Could not evaluate: file missing, unreadable, or an invalid config. */
const EXIT_ERROR = 2;

/**
 * Evaluate a single file and describe the decision.
 *
 * Returns the text to print rather than printing it, so the exit codes and the
 * rendering can be tested without capturing stdout. The three exit codes make
 * the command usable from a script: `0` published, `1` not, `2` broken.
 */
export async function explainFile(target: string, options: ExplainOptions): Promise<ExplainResult> {
  const absolute = path.isAbsolute(target) ? target : path.resolve(options.vaultPath, target);
  const relative = path.relative(options.vaultPath, absolute);

  if (relative.startsWith('..')) {
    return {
      exitCode: EXIT_ERROR,
      output: `❌ ${target} is outside the vault (${options.vaultPath})`,
    };
  }

  if (!fs.existsSync(absolute)) {
    return { exitCode: EXIT_ERROR, output: `❌ File not found: ${absolute}` };
  }

  let content: string;
  try {
    content = fs.readFileSync(absolute, 'utf-8');
  } catch (error) {
    return {
      exitCode: EXIT_ERROR,
      output: `❌ Could not read ${absolute}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const service = new PublicationService({
    logLevel: options.logLevel ?? 'warn',
    vaultPath: options.vaultPath,
    // A one-shot inspection has nothing to reuse a cached decision for, and a
    // stale hit would be actively misleading here.
    enableCache: false,
  });

  let ruleTypes: Record<string, string> = {};
  if (options.rulesPath) {
    if (!fs.existsSync(options.rulesPath)) {
      return { exitCode: EXIT_ERROR, output: `❌ Rules config not found: ${options.rulesPath}` };
    }
    try {
      await service.reloadRules(options.rulesPath);
      ruleTypes = readRuleTypes(options.rulesPath);
    } catch (error) {
      return {
        exitCode: EXIT_ERROR,
        output: `❌ ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const result = await service.evaluateFile(relative, content);

  if (options.json) {
    return { exitCode: exitCodeFor(result), output: JSON.stringify(result, null, 2) };
  }

  return {
    exitCode: exitCodeFor(result),
    output: renderTrace(result, { filepath: relative, ruleTypes }),
  };
}

function exitCodeFor(result: EligibilityResult): number {
  if (result.parseError) return EXIT_ERROR;
  return result.eligible ? EXIT_ELIGIBLE : EXIT_INELIGIBLE;
}

/**
 * Build a definition-name → rule-type map for annotating the trace.
 *
 * The config is read a second time rather than threaded out of `RuleLoader`,
 * because this is presentation-only metadata and keeping it here leaves the
 * loader's interface untouched.
 */
function readRuleTypes(rulesPath: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
  } catch {
    return {};
  }

  const outcome = validateRulesConfig(parsed);
  if (!outcome.valid) {
    throw new Error(`Invalid rules config:\n${formatConfigErrors(outcome.errors)}`);
  }

  const types: Record<string, string> = {};
  for (const [name, value] of Object.entries(outcome.config.rules?.definitions ?? {})) {
    if (isRuleDefinition(value)) types[name] = value.type;
  }
  return types;
}
