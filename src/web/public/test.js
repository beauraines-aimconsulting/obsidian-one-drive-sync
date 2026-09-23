import { fetchJson, sendJson } from './api.js';

const elements = {
  searchInput: document.getElementById('file-search'),
  searchButton: document.getElementById('search-files-button'),
  fileSelect: document.getElementById('file-select'),
  filepathInput: document.getElementById('test-filepath'),
  loadSelectedButton: document.getElementById('load-selected-button'),
  contentEditor: document.getElementById('content-editor'),
  candidateRulesEditor: document.getElementById('candidate-rules-editor'),
  runButton: document.getElementById('run-test-button'),
  status: document.getElementById('test-status'),
  summary: document.getElementById('decision-summary'),
  traceOutput: document.getElementById('trace-output'),
  resultJson: document.getElementById('result-json'),
};

const state = {
  files: [],
};

function setStatus(message, className = 'status-message muted') {
  elements.status.textContent = message;
  elements.status.className = className;
}

async function loadFiles() {
  const query = elements.searchInput.value.trim();
  setStatus('Loading files…');

  const search = new URLSearchParams({ limit: '100', sort: 'path-asc' });
  if (query) search.set('q', query);

  try {
    const { response, payload } = await fetchJson(`/api/files?${search.toString()}`);
    if (!response.ok) {
      setStatus(payload?.error ?? `Request failed with ${response.status}`, 'status-message status-error');
      return;
    }

    state.files = Array.isArray(payload?.items) ? payload.items : [];
    renderFileOptions();
    setStatus(`Loaded ${state.files.length} file${state.files.length === 1 ? '' : 's'}.`, 'status-message muted');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'status-message status-error');
  }
}

function renderFileOptions() {
  elements.fileSelect.innerHTML = '';

  if (state.files.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No files found';
    elements.fileSelect.append(option);
    return;
  }

  for (const file of state.files) {
    const option = document.createElement('option');
    option.value = file.filepath;
    option.textContent = `${statusLabel(file.status)} ${file.filepath}`;
    elements.fileSelect.append(option);
  }

  if (!elements.filepathInput.value.trim()) {
    elements.filepathInput.value = state.files[0].filepath;
  }
}

function statusLabel(status) {
  switch (status) {
    case 'eligible':
      return '✅';
    case 'parse-error':
      return '⚠️';
    default:
      return '⛔';
  }
}

function selectedFilepath() {
  const selected = elements.fileSelect.value.trim();
  return selected || elements.filepathInput.value.trim();
}

async function loadSelectedFileContent() {
  const filepath = selectedFilepath();
  if (!filepath) {
    setStatus('Select or enter a filepath first.', 'status-message status-warning');
    return;
  }

  elements.filepathInput.value = filepath;
  setStatus(`Loading ${filepath}…`);

  try {
    const { response, text, payload } = await fetchJson(`/api/files/${encodePath(filepath)}`);
    if (!response.ok) {
      setStatus(payload?.error ?? `Request failed with ${response.status}`, 'status-message status-error');
      return;
    }

    elements.contentEditor.value = text;
    setStatus(`Loaded ${filepath}.`, 'status-message status-success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'status-message status-error');
  }
}

async function runEvaluation() {
  let rules;
  const rulesText = elements.candidateRulesEditor.value.trim();
  if (rulesText) {
    try {
      rules = JSON.parse(rulesText);
    } catch (error) {
      setStatus(
        `Pending rules JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
        'status-message status-error'
      );
      return;
    }
  }

  const payload = {};
  const filepath = elements.filepathInput.value.trim() || selectedFilepath();
  const content = elements.contentEditor.value;
  if (filepath) payload.filepath = filepath;
  if (content.trim()) payload.content = content;
  if (rules !== undefined) payload.rules = rules;

  setStatus('Evaluating…');
  try {
    const { response, payload: result } = await sendJson('/api/rules/test', 'POST', payload);
    if (!response.ok) {
      const details = Array.isArray(result?.errors)
        ? `\n${result.errors.map((entry) => `• ${entry.path}: ${entry.message}`).join('\n')}`
        : '';
      setStatus(
        `${result?.error ?? `Request failed with ${response.status}`}${details}`,
        'status-message status-error'
      );
      return;
    }

    renderResult(result);
    setStatus('Evaluation complete.', 'status-message status-success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'status-message status-error');
  }
}

function renderResult(result) {
  const decision = result.parseError
    ? '⚠️ Parse error'
    : result.eligible
      ? '✅ Eligible'
      : '⛔ Ineligible';
  elements.summary.textContent = `${decision} — ${result.reason}`;
  elements.resultJson.textContent = JSON.stringify(result, null, 2);
  elements.traceOutput.innerHTML = '';

  if (result.parseError) {
    const message = document.createElement('p');
    message.textContent = result.reason;
    elements.traceOutput.append(message);
    return;
  }

  if (!Array.isArray(result.rules) || result.rules.length === 0) {
    const message = document.createElement('p');
    message.textContent = result.reason;
    elements.traceOutput.append(message);
  } else {
    const tree = document.createElement('ul');
    tree.className = 'trace-tree';
    for (const rule of result.rules) {
      tree.append(renderTraceNode(rule));
    }
    elements.traceOutput.append(tree);
  }

  if (result.tagSources) {
    const tags = document.createElement('p');
    tags.className = 'muted';
    tags.textContent = [
      `frontmatter [${result.tagSources.frontmatter.join(', ')}]`,
      `inline [${result.tagSources.inline.join(', ')}]`,
      `task [${result.tagSources.task.join(', ')}]`,
    ].join(' · ');
    elements.traceOutput.append(tags);
  }
}

function renderTraceNode(node) {
  const item = document.createElement('li');
  item.className = 'trace-node';
  const icon = node.passed ? '✅' : '⛔';

  if (Array.isArray(node.children) && node.children.length > 0) {
    const details = document.createElement('details');
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = `${icon} ${node.name}`;
    details.append(summary);

    const children = document.createElement('ul');
    children.className = 'trace-tree';
    for (const child of node.children) {
      children.append(renderTraceNode(child));
    }
    details.append(children);
    item.append(details);
  } else {
    item.textContent = `${icon} ${node.name} — ${node.reason}`;
  }

  return item;
}

function encodePath(filepath) {
  return filepath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function handleFileSelection() {
  const filepath = selectedFilepath();
  if (filepath) {
    elements.filepathInput.value = filepath;
  }
}

elements.searchButton.addEventListener('click', () => {
  void loadFiles();
});
elements.loadSelectedButton.addEventListener('click', () => {
  void loadSelectedFileContent();
});
elements.runButton.addEventListener('click', () => {
  void runEvaluation();
});
elements.fileSelect.addEventListener('change', handleFileSelection);
elements.searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void loadFiles();
  }
});

void loadFiles();
