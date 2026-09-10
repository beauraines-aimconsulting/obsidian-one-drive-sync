/**
 * Minimal line diff for CLI previews.
 *
 * Only used to show a user what a migration would change before they commit to
 * it, so a compact LCS is plenty and avoids a dependency.
 */
export function diffLines(before: string, after: string): string[] {
  const a = before.split('\n');
  const b = after.split('\n');

  // lengths[i][j] = length of the longest common subsequence of a[i..] and b[j..]
  const lengths: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] =
        a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const output: string[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      output.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      output.push(`- ${a[i]}`);
      i++;
    } else {
      output.push(`+ ${b[j]}`);
      j++;
    }
  }

  while (i < a.length) output.push(`- ${a[i++]}`);
  while (j < b.length) output.push(`+ ${b[j++]}`);

  return output;
}
