const TOKEN_STORAGE_KEY = 'obsidian-one-drive-sync.web-token';

function bootstrapToken() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('token');
  if (!token) return;

  window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  url.searchParams.delete('token');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function readHeaders() {
  const token = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function renderStatus() {
  bootstrapToken();

  const output = document.getElementById('status-output');
  if (!output) return;

  try {
    const response = await fetch('/api/status', { headers: readHeaders() });
    const payload = await response.json();
    output.textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    output.textContent = error instanceof Error ? error.message : String(error);
  }
}

void renderStatus();
