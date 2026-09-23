import { fetchJson } from './api.js';

const elements = {
  search: document.getElementById('files-search'),
  eligible: document.getElementById('files-eligible-filter'),
  sort: document.getElementById('files-sort'),
  limit: document.getElementById('files-limit'),
  apply: document.getElementById('files-apply-button'),
  prev: document.getElementById('files-prev-button'),
  next: document.getElementById('files-next-button'),
  status: document.getElementById('files-status'),
  summary: document.getElementById('files-summary'),
  list: document.getElementById('files-list'),
  previewPath: document.getElementById('preview-path'),
  previewContent: document.getElementById('preview-content'),
};

const state = {
  offset: 0,
  items: [],
  total: 0,
  hasMore: false,
  selectedPath: '',
};

function setStatus(message, className = 'status-message muted') {
  elements.status.textContent = message;
  elements.status.className = className;
}

function currentQuery() {
  const search = new URLSearchParams({
    limit: elements.limit.value,
    offset: String(state.offset),
    sort: elements.sort.value,
  });

  const query = elements.search.value.trim();
  if (query) search.set('q', query);
  if (elements.eligible.value) search.set('eligible', elements.eligible.value);
  return search;
}

async function loadFiles() {
  setStatus('Loading files…');

  try {
    const { response, payload } = await fetchJson(`/api/files?${currentQuery().toString()}`);
    if (!response.ok) {
      setStatus(payload?.error ?? `Request failed with ${response.status}`, 'status-message status-error');
      return;
    }

    state.items = Array.isArray(payload?.items) ? payload.items : [];
    state.total = typeof payload?.total === 'number' ? payload.total : state.items.length;
    state.hasMore = Boolean(payload?.hasMore);
    renderList();
    renderPager();
    setStatus(`Loaded ${state.items.length} file${state.items.length === 1 ? '' : 's'}.`);

    if (state.items.length > 0) {
      const existing = state.items.find((item) => item.filepath === state.selectedPath);
      if (existing) {
        await loadPreview(existing.filepath);
      } else {
        await loadPreview(state.items[0].filepath);
      }
    } else {
      state.selectedPath = '';
      elements.previewPath.textContent = 'Select a note to preview its content.';
      elements.previewContent.textContent = 'No file selected.';
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'status-message status-error');
  }
}

function renderList() {
  elements.list.innerHTML = '';
  if (state.items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No files matched the current filters.';
    elements.list.append(empty);
    return;
  }

  for (const item of state.items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `file-list-item${item.filepath === state.selectedPath ? ' file-list-item-active' : ''}`;
    button.addEventListener('click', () => {
      void loadPreview(item.filepath);
    });

    const heading = document.createElement('div');
    heading.className = 'file-list-heading';

    const pathText = document.createElement('span');
    pathText.className = 'file-list-path';
    pathText.textContent = item.filepath;

    const badge = document.createElement('span');
    badge.className = `badge badge-${item.status}`;
    badge.textContent = badgeLabel(item.status);

    heading.append(pathText, badge);

    const reason = document.createElement('div');
    reason.className = 'file-list-reason muted';
    reason.textContent = item.reason;

    button.append(heading, reason);
    elements.list.append(button);
  }
}

function renderPager() {
  const pageSize = Number.parseInt(elements.limit.value, 10);
  const start = state.total === 0 ? 0 : state.offset + 1;
  const end = Math.min(state.offset + state.items.length, state.total);
  elements.summary.textContent = `${start}-${end} of ${state.total}`;
  elements.prev.disabled = state.offset === 0;
  elements.next.disabled = !state.hasMore;
}

async function loadPreview(filepath) {
  state.selectedPath = filepath;
  renderList();
  elements.previewPath.textContent = filepath;
  elements.previewContent.textContent = 'Loading…';

  try {
    const { response, text, payload } = await fetchJson(`/api/files/${encodePath(filepath)}`);
    if (!response.ok) {
      elements.previewContent.textContent = payload?.error ?? `Request failed with ${response.status}`;
      return;
    }

    elements.previewContent.textContent = text;
  } catch (error) {
    elements.previewContent.textContent = error instanceof Error ? error.message : String(error);
  }
}

function badgeLabel(status) {
  switch (status) {
    case 'eligible':
      return 'Eligible';
    case 'parse-error':
      return 'Parse error';
    default:
      return 'Ineligible';
  }
}

function encodePath(filepath) {
  return filepath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

elements.apply.addEventListener('click', () => {
  state.offset = 0;
  void loadFiles();
});
elements.prev.addEventListener('click', () => {
  const pageSize = Number.parseInt(elements.limit.value, 10);
  state.offset = Math.max(0, state.offset - pageSize);
  void loadFiles();
});
elements.next.addEventListener('click', () => {
  const pageSize = Number.parseInt(elements.limit.value, 10);
  state.offset += pageSize;
  void loadFiles();
});
elements.search.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    state.offset = 0;
    void loadFiles();
  }
});

void loadFiles();
