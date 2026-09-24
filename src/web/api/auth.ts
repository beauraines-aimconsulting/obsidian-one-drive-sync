import { DeviceCodeFlowConflictError } from '../../graph/GraphAuthProvider.js';
import { sendApiError, sendApiJson } from '../security.js';
import type { RouteHandler } from '../types.js';

export const postAuthDeviceCode: RouteHandler = async (_request, response, context) => {
  const authProvider = context.options.authProvider;
  if (!authProvider) {
    sendApiError(response, 503, 'Graph authentication is not configured');
    return;
  }

  try {
    const payload = await authProvider.startDeviceCodeFlow({
      onSuccess: () => context.options.scheduler?.resetConsecutiveFailures(),
    });
    sendApiJson(response, 202, payload);
  } catch (error) {
    if (error instanceof DeviceCodeFlowConflictError) {
      sendApiError(response, 409, error.message);
      return;
    }

    sendApiError(
      response,
      500,
      error instanceof Error ? error.message : 'Unable to start device-code sign-in'
    );
  }
};

export const getAuthStatus: RouteHandler = async (_request, response, context) => {
  const authProvider = context.options.authProvider;
  if (!authProvider) {
    sendApiError(response, 503, 'Graph authentication is not configured');
    return;
  }

  sendApiJson(response, 200, authProvider.getAuthStatus());
};

export const postAuthLogout: RouteHandler = async (_request, response, context) => {
  const authProvider = context.options.authProvider;
  if (!authProvider) {
    sendApiError(response, 503, 'Graph authentication is not configured');
    return;
  }

  authProvider.logout();
  sendApiJson(response, 200, authProvider.getAuthStatus());
};
