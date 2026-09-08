/**
 * Shared glob matching for vault paths.
 *
 * `FileFilter` and `PathRule` previously carried their own regex-based glob
 * translations that had drifted apart, so the same pattern could mean two
 * different things depending on which one evaluated it. Both now go through
 * this module, which wraps picomatch so call sites never depend on it directly.
 */

import picomatch from 'picomatch';

export interface GlobOptions {
  /** Match without regard to case. Defaults to false. */
  caseInsensitive?: boolean;
  /**
   * Allow patterns to match dotfiles. Defaults to true, because vault paths
   * routinely include `.obsidian/`, `.trash/`, and `.DS_Store`.
   */
  dot?: boolean;
}

/** Tests a path against a compiled pattern. Input may use `\` or `/` separators. */
export type GlobMatcher = (value: string) => boolean;

const DEFAULT_OPTIONS: Required<GlobOptions> = {
  caseInsensitive: false,
  dot: true,
};

/**
 * picomatch compiles a pattern into a regex on every call, which is far too
 * expensive for rules that run against every file in a vault, so compiled
 * matchers are memoized by pattern and options.
 */
const matcherCache = new Map<string, picomatch.Matcher>();

/** Convert Windows separators so patterns only ever have to speak in `/`. */
export function normalizeGlobPath(value: string): string {
  return value.replace(/\\/g, '/');
}

/**
 * Rewrite POSIX-style negated character classes (`[!abc]`) to the regex form
 * (`[^abc]`).
 *
 * picomatch 4 passes `[!abc]` through verbatim, which JavaScript then reads as
 * a class *containing* `!`, so `note[!0-9].md` would match `note1.md` — the
 * exact opposite of the intended meaning. Escaped brackets are left alone.
 */
function normalizeNegatedClasses(pattern: string): string {
  let result = '';
  let escaped = false;
  let inClass = false;

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      result += char;
      escaped = true;
      continue;
    }

    if (char === '[' && !inClass) {
      inClass = true;
      result += char;
      if (pattern[i + 1] === '!') {
        result += '^';
        i++;
      }
      continue;
    }

    if (char === ']' && inClass) {
      inClass = false;
    }

    result += char;
  }

  return result;
}

function resolveOptions(options?: GlobOptions): Required<GlobOptions> {
  return {
    caseInsensitive: options?.caseInsensitive ?? DEFAULT_OPTIONS.caseInsensitive,
    dot: options?.dot ?? DEFAULT_OPTIONS.dot,
  };
}

function getMatcher(pattern: string, options: Required<GlobOptions>): picomatch.Matcher {
  const cacheKey = `${options.dot ? 'd' : ''}${options.caseInsensitive ? 'i' : ''}:${pattern}`;
  const cached = matcherCache.get(cacheKey);
  if (cached) return cached;

  const matcher = picomatch(normalizeNegatedClasses(pattern), {
    dot: options.dot,
    nocase: options.caseInsensitive,
  });
  matcherCache.set(cacheKey, matcher);
  return matcher;
}

/**
 * Compile a single glob pattern.
 *
 * Supported syntax: `*` (any run of characters except `/`), `**` (any
 * characters including `/`), `?` (one character except `/`), `[abc]` /
 * `[a-z]` / `[!abc]` character classes, and `{a,b}` alternation. A leading
 * globstar segment matches zero or more directories, so a pattern like
 * `<globstar>/*.bookmark.md` matches vault-root files as well as nested ones.
 */
export function compileGlob(pattern: string, options?: GlobOptions): GlobMatcher {
  const resolved = resolveOptions(options);
  const matcher = getMatcher(pattern, resolved);
  return (value: string) => matcher(normalizeGlobPath(value));
}

/**
 * Compile several patterns into one matcher that passes when any pattern
 * matches. An empty pattern list never matches.
 */
export function compileGlobs(patterns: string[], options?: GlobOptions): GlobMatcher {
  const resolved = resolveOptions(options);
  const matchers = patterns.map((pattern) => getMatcher(pattern, resolved));
  if (matchers.length === 0) return () => false;

  return (value: string) => {
    const normalized = normalizeGlobPath(value);
    return matchers.some((matcher) => matcher(normalized));
  };
}

/**
 * Report whether a pattern compiles. Used by rule-config validation so a
 * malformed pattern is a startup error naming the offending config path,
 * rather than a rule that silently never matches.
 */
export function isValidGlob(pattern: string): boolean {
  if (typeof pattern !== 'string' || pattern.trim().length === 0) return false;
  try {
    picomatch(normalizeNegatedClasses(pattern));
    return true;
  } catch {
    return false;
  }
}

/** Exposed for tests; clears memoized matchers. */
export function clearGlobCache(): void {
  matcherCache.clear();
}
