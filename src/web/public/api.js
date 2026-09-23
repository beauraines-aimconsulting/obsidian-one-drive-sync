const TOKEN_STORAGE_KEY = 'obsidian-one-drive-sync.web-token';

export function bootstrapToken() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('token');
  if (!token) return;

  window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  url.searchParams.delete('token');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

export function readStoredToken() {
  bootstrapToken();
  return window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

export function readHeaders(extraHeaders = {}) {
  const token = readStoredToken();
  return token
    ? { ...extraHeaders, Authorization: `Bearer ${token}` }
    : { ...extraHeaders };
}

export function withStoredToken(url) {
  const token = readStoredToken();
  if (!token) return url;

  const absolute = new URL(url, window.location.origin);
  absolute.searchParams.set('token', token);
  return `${absolute.pathname}${absolute.search}${absolute.hash}`;
}

export async function fetchJson(url, options = {}) {
  bootstrapToken();
  const response = await fetch(url, {
    ...options,
    headers: readHeaders(options.headers ?? {}),
  });

  const text = await response.text();
  let payload = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }

  return { response, payload, text };
}

export async function sendJson(url, method, body, headers = {}) {
  return fetchJson(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
