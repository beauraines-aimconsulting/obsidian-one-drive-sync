import { describe, expect, it } from 'vitest';
import {
  AUTH_EXPIRED_MESSAGE,
  describeRunError,
  isAuthExpiryError,
} from '../../src/schedule/runErrors.js';

describe('runErrors', () => {
  const authFailures = [
    'invalid_grant: AADSTS700082: The refresh token has expired due to inactivity.',
    'InteractionRequiredAuthError: interaction_required',
    'AADSTS50173: The provided grant has expired due to it being revoked',
    'AADSTS50076: due to a configuration change made by your administrator',
    'ClientAuthError: no_account_in_silent_request',
    'no_tokens_found: no refresh token available',
  ];

  it.each(authFailures)('recognises %s as an auth expiry', (message) => {
    expect(isAuthExpiryError(new Error(message))).toBe(true);
  });

  it('does not mistake an unrelated failure for an auth expiry', () => {
    expect(isAuthExpiryError(new Error('ETIMEDOUT connecting to graph.microsoft.com'))).toBe(false);
    expect(isAuthExpiryError(new Error('429 Too Many Requests'))).toBe(false);
  });

  it('matches regardless of case', () => {
    expect(isAuthExpiryError(new Error('AADSTS70043 SESSION EXPIRED'))).toBe(true);
  });

  it('handles a non-Error rejection value', () => {
    expect(isAuthExpiryError('invalid_grant')).toBe(true);
    expect(describeRunError('something broke')).toBe('something broke');
  });

  it('adds actionable guidance to an auth expiry', () => {
    const described = describeRunError(new Error('invalid_grant: AADSTS700082'));

    expect(described).toContain(AUTH_EXPIRED_MESSAGE);
    expect(described).toContain('--probe');
    // The original text survives: the AADSTS code is what makes support quick.
    expect(described).toContain('AADSTS700082');
  });

  it('passes other errors through unchanged', () => {
    expect(describeRunError(new Error('ECONNRESET'))).toBe('ECONNRESET');
  });
});
