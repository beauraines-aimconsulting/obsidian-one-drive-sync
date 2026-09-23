const TOKEN_STORAGE_KEY = 'obsidian-one-drive-sync.web-token';

export function bootstrapToken() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('token');
  if (!token) return;

  window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  url.searchParams.delete('token');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

export function readHeaders(extraHeaders = {}) {
  const token = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
  return token
    ? { ...extraHeaders, Authorization: `Bearer ${token}` }
    : { ...extraHeaders };
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
