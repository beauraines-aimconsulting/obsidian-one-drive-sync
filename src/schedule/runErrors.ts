/**
 * Turns the errors a scheduled run can fail with into something a human can
 * act on.
 *
 * This matters more for a schedule than anywhere else in the app. A long-lived
 * scheduled container depends on the cached refresh token in `~/.obsidian-sync`
 * staying valid; once it lapses, *every* run fails identically until someone
 * signs in interactively. A raw MSAL dump in a log nobody is reading is how
 * that goes unnoticed for a week.
 */

/** MSAL/AAD signals that the cached token can no longer be renewed silently. */
const AUTH_EXPIRY_MARKERS = [
  'invalid_grant',
  'interaction_required',
  'InteractionRequiredAuthError',
  'AADSTS50173', // token revoked, credentials changed
  'AADSTS50076', // MFA required
  'AADSTS700082', // refresh token expired due to inactivity
  'AADSTS70043', // session expired
  'no_tokens_found',
  'no_account_in_silent_request',
];

export const AUTH_EXPIRED_MESSAGE =
  'Authentication expired — sign in again by running the app with --probe. ' +
  'Scheduled runs cannot complete a device-code sign-in on their own.';

/** True when the error means "a human has to sign in again". */
export function isAuthExpiryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const haystack = message.toLowerCase();
  return AUTH_EXPIRY_MARKERS.some((marker) => haystack.includes(marker.toLowerCase()));
}

/**
 * The message to record for a failed run.
 *
 * The original text is kept after the guidance rather than replaced: the
 * specific AADSTS code is what makes a support conversation short.
 */
export function describeRunError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return isAuthExpiryError(error) ? `${AUTH_EXPIRED_MESSAGE} (${message})` : message;
}
