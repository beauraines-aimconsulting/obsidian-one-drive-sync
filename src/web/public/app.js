import { fetchJson } from './api.js';

async function renderStatus() {
  const output = document.getElementById('status-output');
  if (!output) return;

  try {
    const { response, payload } = await fetchJson('/api/status');
    if (!response.ok) {
      output.textContent = payload?.error ?? `Request failed with ${response.status}`;
      return;
    }
    output.textContent = JSON.stringify(payload, null, 2);
  } catch (error) {
    output.textContent = error instanceof Error ? error.message : String(error);
  }
}

void renderStatus();
