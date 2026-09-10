/**
 * Parse a human-readable duration such as `30d`, `12h`, `90m`, or `45s`.
 *
 * Shared by the rules engine (`modifiedWithin`) and the scheduler, so the two
 * never drift on what `1h` means.
 */

const UNIT_MILLISECONDS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

// Fractional amounts are deliberately rejected rather than rounded: `1.5h` is
// better written `90m`, and refusing it now leaves room to give multi-unit
// strings like `1h30m` a meaning later without changing what anything already
// in a config file means.
const DURATION_PATTERN = /^(\d+)\s*(ms|s|m|h|d|w)$/i;

/** Units accepted by {@link parseDuration}, for error messages and docs. */
export const DURATION_UNITS = Object.keys(UNIT_MILLISECONDS);

/**
 * Convert a duration string to milliseconds.
 *
 * @throws if the value is not a recognised duration. Callers parsing user
 * config should catch this and report it as a config error.
 */
export function parseDuration(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim());

  if (!match) {
    throw new Error(
      `Invalid duration "${value}". Expected a number followed by one of: ${DURATION_UNITS.join(', ')} (for example "30d")`
    );
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (amount === 0) {
    throw new Error(`Invalid duration "${value}". Duration must be greater than zero`);
  }

  return amount * UNIT_MILLISECONDS[unit];
}

/** Whether a string is a valid duration, for validation without exceptions. */
export function isValidDuration(value: string): boolean {
  try {
    parseDuration(value);
    return true;
  } catch {
    return false;
  }
}

const FORMAT_UNITS: Array<[string, number]> = [
  ['w', UNIT_MILLISECONDS.w],
  ['d', UNIT_MILLISECONDS.d],
  ['h', UNIT_MILLISECONDS.h],
  ['m', UNIT_MILLISECONDS.m],
  ['s', UNIT_MILLISECONDS.s],
  ['ms', UNIT_MILLISECONDS.ms],
];

/**
 * Render milliseconds for log output, e.g. `1h 15m`.
 *
 * At most the two largest non-zero units are shown: `1h 15m 3s 250ms` is noise
 * in a log line, and the first two components already convey the magnitude.
 * Negative and non-finite inputs render as `0ms` rather than something
 * nonsensical, since this is only ever used for display.
 */
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '0ms';

  const parts: string[] = [];
  let remaining = Math.round(milliseconds);

  for (const [suffix, size] of FORMAT_UNITS) {
    const amount = Math.floor(remaining / size);
    if (amount === 0) continue;

    parts.push(`${amount}${suffix}`);
    remaining -= amount * size;

    if (parts.length === 2 || remaining === 0) break;
  }

  return parts.join(' ');
}
